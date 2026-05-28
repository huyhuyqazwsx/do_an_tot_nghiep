import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { REDIS_CLIENT } from '@app/shared';
import { RegistrationRedisKey } from '@app/shared';
import type { CreateRegistrationBatchJobItem } from '@app/shared';
import Redis from 'ioredis';
import {
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';
import { RegistrationHelperService } from './helpers/registration-helper.service';
import type { CreateBatchSectionInfo } from './types/registration-worker.types';

const PREWARM_CACHE_TTL_SECONDS = 30 * 60;

@Injectable()
export class CreateBatchHandler {
  private readonly logger = new Logger(CreateBatchHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: RegistrationHelperService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async handle(
    batchId: string,
    userId: string,
    semester: string,
    payloadItems?: CreateRegistrationBatchJobItem[],
    queuedAt?: string,
  ): Promise<void> {
    const processingStartedAt = Date.now();
    const timing = {
      loadPendingItemsMs: 0,
      loadSectionsMs: 0,
      processItemsMs: 0,
      dbTxnMs: 0,
      redisMs: 0,
      markFailedMs: 0,
      finalizeBatchMs: 0,
      writeMetricsMs: 0,
    };
    const time = async <T>(
      key: keyof typeof timing,
      action: () => Promise<T>,
    ): Promise<T> => {
      const startedAt = Date.now();
      try {
        return await action();
      } finally {
        timing[key] += Date.now() - startedAt;
      }
    };
    const queueWaitMs = queuedAt
      ? Math.max(processingStartedAt - new Date(queuedAt).getTime(), 0)
      : 0;

    this.logger.log(
      `[CreateBatch] START batchId=${batchId} userId=${userId} semester=${semester} queueWait=${queueWaitMs}ms payloadItems=${payloadItems?.length ?? 0}`,
    );

    // Batch + items đã được API tạo sẵn trong DB trước khi publish.
    // Chỉ cần load items PENDING để xử lý.
    const items = await time('loadPendingItemsMs', () =>
      this.prisma.registrationBatchItem.findMany({
        where: { batchId, status: RegistrationBatchItemStatus.PENDING },
        select: { id: true, classSectionId: true },
        orderBy: { createdAt: 'asc' },
      }),
    );

    if (items.length === 0) {
      await time('finalizeBatchMs', () =>
        this.prisma.registrationBatch.update({
          where: { id: batchId },
          data: {
            status: RegistrationBatchStatus.COMPLETED,
            processedAt: new Date(),
          },
        }),
      );
      this.logger.log(
        `[CreateBatch] batchId=${batchId} ${RegistrationBatchStatus.COMPLETED} — success=0 fail=0`,
      );
      this.logger.log(
        `[CreateBatchTiming] batchId=${batchId} total=${Date.now() - processingStartedAt}ms queueWait=${queueWaitMs}ms loadPending=${timing.loadPendingItemsMs}ms finalizeBatch=${timing.finalizeBatchMs}ms`,
      );
      return;
    }

    // 2. Load class sections + courses in 1 query
    const classSectionIds = items
      .map((i) => i.classSectionId)
      .filter(Boolean) as string[];

    const payloadItemsBySectionId = new Map(
      (payloadItems ?? []).map((item) => [item.classSectionId, item]),
    );
    const hasPayloadForAllSections = classSectionIds.every((id) =>
      payloadItemsBySectionId.has(id),
    );
    const sections: CreateBatchSectionInfo[] = await time(
      'loadSectionsMs',
      async () =>
        hasPayloadForAllSections
          ? classSectionIds.map((classSectionId) => {
              const item = payloadItemsBySectionId.get(classSectionId)!;
              return {
                id: item.classSectionId,
                courseId: item.courseId,
                dayOfWeek: item.dayOfWeek,
                timeOfDay: item.timeOfDay,
                startPeriod: item.startPeriod,
                endPeriod: item.endPeriod,
                course: {
                  code: item.courseCode,
                  name: item.courseName,
                  prerequisite: item.prerequisite,
                },
              };
            })
          : await this.prisma.classSection.findMany({
              where: { id: { in: classSectionIds } },
              select: {
                id: true,
                courseId: true,
                dayOfWeek: true,
                timeOfDay: true,
                startPeriod: true,
                endPeriod: true,
                course: {
                  select: { code: true, name: true, prerequisite: true },
                },
              },
            }),
    );
    this.logger.log(
      `[CreateBatchTiming] batchId=${batchId} loadSections=${timing.loadSectionsMs}ms source=${hasPayloadForAllSections ? 'payload' : 'db'} count=${sections.length}`,
    );
    const sectionMap = new Map(sections.map((s) => [s.id, s]));

    let successCount = 0;
    let failCount = 0;

    // 5. Process từng item
    const processItemsStartedAt = Date.now();
    for (const item of items) {
      const itemStartedAt = Date.now();
      const itemTiming = {
        validateMs: 0,
        dbTxnMs: 0,
        redisMs: 0,
        failMs: 0,
      };
      const validateStartedAt = Date.now();

      if (!item.classSectionId) {
        itemTiming.validateMs += Date.now() - validateStartedAt;
        const failStartedAt = Date.now();
        await this.helper.markItemFailed(item.id, 'Thiếu classSectionId');
        itemTiming.failMs += Date.now() - failStartedAt;
        timing.markFailedMs += itemTiming.failMs;
        failCount++;
        this.logger.warn(
          `[CreateBatchItemTiming] batchId=${batchId} item=${item.id} FAILED total=${Date.now() - itemStartedAt}ms validate=${itemTiming.validateMs}ms failWrite=${itemTiming.failMs}ms reason="Thiếu classSectionId"`,
        );
        continue;
      }

      const section = sectionMap.get(item.classSectionId);
      if (!section) {
        itemTiming.validateMs += Date.now() - validateStartedAt;
        const failStartedAt = Date.now();
        await this.helper.markItemFailed(item.id, 'Lớp học phần không tồn tại');
        itemTiming.failMs += Date.now() - failStartedAt;
        timing.markFailedMs += itemTiming.failMs;
        failCount++;
        this.logger.warn(
          `[CreateBatchItemTiming] batchId=${batchId} item=${item.id} section=${item.classSectionId} FAILED total=${Date.now() - itemStartedAt}ms validate=${itemTiming.validateMs}ms failWrite=${itemTiming.failMs}ms reason="Lớp học phần không tồn tại"`,
        );
        continue;
      }

      itemTiming.validateMs += Date.now() - validateStartedAt;

      // Validate tiên quyết
      // const hasPrereq = await this.helper.checkPrerequisite(
      //   userId,
      //   section.course.prerequisite,
      // );
      // if (!hasPrereq) {
      //   await this.helper.markItemFailed(
      //     item.id,
      //     `Chưa hoàn thành môn tiên quyết ${section.course.prerequisite}`,
      //   );
      //   failCount++;
      //   continue;
      // }

      // Lock slot + ghi kết quả ticket
      try {
        const txnStartedAt = Date.now();
        const slotState = await this.prisma.$transaction(async (tx) => {
          const result = await this.helper.acquireSlot(
            tx,
            item.classSectionId!,
          );

          await tx.outbox.create({
            data: {
              eventType: 'REGISTRATION_SUCCESS',
              payload: {
                userId,
                classSectionId: item.classSectionId,
                courseCode: section.course.code,
                courseName: section.course.name,
                semester,
              },
            },
          });

          await tx.registrationBatchItem.update({
            where: { id: item.id },
            data: {
              status: RegistrationBatchItemStatus.SUCCESS,
              remainingSlots: result.remaining,
              processedAt: new Date(),
            },
          });

          return result;
        });
        itemTiming.dbTxnMs = Date.now() - txnStartedAt;
        timing.dbTxnMs += itemTiming.dbTxnMs;

        const pipeline = this.redis.pipeline();

        // 1. Ghi số slot trống chuẩn từ DB transaction
        const sectionSlotsKey = RegistrationRedisKey.sectionSlots(
          item.classSectionId,
        );
        const sectionInfoKey = RegistrationRedisKey.sectionInfo(
          item.classSectionId,
        );
        pipeline.set(sectionSlotsKey, slotState.remaining.toString());
        pipeline.expire(sectionSlotsKey, PREWARM_CACHE_TTL_SECONDS);

        // 2. Ghi registeredCount chuẩn từ DB transaction
        pipeline.hset(
          sectionInfoKey,
          'registeredCount',
          slotState.registeredCount.toString(),
        );
        pipeline.expire(sectionInfoKey, PREWARM_CACHE_TTL_SECONDS);

        const redisStartedAt = Date.now();
        await pipeline.exec();
        itemTiming.redisMs = Date.now() - redisStartedAt;
        timing.redisMs += itemTiming.redisMs;

        successCount++;
        this.logger.log(
          `[CreateBatchItemTiming] batchId=${batchId} item=${item.id} section=${item.classSectionId} SUCCESS total=${Date.now() - itemStartedAt}ms validate=${itemTiming.validateMs}ms dbTxn=${itemTiming.dbTxnMs}ms redis=${itemTiming.redisMs}ms remaining=${slotState.remaining}`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Lỗi xử lý';
        const failStartedAt = Date.now();
        await this.helper.markItemFailed(item.id, reason);
        itemTiming.failMs = Date.now() - failStartedAt;
        timing.markFailedMs += itemTiming.failMs;
        failCount++;
        this.logger.warn(
          `[CreateBatchItemTiming] batchId=${batchId} item=${item.id} section=${item.classSectionId} FAILED total=${Date.now() - itemStartedAt}ms validate=${itemTiming.validateMs}ms dbTxn=${itemTiming.dbTxnMs}ms redis=${itemTiming.redisMs}ms failWrite=${itemTiming.failMs}ms reason="${reason}"`,
        );
      }
    }
    timing.processItemsMs = Date.now() - processItemsStartedAt;

    await time('finalizeBatchMs', () =>
      this.prisma.registrationBatch.update({
        where: { id: batchId },
        data: {
          status: RegistrationBatchStatus.COMPLETED,
          processedAt: new Date(),
        },
      }),
    );

    this.logger.log(
      `[CreateBatch] batchId=${batchId} ${RegistrationBatchStatus.COMPLETED} — success=${successCount} fail=${failCount}`,
    );

    // ─── Ghi batch processing log ──────────────────────────────────────────
    const processingEndedAt = Date.now();
    const processingDurationMs = processingEndedAt - processingStartedAt;
    const totalItems = successCount + failCount;

    await time('writeMetricsMs', () =>
      this.prisma.batchProcessingLog.create({
        data: {
          batchId,
          semester,
          batchType: RegistrationBatchType.CREATE,
          queuedAt: queuedAt
            ? new Date(queuedAt)
            : new Date(processingStartedAt),
          processingStartedAt: new Date(processingStartedAt),
          processingEndedAt: new Date(processingEndedAt),
          queueWaitMs,
          processingDurationMs,
          totalItems,
          successItems: successCount,
          failedItems: failCount,
        },
      }),
    );

    this.logger.log(
      `[CreateBatchTiming] batchId=${batchId} total=${Date.now() - processingStartedAt}ms queueWait=${queueWaitMs}ms items=${totalItems} success=${successCount} fail=${failCount} loadPending=${timing.loadPendingItemsMs}ms loadSections=${timing.loadSectionsMs}ms processItems=${timing.processItemsMs}ms dbTxn=${timing.dbTxnMs}ms redis=${timing.redisMs}ms markFailed=${timing.markFailedMs}ms finalizeBatch=${timing.finalizeBatchMs}ms writeMetrics=${timing.writeMetricsMs}ms`,
    );
  }
}
