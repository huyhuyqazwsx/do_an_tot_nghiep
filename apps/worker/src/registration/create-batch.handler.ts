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
import {
  RegistrationHelperService,
  type ScheduleInfo,
} from './helpers/registration-helper.service';

type CreateBatchSectionInfo = ScheduleInfo & {
  id: string;
  courseId: string;
  course: {
    code: string;
    name: string;
    prerequisite: string | null;
  };
};

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
  ): Promise<void> {
    this.logger.log(`[CreateBatch] Processing batchId=${batchId}`);

    // 1. Load pending items
    const items =
      payloadItems?.map((item) => ({
        id: item.itemId,
        classSectionId: item.classSectionId,
      })) ??
      (await this.prisma.registrationBatchItem.findMany({
        where: { batchId, status: RegistrationBatchItemStatus.PENDING },
        select: { id: true, classSectionId: true },
      }));

    if (items.length === 0) {
      await this.prisma.registrationBatch.update({
        where: { id: batchId },
        data: {
          status: RegistrationBatchStatus.COMPLETED,
          processedAt: new Date(),
        },
      });
      this.logger.log(
        `[CreateBatch] batchId=${batchId} ${RegistrationBatchStatus.COMPLETED} — success=0 fail=0`,
      );
      return;
    }

    // 2. Load class sections + courses in 1 query
    const classSectionIds = items
      .map((i) => i.classSectionId)
      .filter(Boolean) as string[];

    const sections: CreateBatchSectionInfo[] =
      payloadItems?.map((item) => ({
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
      })) ??
      (await this.prisma.classSection.findMany({
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
      }));
    const sectionMap = new Map(sections.map((s) => [s.id, s]));

    // 3. Load trạng thái đang đăng ký từ ticket SUCCESS mới nhất.
    const successfulItems = await this.prisma.registrationBatchItem.findMany({
      where: {
        status: RegistrationBatchItemStatus.SUCCESS,
        classSectionId: { not: null },
        batch: { userId, semester },
      },
      select: {
        classSectionId: true,
        batch: { select: { type: true } },
        classSection: {
          select: {
            courseId: true,
            dayOfWeek: true,
            timeOfDay: true,
            startPeriod: true,
            endPeriod: true,
          },
        },
      },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const latestBySection = new Map<string, (typeof successfulItems)[number]>();
    for (const item of successfulItems) {
      if (!item.classSectionId || !item.classSection) continue;
      if (!latestBySection.has(item.classSectionId)) {
        latestBySection.set(item.classSectionId, item);
      }
    }

    const existingRegs: Array<ScheduleInfo & { courseId: string }> = [];
    for (const item of latestBySection.values()) {
      if (
        item.batch.type !== RegistrationBatchType.CREATE ||
        !item.classSection
      ) {
        continue;
      }
      existingRegs.push(item.classSection);
    }

    const existingCourseIds = new Set(existingRegs.map((s) => s.courseId));
    const existingSchedule: ScheduleInfo[] = existingRegs;

    // In-memory tracking cho items trong batch
    const batchCourseIds = new Set<string>();
    const batchSchedule: ScheduleInfo[] = [];

    let successCount = 0;
    let failCount = 0;

    // 5. Process từng item
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

      // Validate trùng môn (existing + batch)
      if (existingCourseIds.has(section.courseId)) {
        await this.helper.markItemFailed(
          item.id,
          `Đã đăng ký môn ${section.course.code}`,
        );
        failCount++;
        continue;
      }
      if (batchCourseIds.has(section.courseId)) {
        await this.helper.markItemFailed(
          item.id,
          `Trùng môn ${section.course.code} với lớp khác trong batch`,
        );
        failCount++;
        continue;
      }

      // Validate trùng lịch
      if (
        this.helper.checkScheduleConflict(section, [
          ...existingSchedule,
          ...batchSchedule,
        ])
      ) {
        await this.helper.markItemFailed(item.id, 'Trùng lịch học');
        failCount++;
        continue;
      }

      // Validate tiên quyết
      const hasPrereq = await this.helper.checkPrerequisite(
        userId,
        section.course.prerequisite,
      );
      if (!hasPrereq) {
        await this.helper.markItemFailed(
          item.id,
          `Chưa hoàn thành môn tiên quyết ${section.course.prerequisite}`,
        );
        failCount++;
        continue;
      }

      // Lock slot + ghi kết quả ticket
      try {
        const remainingSlots = await this.prisma.$transaction(async (tx) => {
          const remaining = await this.helper.acquireSlot(
            tx as unknown as PrismaService,
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
              remainingSlots: remaining,
              processedAt: new Date(),
            },
          });

          return remaining;
        });

        // Update in-memory tracking
        batchCourseIds.add(section.courseId);
        batchSchedule.push({
          dayOfWeek: section.dayOfWeek,
          timeOfDay: section.timeOfDay as string | null,
          startPeriod: section.startPeriod,
          endPeriod: section.endPeriod,
        });

        const pipeline = this.redis.pipeline();
        pipeline.del(RegistrationRedisKey.userRegistered(userId, semester));
        pipeline.del(RegistrationRedisKey.userSchedule(userId, semester));
        pipeline.del(RegistrationRedisKey.sectionSlots(item.classSectionId));
        pipeline.del(RegistrationRedisKey.sectionInfo(item.classSectionId));
        await pipeline.exec();

        successCount++;
        this.logger.log(
          `[CreateBatch] item=${item.id} SUCCESS remaining=${remainingSlots}`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Lỗi xử lý';
        await this.helper.markItemFailed(item.id, reason);
        failCount++;
        this.logger.warn(`[CreateBatch] item=${item.id} FAILED: ${reason}`);
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
      `[CreateBatch] batchId=${batchId} ${RegistrationBatchStatus.COMPLETED} — success=${successCount} fail=${failCount}`,
    );
  }
}
