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

    if (!payloadItems || payloadItems.length === 0) {
      await this.prisma.registrationBatch.update({
        where: { id: batchId },
        data: {
          status: RegistrationBatchStatus.COMPLETED,
          processedAt: new Date(),
        },
      });
      return;
    }

    // Load trạng thái hiện tại của các item để tránh trừ đúp nếu bị crash (idempotency)
    const dbItems = await this.prisma.registrationBatchItem.findMany({
      where: { batchId },
      select: { id: true, status: true },
    });
    const statusMap = new Map(dbItems.map((i) => [i.id, i.status]));

    let successCount = 0;
    let failCount = 0;

    for (const item of payloadItems) {
      if (statusMap.get(item.itemId) !== RegistrationBatchItemStatus.PENDING) {
        continue;
      }

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
