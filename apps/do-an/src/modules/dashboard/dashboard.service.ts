import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService, REDIS_CLIENT, BatchLogRedisKey } from '@app/shared';
import {
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';
import Redis from 'ioredis';
import { RPS_KEY_PREFIX, RPS_WINDOW_SECONDS } from '../../common/middlewares/api-logger.middleware';

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
    const failureWindowSeconds = 60 * 60;
    const failuresFrom = new Date(now.getTime() - failureWindowSeconds * 1000);

    // Đọc metrics batch từ Redis (thay thế 2 Prisma aggregate cũ)
    const [redisMetrics1m, redisMetrics1s, redisMetrics3s] = await Promise.all([
      this.aggregateBatchLogsFromRedis(semester, metricsWindowSeconds),
      this.aggregateBatchLogsFromRedis(semester, 1),
      this.aggregateBatchLogsFromRedis(semester, 3),
    ]);

    const [
      // ─── Counts ──────────────────────────────────────────────
      totalStudents,
      totalCourses,
      totalClassSections,
      slotsAggregate,

      // ─── Registration flow ──────────────────────────────────
      // ─── Registration flow ──────────────────────────────────
      batchCounts,
      pendingBatches,
      batchItemCounts,

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

      // 5. Đếm batch theo type
      this.prisma.registrationBatch.groupBy({
        by: ['type'],
        where: { semester },
        _count: { id: true },
      }),

      // 6. Batch đang xử lý (PENDING)
      this.prisma.registrationBatch.count({
        where: {
          semester,
          status: RegistrationBatchStatus.PENDING,
        },
      }),

      // 7. Đếm batch items theo status VÀ type (CREATE / CANCEL)
      this.prisma.$queryRaw<
        Array<{ type: string; status: string; count: bigint }>
      >`
        SELECT b.type, i.status, COUNT(i.id) as count
        FROM registration_batch_items i
        JOIN registration_batches b ON i.batch_id = b.id
        WHERE b.semester = ${semester}
        GROUP BY b.type, i.status
      `,

      // 8. Failed items 1 giờ gần nhất, query riêng để phục vụ chi tiết fail
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

    let successItemsCreate = 0;
    let failedItemsCreate = 0;
    let successItemsCancel = 0;
    let failedItemsCancel = 0;
    let pendingItems = 0;

    for (const row of batchItemCounts) {
      const count = Number(row.count);
      if (row.status === RegistrationBatchItemStatus.PENDING) {
        pendingItems += count;
      } else if (row.status === RegistrationBatchItemStatus.SUCCESS) {
        if (row.type === RegistrationBatchType.CREATE) successItemsCreate += count;
        if (row.type === RegistrationBatchType.CANCEL) successItemsCancel += count;
      } else if (row.status === RegistrationBatchItemStatus.FAILED) {
        if (row.type === RegistrationBatchType.CREATE) failedItemsCreate += count;
        if (row.type === RegistrationBatchType.CANCEL) failedItemsCancel += count;
      }
    }

    let totalBatchesCreate = 0;
    let totalBatchesCancel = 0;
    for (const row of batchCounts) {
      if (row.type === RegistrationBatchType.CREATE) totalBatchesCreate += row._count.id;
      if (row.type === RegistrationBatchType.CANCEL) totalBatchesCancel += row._count.id;
    }
    const totalBatches = totalBatchesCreate + totalBatchesCancel;

    const totalSuccessItems = successItemsCreate + successItemsCancel;
    const totalFailedItems = failedItemsCreate + failedItemsCancel;
    const totalPendingItems = pendingItems;
    const totalAllItems = totalSuccessItems + totalFailedItems + totalPendingItems;

    const logSum = redisMetrics1m;

    // itemsPerSecond: từ aggregate Redis 1 giây gần nhất.
    const itemsPerSecond = redisMetrics1s.totalItems > 0
      ? redisMetrics1s.totalItems / 1
      : 0;

    // Performance stats (min/max/avg) từ Redis logs 1 phút
    const perfStats = redisMetrics1m;

    // Realtime stats (min/max/avg) từ Redis logs 3 giây (để vẽ chart)
    const realtimePerf = redisMetrics3s;

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
        totalFailedItems1m: logSum.failedItems,
        totalFailedItems1h: failedItems1h,
        avgProcessingDurationMs: logSum.avgProcessingDurationMs !== null
          ? Number(logSum.avgProcessingDurationMs.toFixed(0))
          : null,
        avgQueueWaitMs: logSum.avgQueueWaitMs !== null
          ? Number(logSum.avgQueueWaitMs.toFixed(0))
          : null,
        itemsPerSecond: itemsPerSecond
          ? Number(itemsPerSecond.toFixed(2))
          : null,
        requestsPerSecond: await this.getRequestsPerSecond(),
        requestsLast5Min: await this.getTotalRequestsLast5Min(),
      },

      // ─── Registration flow ───────────────────────────────────
      registrationFlow: {
        totalBatches,
        totalBatchesCreate,
        totalBatchesCancel,
        pendingBatches,
        successItemsCreate,
        failedItemsCreate,
        successItemsCancel,
        failedItemsCancel,
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

      // ─── Performance stats (min/max/avg) ────────────────────
      performanceStats: {
        batchCount: perfStats.batchCount,
        processingDuration: {
          min: perfStats.minProcessingDurationMs,
          max: perfStats.maxProcessingDurationMs,
          avg: perfStats.avgProcessingDurationMs !== null
            ? Number(perfStats.avgProcessingDurationMs.toFixed(0))
            : null,
        },
        queueWait: {
          min: perfStats.minQueueWaitMs,
          max: perfStats.maxQueueWaitMs,
          avg: perfStats.avgQueueWaitMs !== null
            ? Number(perfStats.avgQueueWaitMs.toFixed(0))
            : null,
        },
        totalResponseTime: {
          min: perfStats.minTotalResponseMs,
          max: perfStats.maxTotalResponseMs,
          avg: perfStats.avgTotalResponseMs !== null
            ? Number(perfStats.avgTotalResponseMs.toFixed(0))
            : null,
        },
        itemsPerBatch: {
          min: perfStats.minItems,
          max: perfStats.maxItems,
          avg: perfStats.totalItems > 0 && perfStats.batchCount > 0
            ? Number((perfStats.totalItems / perfStats.batchCount).toFixed(1))
            : null,
        },
      },

      // ─── Realtime stats (3 seconds - for chart) ─────────────
      realtimeStats: {
        batchCount: realtimePerf.batchCount,
        processingDuration: {
          min: realtimePerf.minProcessingDurationMs,
          max: realtimePerf.maxProcessingDurationMs,
          avg: realtimePerf.avgProcessingDurationMs !== null
            ? Number(realtimePerf.avgProcessingDurationMs.toFixed(0))
            : null,
        },
        queueWait: {
          min: realtimePerf.minQueueWaitMs,
          max: realtimePerf.maxQueueWaitMs,
          avg: realtimePerf.avgQueueWaitMs !== null
            ? Number(realtimePerf.avgQueueWaitMs.toFixed(0))
            : null,
        },
        totalResponseTime: {
          min: realtimePerf.minTotalResponseMs,
          max: realtimePerf.maxTotalResponseMs,
          avg: realtimePerf.avgTotalResponseMs !== null
            ? Number(realtimePerf.avgTotalResponseMs.toFixed(0))
            : null,
        },
      },

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
    opsPerSec?: number | null;
    totalCommands?: number | null;
  }> {
    const startedAt = Date.now();
    try {
      await this.redis.ping();
      const pingMs = Date.now() - startedAt;

      const infoStats = await this.redis.info('stats');
      let opsPerSec: number | null = null;
      let totalCommands: number | null = null;

      const opsMatch = infoStats.match(/instantaneous_ops_per_sec:(\d+)/);
      if (opsMatch) opsPerSec = parseInt(opsMatch[1], 10);

      const cmdMatch = infoStats.match(/total_commands_processed:(\d+)/);
      if (cmdMatch) totalCommands = parseInt(cmdMatch[1], 10);

      return {
        status: 'ready',
        pingMs,
        opsPerSec,
        totalCommands,
      };
    } catch (err) {
      this.logger.warn(
        `[Dashboard] Redis health check failed: ${err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        status: this.redis.status === 'connecting' ? 'connecting' : 'down',
        pingMs: null,
        opsPerSec: null,
        totalCommands: null,
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

  /**
   * Tổng số request trong 5 phút gần nhất — cộng dồn từng bucket giây.
   */
  async getTotalRequestsLast5Min(): Promise<number | null> {
    try {
      const nowSecond = Math.floor(Date.now() / 1000);
      const keys: string[] = [];
      for (let i = 0; i < RPS_WINDOW_SECONDS; i++) {
        keys.push(`${RPS_KEY_PREFIX}${nowSecond - i}`);
      }
      const values = await this.redis.mget(...keys);
      const total = values.reduce(
        (sum, v) => sum + (v ? Number(v) : 0),
        0,
      );
      return total;
    } catch {
      return null;
    }
  }

  /**
   * Reset toàn bộ dữ liệu test:
   * - TRUNCATE các bảng registration_batch_items, registration_batches
   * - UPDATE class_sections SET sl_dk = 0
   * - Xóa tất cả Redis RPS bucket keys của 5 phút vừa rồi
   */
  async resetTestData(): Promise<{ message: string; redisKeysDeleted: number }> {
    // 1. Reset DB (batch_processing_logs đã chuyển sang Redis, không cần TRUNCATE nữa)
    await this.prisma.$executeRaw`TRUNCATE TABLE "registration_batch_items" CASCADE`;
    await this.prisma.$executeRaw`TRUNCATE TABLE "registration_batches" CASCADE`;
    await this.prisma.$executeRaw`UPDATE "class_sections" SET "sl_dk" = 0`;

    this.logger.warn('[Reset] DB tables truncated and sl_dk reset to 0');

    // 2. Xóa Redis RPS keys 5 phút gần nhất
    const nowSecond = Math.floor(Date.now() / 1000);
    const rpsKeys: string[] = [];
    for (let i = 0; i < RPS_WINDOW_SECONDS; i++) {
      rpsKeys.push(`${RPS_KEY_PREFIX}${nowSecond - i}`);
    }

    // 3. Xóa Redis batch log keys (batch:log:{semester}:*)
    const batchPattern = BatchLogRedisKey.pattern(await this.prisma.systemSetting
      .findUnique({ where: { id: 1 } })
      .then((s) => s?.currentSemester ?? ''));
    
    let cursor = '0';
    const batchKeys: string[] = [];
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', batchPattern, 'COUNT', 1000)
        .catch(() => ['0', [] as string[]] as [string, string[]]);
      cursor = nextCursor;
      batchKeys.push(...keys);
    } while (cursor !== '0');

    const allKeysToDelete = [...rpsKeys, ...batchKeys];
    let redisKeysDeleted = 0;
    try {
      if (allKeysToDelete.length > 0) {
        // Chia nhỏ mảng keys để tránh lỗi Maximum call stack size exceeded
        const chunkSize = 1000;
        for (let i = 0; i < allKeysToDelete.length; i += chunkSize) {
          const chunk = allKeysToDelete.slice(i, i + chunkSize);
          await this.redis.del(...chunk);
        }
        redisKeysDeleted = allKeysToDelete.length;
      }
      this.logger.warn(
        `[Reset] Deleted ${redisKeysDeleted} Redis keys (RPS + batch logs)`,
      );

      // 4. Reset Redis INFO stats (total_commands_processed, etc.)
      await this.redis.config('RESETSTAT');
      this.logger.warn('[Reset] Redis stats reset to 0');
    } catch (err) {
      this.logger.error(`[Reset] Failed to delete Redis keys: ${(err as Error).message}`);
    }

    return {
      message: 'Reset thành công. Tất cả dữ liệu test đã được xóa.',
      redisKeysDeleted,
    };
  }

  /**
   * Đọc và aggregate toàn bộ batch log trong Redis theo thời gian window (giây).
   * Dùng SCAN + HGETALL, filter theo createdAtMs, rồi tính toần.
   */
  private async aggregateBatchLogsFromRedis(
    semester: string,
    windowSeconds: number,
  ): Promise<{
    totalItems: number;
    successItems: number;
    failedItems: number;
    batchCount: number;
    avgProcessingDurationMs: number | null;
    avgQueueWaitMs: number | null;
    minProcessingDurationMs: number | null;
    maxProcessingDurationMs: number | null;
    minQueueWaitMs: number | null;
    maxQueueWaitMs: number | null;
    minTotalResponseMs: number | null;
    maxTotalResponseMs: number | null;
    avgTotalResponseMs: number | null;
    minItems: number | null;
    maxItems: number | null;
  }> {
    const cutoffMs = Date.now() - windowSeconds * 1000;
    const pattern = BatchLogRedisKey.pattern(semester);

    let cursor = '0';
    const entries: Record<string, string>[] = [];
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor, 'MATCH', pattern, 'COUNT', 200,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        const pipeline = this.redis.pipeline();
        for (const key of keys) pipeline.hgetall(key);
        const results = await pipeline.exec();
        if (results) {
          for (const [, data] of results) {
            if (data && typeof data === 'object') {
              entries.push(data as Record<string, string>);
            }
          }
        }
      }
    } while (cursor !== '0');

    let totalItems = 0;
    let successItems = 0;
    let failedItems = 0;
    let sumDuration = 0;
    let sumQueue = 0;
    let sumTotal = 0;
    let count = 0;

    let minDuration = Infinity;
    let maxDuration = -Infinity;
    let minQueue = Infinity;
    let maxQueue = -Infinity;
    let minTotal = Infinity;
    let maxTotal = -Infinity;
    let minItemCount = Infinity;
    let maxItemCount = -Infinity;

    for (const entry of entries) {
      const createdAtMs = Number(entry['createdAtMs'] ?? 0);
      if (createdAtMs < cutoffMs) continue;

      const items = Number(entry['totalItems'] ?? 0);
      const duration = Number(entry['processingDurationMs'] ?? 0);
      const queue = Number(entry['queueWaitMs'] ?? 0);
      const totalResponse = queue + duration;

      totalItems += items;
      successItems += Number(entry['successItems'] ?? 0);
      failedItems += Number(entry['failedItems'] ?? 0);
      sumDuration += duration;
      sumQueue += queue;
      sumTotal += totalResponse;
      count++;

      if (duration < minDuration) minDuration = duration;
      if (duration > maxDuration) maxDuration = duration;
      if (queue < minQueue) minQueue = queue;
      if (queue > maxQueue) maxQueue = queue;
      if (totalResponse < minTotal) minTotal = totalResponse;
      if (totalResponse > maxTotal) maxTotal = totalResponse;
      if (items < minItemCount) minItemCount = items;
      if (items > maxItemCount) maxItemCount = items;
    }

    return {
      totalItems,
      successItems,
      failedItems,
      batchCount: count,
      avgProcessingDurationMs: count > 0 ? sumDuration / count : null,
      avgQueueWaitMs: count > 0 ? sumQueue / count : null,
      minProcessingDurationMs: count > 0 ? minDuration : null,
      maxProcessingDurationMs: count > 0 ? maxDuration : null,
      minQueueWaitMs: count > 0 ? minQueue : null,
      maxQueueWaitMs: count > 0 ? maxQueue : null,
      minTotalResponseMs: count > 0 ? minTotal : null,
      maxTotalResponseMs: count > 0 ? maxTotal : null,
      avgTotalResponseMs: count > 0 ? sumTotal / count : null,
      minItems: count > 0 ? minItemCount : null,
      maxItems: count > 0 ? maxItemCount : null,
    };
  }
}
