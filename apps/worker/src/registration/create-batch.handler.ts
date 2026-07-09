import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService, REDIS_CLIENT, BatchLogRedisKey } from '@app/shared';
import type { CreateRegistrationBatchJobItem } from '@app/shared';
import {
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';
import type Redis from 'ioredis';
import { RegistrationHelperService } from './helpers/registration-helper.service';
import type { CreateBatchSectionInfo } from './types/registration-worker.types';

@Injectable()
export class CreateBatchHandler {
  private readonly logger = new Logger(CreateBatchHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: RegistrationHelperService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) { }

  async handle(
    batchId: string,
    userId: string,
    semester: string,
    payloadItems?: CreateRegistrationBatchJobItem[],
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
    items: CreateRegistrationBatchJobItem[],
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

      try {
        await this.helper.acquireSlotAndMarkSuccess(item.itemId, item.classSectionId);
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
    payloadItems: CreateRegistrationBatchJobItem[] | undefined,
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

    if (items.length === 0) {
      await this.prisma.registrationBatch.update({
        where: { id: batchId },
        data: {
          status: RegistrationBatchStatus.COMPLETED,
          processedAt: new Date(),
        },
      });
      return;
    }

    // Load class sections + courses
    const classSectionIds = items
      .map((i) => i.classSectionId)
      .filter(Boolean) as string[];

    const payloadItemsBySectionId = new Map(
      (payloadItems ?? []).map((item) => [item.classSectionId, item]),
    );
    const hasPayloadForAllSections = classSectionIds.every((id) =>
      payloadItemsBySectionId.has(id),
    );
    const sections: CreateBatchSectionInfo[] = hasPayloadForAllSections
      ? classSectionIds.map((classSectionId) => {
        const item = payloadItemsBySectionId.get(classSectionId)!;
        return {
          id: item.classSectionId,
          courseId: item.courseId,
          dayOfWeek: item.dayOfWeek,
          timeOfDay: item.timeOfDay,
          startPeriod: item.startPeriod,
          endPeriod: item.endPeriod,
          weekRange: item.weekRange,
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
          weekRange: true,
          course: {
            select: { code: true, name: true, prerequisite: true },
          },
        },
      });
    const sectionMap = new Map(sections.map((s) => [s.id, s]));

    let successCount = 0;
    let failCount = 0;

    // Process từng item
    for (const item of items) {
      if (!item.classSectionId) {
        await this.helper.markItemFailed(item.id, 'Thiếu classSectionId');
        failCount++;
        continue;
      }

      const section = sectionMap.get(item.classSectionId);
      if (!section) {
        await this.helper.markItemFailed(item.id, 'Lớp học phần không tồn tại');
        failCount++;
        continue;
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          const result = await this.helper.acquireSlot(
            tx,
            item.classSectionId!,
          );

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
        'batchType', RegistrationBatchType.CREATE,
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
        this.logger.warn(`[CreateBatch] Redis log write failed: ${err.message}`),
      );
  }
}
