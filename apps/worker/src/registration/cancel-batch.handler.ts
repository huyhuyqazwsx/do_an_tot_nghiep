import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService, REDIS_CLIENT, BatchLogRedisKey } from '@app/shared';
import type { CancelRegistrationBatchJobItem } from '@app/shared';
import {
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';
import type Redis from 'ioredis';
import { RegistrationHelperService } from './helpers/registration-helper.service';

@Injectable()
export class CancelBatchHandler {
  private readonly logger = new Logger(CancelBatchHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: RegistrationHelperService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) { }

  async handle(
    batchId: string,
    userId: string,
    semester: string,
    payloadItems?: CancelRegistrationBatchJobItem[],
    queuedAt?: string,
  ): Promise<void> {
    const processingStartedAt = Date.now();
    const queueWaitMs = queuedAt
      ? Math.max(processingStartedAt - new Date(queuedAt).getTime(), 0)
      : 0;

    // ─── Fast path: payload có itemId → dùng CTE, không cần query DB ────────
    const hasItemIds = payloadItems?.length && payloadItems.every((i) => i.itemId);

    if (hasItemIds) {
      return this.handleOptimized(batchId, semester, payloadItems!, processingStartedAt, queueWaitMs);
    }

    // ─── Fallback path: message cũ không có itemId → logic cũ ───────────────
    return this.handleLegacy(batchId, userId, semester, payloadItems, processingStartedAt, queueWaitMs);
  }

  /**
   * Optimized path: dùng CTE — 1 DB round-trip / item, không cần findMany.
   */
  private async handleOptimized(
    batchId: string,
    semester: string,
    items: CancelRegistrationBatchJobItem[],
    processingStartedAt: number,
    queueWaitMs: number,
  ): Promise<void> {
    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      if (!item.classSectionId || !item.itemId) {
        await this.helper.markItemFailed(item.itemId, 'Thiếu classSectionId hoặc itemId');
        failCount++;
        continue;
      }

      if (!item.sourceItemId) {
        await this.helper.markItemFailed(item.itemId, 'Đăng ký không tồn tại hoặc đã hủy');
        failCount++;
        continue;
      }

      try {
        await this.helper.releaseSlotAndMarkItems(
          item.itemId,
          item.classSectionId,
          item.sourceItemId,
        );
        successCount++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Lỗi xử lý';
        await this.helper.markItemFailed(item.itemId, reason);
        failCount++;
      }
    }

    await this.prisma.registrationBatch.update({
      where: { id: batchId },
      data: {
        status: RegistrationBatchStatus.COMPLETED,
        processedAt: new Date(),
      },
    });

    this.writeBatchLog(batchId, semester, queueWaitMs, processingStartedAt, successCount, failCount);
  }

  /**
   * Legacy path: message cũ chưa có itemId — giữ nguyên logic findMany + $transaction.
   */
  private async handleLegacy(
    batchId: string,
    userId: string,
    semester: string,
    payloadItems: CancelRegistrationBatchJobItem[] | undefined,
    processingStartedAt: number,
    queueWaitMs: number,
  ): Promise<void> {
    // Batch + items đã được API tạo sẵn trong DB trước khi publish.
    // Chỉ cần load items PENDING để xử lý.
    const items = await this.prisma.registrationBatchItem.findMany({
      where: { batchId, status: RegistrationBatchItemStatus.PENDING },
      select: { id: true, classSectionId: true },
      orderBy: { createdAt: 'asc' },
    });

    // Build sourceItemId map từ payload (API đã gửi kèm)
    const sourceItemMap = new Map(
      (payloadItems ?? []).map((item) => [
        item.classSectionId,
        item.sourceItemId,
      ]),
    );

    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      if (!item.classSectionId) {
        await this.helper.markItemFailed(item.id, 'Thiếu classSectionId');
        failCount++;
        continue;
      }

      // Lookup sourceItemId từ payload — O(1)
      const sourceItemId = sourceItemMap.get(item.classSectionId);
      if (!sourceItemId) {
        await this.helper.markItemFailed(
          item.id,
          'Đăng ký không tồn tại hoặc đã hủy',
        );
        failCount++;
        continue;
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          const result = await this.helper.releaseSlot(
            tx,
            item.classSectionId!,
          );

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

        successCount++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Lỗi xử lý';
        await this.helper.markItemFailed(item.id, reason);
        failCount++;
      }
    }

    await this.prisma.registrationBatch.update({
      where: { id: batchId },
      data: {
        status: RegistrationBatchStatus.COMPLETED,
        processedAt: new Date(),
      },
    });

    this.writeBatchLog(batchId, semester, queueWaitMs, processingStartedAt, successCount, failCount);
  }

  // ─── Ghi batch processing log vào Redis ──────────────────────────────────────
  private writeBatchLog(
    batchId: string,
    semester: string,
    queueWaitMs: number,
    processingStartedAt: number,
    successCount: number,
    failCount: number,
  ): void {
    const processingEndedAt = Date.now();
    const totalItems = successCount + failCount;
    const key = BatchLogRedisKey.entry(semester, batchId);
    this.redis
      .pipeline()
      .hset(key,
        'batchType', RegistrationBatchType.CANCEL,
        'queueWaitMs', queueWaitMs.toString(),
        'processingDurationMs', (processingEndedAt - processingStartedAt).toString(),
        'totalItems', totalItems.toString(),
        'successItems', successCount.toString(),
        'failedItems', failCount.toString(),
        'createdAtMs', processingEndedAt.toString(),
      )
      .expire(key, BatchLogRedisKey.TTL_SECONDS)
      .exec()
      .catch((err: Error) =>
        this.logger.warn(`[CancelBatch] Redis log write failed: ${err.message}`),
      );
  }
}
