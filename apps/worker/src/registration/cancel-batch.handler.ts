import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { REDIS_CLIENT } from '@app/shared';
import { RegistrationRedisKey } from '@app/shared';
import type { RegistrationBatchJobItem } from '@app/shared';
import Redis from 'ioredis';
import {
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';
import { RegistrationHelperService } from './helpers/registration-helper.service';

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
    payloadItems?: RegistrationBatchJobItem[],
  ): Promise<void> {
    this.logger.log(`[CancelBatch] Processing batchId=${batchId}`);

    const items =
      payloadItems?.map((item) => ({
        id: item.itemId,
        classSectionId: item.classSectionId,
      })) ??
      (await this.prisma.registrationBatchItem.findMany({
        where: { batchId, status: RegistrationBatchItemStatus.PENDING },
        select: { id: true, classSectionId: true },
      }));

    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      if (!item.classSectionId) {
        await this.helper.markItemFailed(item.id, 'Thiếu classSectionId');
        failCount++;
        continue;
      }

      try {
        const latestItem = await this.prisma.registrationBatchItem.findFirst({
          where: {
            classSectionId: item.classSectionId,
            status: RegistrationBatchItemStatus.SUCCESS,
            batch: { userId, semester },
          },
          select: {
            batch: { select: { type: true } },
          },
          orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
        });

        if (latestItem?.batch.type !== RegistrationBatchType.CREATE) {
          throw new Error('Đăng ký không tồn tại hoặc đã hủy');
        }

        const remainingSlots = await this.prisma.$transaction(async (tx) => {
          const remainingSlots = await this.helper.releaseSlot(
            tx as unknown as PrismaService,
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

          await tx.registrationBatchItem.update({
            where: { id: item.id },
            data: {
              status: RegistrationBatchItemStatus.SUCCESS,
              remainingSlots,
              processedAt: new Date(),
            },
          });

          return remainingSlots;
        });

        const pipeline = this.redis.pipeline();
        pipeline.del(RegistrationRedisKey.userRegistered(userId, semester));
        pipeline.del(RegistrationRedisKey.userSchedule(userId, semester));
        pipeline.del(RegistrationRedisKey.sectionSlots(item.classSectionId));
        pipeline.del(RegistrationRedisKey.sectionInfo(item.classSectionId));
        await pipeline.exec();

        successCount++;
        this.logger.log(
          `[CancelBatch] item=${item.id} SUCCESS remaining=${remainingSlots}`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Lỗi xử lý';
        await this.helper.markItemFailed(item.id, reason);
        failCount++;
        this.logger.warn(`[CancelBatch] item=${item.id} FAILED: ${reason}`);
      }
    }

    await this.prisma.registrationBatch.update({
      where: { id: batchId },
      data: {
        status: RegistrationBatchStatus.COMPLETED,
        processedAt: new Date(),
      },
    });

    this.logger.log(
      `[CancelBatch] batchId=${batchId} ${RegistrationBatchStatus.COMPLETED} — success=${successCount} fail=${failCount}`,
    );
  }
}
