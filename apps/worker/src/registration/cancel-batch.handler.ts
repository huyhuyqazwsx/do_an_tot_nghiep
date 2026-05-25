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
    payloadItems?: RegistrationBatchJobItem[],
  ): Promise<void> {
    this.logger.log(`[CancelBatch] Processing batchId=${batchId}`);

    // 1. Tạo batch nếu chưa tồn tại
    const existingBatch = await this.prisma.registrationBatch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    if (!existingBatch) {
      await this.prisma.registrationBatch.create({
        data: {
          id: batchId,
          userId,
          semester,
          type: RegistrationBatchType.CANCEL,
          status: RegistrationBatchStatus.PENDING,
          totalItems: payloadItems?.length ?? 0,
        },
      });
    }

    // 2. Tạo batch items nếu chưa tồn tại (để hỗ trợ retry khi job bị redeliver)
    const existingItems = await this.prisma.registrationBatchItem.findMany({
      where: { batchId },
      select: { id: true },
    });
    if (existingItems.length === 0 && payloadItems && payloadItems.length > 0) {
      await this.prisma.registrationBatchItem.createMany({
        data: payloadItems.map((item) => ({
          batchId,
          classSectionId: item.classSectionId,
          status: RegistrationBatchItemStatus.PENDING,
        })),
      });
    }

    // 3. Lấy danh sách items cần xử lý
    const items = await this.prisma.registrationBatchItem.findMany({
      where: { batchId, status: RegistrationBatchItemStatus.PENDING },
      select: { id: true, classSectionId: true },
      orderBy: { createdAt: 'asc' },
    });

    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      if (!item.classSectionId) {
        await this.helper.markItemFailed(item.id, 'Thiếu classSectionId');
        failCount++;
        continue;
      }

      try {
        // Tìm item đăng ký gốc (CREATE) đang SUCCESS cần hủy
        const currentItem = await this.prisma.registrationBatchItem.findFirst({
          where: {
            classSectionId: item.classSectionId,
            status: RegistrationBatchItemStatus.SUCCESS,
            batch: { userId, semester, type: RegistrationBatchType.CREATE },
          },
          select: {
            id: true,
            classSection: {
              select: {
                dayOfWeek: true,
                timeOfDay: true,
                startPeriod: true,
                endPeriod: true,
              },
            },
          },
        });

        if (!currentItem) {
          throw new Error('Đăng ký không tồn tại hoặc đã hủy');
        }

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
            where: { id: currentItem.id },
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

        // Cập nhật Redis cache trực tiếp (ngược với create-batch)
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

        await pipeline.exec();

        successCount++;
        this.logger.log(
          `[CancelBatch] item=${currentItem.id} SUCCESS remaining=${slotState.remaining}`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Lỗi xử lý';
        await this.helper.markItemFailed(item.id, reason);
        failCount++;
        this.logger.warn(
          `[CancelBatch] classSectionId=${item.classSectionId ?? 'null'} FAILED: ${reason}`,
        );
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
