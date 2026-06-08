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

    // ─── Ghi batch processing log vào Redis (thay thế bảng batch_processing_logs) ──────────────
    const processingEndedAt = Date.now();
    const totalItems = successCount + failCount;
    const key = BatchLogRedisKey.entry(semester, batchId);
    await this.redis
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
