import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService, REDIS_CLIENT } from '@app/shared';
import {
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';
import Redis from 'ioredis';
import { RPS_KEY_PREFIX } from '../../common/middlewares/api-logger.middleware';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) { }

  async getOverview(semester: string) {
    const now = new Date();
    const metricsWindowSeconds = 60;
    const throughputWindowSeconds = 1;
    const failureWindowSeconds = 60 * 60;
    const metricsFrom = new Date(now.getTime() - metricsWindowSeconds * 1000);
    const throughputFrom = new Date(now.getTime() - throughputWindowSeconds * 1000);
    const failuresFrom = new Date(now.getTime() - failureWindowSeconds * 1000);

    const [
      // ─── Counts ──────────────────────────────────────────────
      totalStudents,
      totalCourses,
      totalClassSections,
      slotsAggregate,

      // ─── Registration flow ──────────────────────────────────
      totalBatches,
      pendingBatches,
      batchItemCounts,

      // ─── Processing logs (1m) ───────────────────────────────
      processingLogs1m,

      // ─── Throughput logs (1s) ───────────────────────────────
      throughputLogs1s,

      // ─── Failed items (1h) ──────────────────────────────────
      failedItems1h,

      // ─── Hot sections ───────────────────────────────────────
      hotSections,

      // ─── System settings ────────────────────────────────────
      systemSettings,

      // ─── Redis health ───────────────────────────────────────
      redisHealth,
    ] = await Promise.all([
      // 1. Tổng sinh viên
      this.prisma.user.count({ where: { role: 'STUDENT', isActive: true } }),

      // 2. Tổng môn học
      this.prisma.course.count(),

      // 3. Tổng lớp học phần (theo kỳ)
      this.prisma.classSection.count({ where: { semester } }),

      // 4. Tổng slot mở
      this.prisma.classSection.aggregate({
        where: { semester },
        _sum: { maxCapacity: true },
      }),

      // 5. Tổng batch đã gửi
      this.prisma.registrationBatch.count({ where: { semester } }),

      // 6. Batch đang xử lý (PENDING)
      this.prisma.registrationBatch.count({
        where: { semester, status: RegistrationBatchStatus.PENDING },
      }),

      // 7. Đếm batch items theo status
      this.prisma.registrationBatchItem.groupBy({
        by: ['status'],
        where: { batch: { semester } },
        _count: { id: true },
      }),

      // 8. Processing logs 1 phút gần nhất (avg latency, failedItems1m)
      this.prisma.batchProcessingLog.aggregate({
        where: { semester, createdAt: { gte: metricsFrom } },
        _sum: {
          totalItems: true,
          successItems: true,
          failedItems: true,
          processingDurationMs: true,
          queueWaitMs: true,
        },
        _count: { id: true },
        _avg: {
          processingDurationMs: true,
          queueWaitMs: true,
        },
      }),

      // 9. Throughput logs 1 giây gần nhất (chỉ dùng để tính items/s chính xác)
      this.prisma.batchProcessingLog.aggregate({
        where: { semester, createdAt: { gte: throughputFrom } },
        _sum: { totalItems: true },
      }),

      // 10. Failed items 1 giờ gần nhất, query riêng để phục vụ chi tiết fail
      this.prisma.registrationBatchItem.count({
        where: {
          status: RegistrationBatchItemStatus.FAILED,
          processedAt: { gte: failuresFrom },
          batch: { semester },
        },
      }),

      // 11. Lớp gần đầy (>= 90%)
      this.prisma.$queryRaw<
        Array<{
          id: string;
          ma_lop: string;
          course_name: string;
          sl_dk: number;
          sl_max: number;
        }>
      >`
        SELECT cs.id, cs.ma_lop, c.name AS course_name, cs.sl_dk, cs.sl_max
        FROM class_sections cs
        JOIN courses c ON c.id = cs.course_id
        WHERE cs.semester = ${semester}
          AND cs.sl_max > 0
          AND cs.sl_dk::float / cs.sl_max >= 0.9
        ORDER BY cs.sl_dk::float / cs.sl_max DESC
        LIMIT 10
      `,

      // 12. System settings
      this.prisma.systemSetting.findUnique({ where: { id: 1 } }),

      // 13. Redis health
      this.checkRedisHealth(),
    ]);

    // ─── Tính metrics từ kết quả ────────────────────────────────────────

    const itemCountMap = new Map(
      batchItemCounts.map((g) => [g.status, g._count.id]),
    );
    const totalSuccessItems =
      itemCountMap.get(RegistrationBatchItemStatus.SUCCESS) ?? 0;
    const totalFailedItems =
      itemCountMap.get(RegistrationBatchItemStatus.FAILED) ?? 0;
    const totalPendingItems =
      itemCountMap.get(RegistrationBatchItemStatus.PENDING) ?? 0;
    const totalAllItems =
      totalSuccessItems + totalFailedItems + totalPendingItems;

    const logSum = processingLogs1m._sum;

    // itemsPerSecond: lấy từ aggregate 1 giây gần nhất để phản ánh throughput tức thì,
    // không dùng tổng 1 phút để tránh bị làm mượt (smoothed) và thiếu chính xác.
    const itemsPerSecond = throughputLogs1s._sum.totalItems
      ? throughputLogs1s._sum.totalItems / throughputWindowSeconds
      : null;

    // Tỉ lệ thành công
    const batchSuccessRate =
      totalAllItems > 0
        ? ((totalSuccessItems / totalAllItems) * 100)
        : null;

    // Cảnh báo
    const warnings: Array<{
      type: string;
      title: string;
      description: string;
      tone: 'danger' | 'warn';
    }> = [];

    const failedItems1m = logSum.failedItems ?? 0;
    if (failedItems1h > 0) {
      warnings.push({
        type: 'high_failure',
        title: `${failedItems1h} item bị từ chối trong 1 giờ`,
        description:
          'Phần lớn do hết slot và trùng lịch. Nên xem các lớp gần đầy trước giờ cao điểm.',
        tone: 'danger',
      });
    }

    if (hotSections.length > 0) {
      warnings.push({
        type: 'near_full_sections',
        title: `${hotSections.length} lớp đã dùng trên 90% chỉ tiêu`,
        description:
          'Có thể cần mở thêm lớp hoặc tăng chỉ tiêu nếu khoa xác nhận.',
        tone: 'warn',
      });
    }

    return {
      semester,
      windows: {
        metricsSeconds: metricsWindowSeconds,
        failureSeconds: failureWindowSeconds,
      },

      // ─── Overview stats ──────────────────────────────────────
      overview: {
        totalStudents,
        totalCourses,
        totalClassSections,
        totalSlots: slotsAggregate._sum.maxCapacity ?? 0,
        batchSuccessRate: batchSuccessRate
          ? Number(batchSuccessRate.toFixed(1))
          : null,
        totalFailedItems1m: failedItems1m,
        totalFailedItems1h: failedItems1h,
        avgProcessingDurationMs: processingLogs1m._avg.processingDurationMs
          ? Number(processingLogs1m._avg.processingDurationMs.toFixed(0))
          : null,
        avgQueueWaitMs: processingLogs1m._avg.queueWaitMs
          ? Number(processingLogs1m._avg.queueWaitMs.toFixed(0))
          : null,
        itemsPerSecond: itemsPerSecond
          ? Number(itemsPerSecond.toFixed(2))
          : null,
        requestsPerSecond: await this.getRequestsPerSecond(),
      },

      // ─── Registration flow ───────────────────────────────────
      registrationFlow: {
        totalBatches,
        pendingBatches,
        successItems: totalSuccessItems,
        failedItems: totalFailedItems,
      },

      // ─── Hot sections ────────────────────────────────────────
      hotSections: hotSections.map((s) => ({
        sectionCode: s.ma_lop,
        courseName: s.course_name,
        used: s.sl_dk,
        max: s.sl_max,
      })),

      // ─── Registration session ────────────────────────────────
      registrationSession: systemSettings
        ? {
          openAt: systemSettings.registrationOpenAt.toISOString(),
          closeAt: systemSettings.registrationCloseAt.toISOString(),
        }
        : null,

      // ─── Warnings ────────────────────────────────────────────
      warnings,

      // ─── Cache health ────────────────────────────────────────
      cache: {
        redis: redisHealth,
      },
    };
  }

  private async checkRedisHealth(): Promise<{
    status: 'ready' | 'connecting' | 'down';
    pingMs: number | null;
  }> {
    const startedAt = Date.now();
    try {
      await this.redis.ping();
      return {
        status: 'ready',
        pingMs: Date.now() - startedAt,
      };
    } catch (err) {
      this.logger.warn(
        `[Dashboard] Redis health check failed: ${err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        status: this.redis.status === 'connecting' ? 'connecting' : 'down',
        pingMs: null,
      };
    }
  }

  /**
   * Lấy số request/s từ Redis counter.
   * Đọc key của giây trước (đã đếm xong hoàn chỉnh) để đảm bảo chính xác.
   */
  private async getRequestsPerSecond(): Promise<number | null> {
    try {
      const previousSecond = Math.floor(Date.now() / 1000) - 1;
      const value = await this.redis.get(`${RPS_KEY_PREFIX}${previousSecond}`);
      return value ? Number(value) : null;
    } catch {
      return null;
    }
  }
}
