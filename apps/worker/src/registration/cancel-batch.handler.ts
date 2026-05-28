import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { REDIS_CLIENT } from '@app/shared';
import { RegistrationRedisKey } from '@app/shared';
import type { CancelRegistrationBatchJobItem } from '@app/shared';
import Redis from 'ioredis';
import {
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';
import { RegistrationHelperService } from './helpers/registration-helper.service';

const PREWARM_CACHE_TTL_SECONDS = 30 * 60;

@Injectable()
export class CancelBatchHandler {
  private readonly logger = new Logger(CancelBatchHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: RegistrationHelperService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async handle(
    batchId: string,
    userId: string,
    semester: string,
    payloadItems?: CancelRegistrationBatchJobItem[],
    queuedAt?: string,
  ): Promise<void> {
    const processingStartedAt = Date.now();
    const timing = {
      loadPendingItemsMs: 0,
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
      `[CancelBatch] START batchId=${batchId} userId=${userId} semester=${semester} queuedWait=${queueWaitMs}ms payloadItems=${payloadItems?.length ?? 0}`,
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

    // Build sourceItemId map từ payload (API đã gửi kèm)
    const sourceItemMap = new Map(
      (payloadItems ?? []).map((item) => [item.classSectionId, item.sourceItemId]),
    );

    let successCount = 0;
    let failCount = 0;

    const processItemsStartedAt = Date.now();
    for (const item of items) {
      const itemStartedAt = Date.now();
      const itemTiming = {
        dbTxnMs: 0,
        redisMs: 0,
        failMs: 0,
      };

      if (!item.classSectionId) {
        const failStartedAt = Date.now();
        await this.helper.markItemFailed(item.id, 'Thiếu classSectionId');
        itemTiming.failMs += Date.now() - failStartedAt;
        timing.markFailedMs += itemTiming.failMs;
        failCount++;
        this.logger.warn(
          `[CancelBatchItemTiming] batchId=${batchId} item=${item.id} FAILED total=${Date.now() - itemStartedAt}ms failWrite=${itemTiming.failMs}ms reason="Thiếu classSectionId"`,
        );
        continue;
      }

      // Lookup sourceItemId từ payload — O(1)
      const sourceItemId = sourceItemMap.get(item.classSectionId);
      if (!sourceItemId) {
        const failStartedAt = Date.now();
        await this.helper.markItemFailed(
          item.id,
          'Đăng ký không tồn tại hoặc đã hủy',
        );
        itemTiming.failMs += Date.now() - failStartedAt;
        timing.markFailedMs += itemTiming.failMs;
        failCount++;
        this.logger.warn(
          `[CancelBatchItemTiming] batchId=${batchId} item=${item.id} section=${item.classSectionId} FAILED total=${Date.now() - itemStartedAt}ms failWrite=${itemTiming.failMs}ms reason="Đăng ký không tồn tại hoặc đã hủy"`,
        );
        continue;
      }

      try {
        const txnStartedAt = Date.now();
        const slotState = await this.prisma.$transaction(async (tx) => {
          const result = await this.helper.releaseSlot(
            tx,
            item.classSectionId!,
          );

          await tx.outbox.create({
            data: {
              eventType: 'REGISTRATION_CANCELLED',
              payload: {
                userId,
                classSectionId: item.classSectionId,
                semester,
              },
            },
          });

          // Cập nhật item đăng ký gốc → CANCELLED
          await tx.registrationBatchItem.update({
            where: { id: sourceItemId },
            data: {
              status: RegistrationBatchItemStatus.CANCELLED,
              remainingSlots: result.remaining,
              processedAt: new Date(),
            },
          });

          // Cập nhật cancel batch item → SUCCESS
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

        // Cập nhật Redis cache trực tiếp
        const pipeline = this.redis.pipeline();

        const sectionSlotsKey = RegistrationRedisKey.sectionSlots(
          item.classSectionId,
        );
        const sectionInfoKey = RegistrationRedisKey.sectionInfo(
          item.classSectionId,
        );
        pipeline.set(sectionSlotsKey, slotState.remaining.toString());
        pipeline.expire(sectionSlotsKey, PREWARM_CACHE_TTL_SECONDS);

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
          `[CancelBatchItemTiming] batchId=${batchId} item=${item.id} sourceItem=${sourceItemId} section=${item.classSectionId} SUCCESS total=${Date.now() - itemStartedAt}ms dbTxn=${itemTiming.dbTxnMs}ms redis=${itemTiming.redisMs}ms remaining=${slotState.remaining}`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Lỗi xử lý';
        const failStartedAt = Date.now();
        await this.helper.markItemFailed(item.id, reason);
        itemTiming.failMs = Date.now() - failStartedAt;
        timing.markFailedMs += itemTiming.failMs;
        failCount++;
        this.logger.warn(
          `[CancelBatchItemTiming] batchId=${batchId} item=${item.id} section=${item.classSectionId ?? 'null'} FAILED total=${Date.now() - itemStartedAt}ms dbTxn=${itemTiming.dbTxnMs}ms redis=${itemTiming.redisMs}ms failWrite=${itemTiming.failMs}ms reason="${reason}"`,
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
      `[CancelBatch] batchId=${batchId} ${RegistrationBatchStatus.COMPLETED} — success=${successCount} fail=${failCount}`,
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
          batchType: RegistrationBatchType.CANCEL,
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
      `[CancelBatchTiming] batchId=${batchId} total=${Date.now() - processingStartedAt}ms queueWait=${queueWaitMs}ms items=${totalItems} success=${successCount} fail=${failCount} loadPending=${timing.loadPendingItemsMs}ms processItems=${timing.processItemsMs}ms dbTxn=${timing.dbTxnMs}ms redis=${timing.redisMs}ms markFailed=${timing.markFailedMs}ms finalizeBatch=${timing.finalizeBatchMs}ms writeMetrics=${timing.writeMetricsMs}ms`,
    );
  }
}
