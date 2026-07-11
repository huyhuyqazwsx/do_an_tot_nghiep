import { Injectable } from '@nestjs/common';
import { PrismaService, weekRangesOverlap } from '@app/shared';
import { Prisma, RegistrationBatchItemStatus } from '@prisma/client';
import type { ScheduleInfo } from '../types/registration-worker.types';

type SlotMutationResult = {
  remaining: number;
  registeredCount: number;
};

@Injectable()
export class RegistrationHelperService {
  constructor(private readonly prisma: PrismaService) { }

  // ─── Slot ─────────────────────────────────────────────────────────────────

  /**
   * Tăng sl_dk nếu còn slot, trả về remaining slots.
   * Throws nếu hết chỗ.
   */
  async acquireSlot(
    tx: Prisma.TransactionClient,
    classSectionId: string,
  ): Promise<SlotMutationResult> {
    const updated = await tx.$queryRaw<
      Array<{ remaining: number; registered_count: number }>
    >`
      UPDATE class_sections
      SET sl_dk = sl_dk + 1
      WHERE id = ${classSectionId}::uuid
        AND sl_dk < sl_max
      RETURNING (sl_max - sl_dk) AS remaining, sl_dk AS registered_count
    `;

    if (updated.length === 0) {
      throw new Error('Lớp học đã hết chỗ');
    }

    return {
      remaining: updated[0].remaining,
      registeredCount: updated[0].registered_count,
    };
  }

  /**
   * Giảm sl_dk (không xuống dưới 0), trả về remaining slots.
   */
  async releaseSlot(
    tx: Prisma.TransactionClient,
    classSectionId: string,
  ): Promise<SlotMutationResult> {
    const updated = await tx.$queryRaw<
      Array<{ remaining: number; registered_count: number }>
    >`
      UPDATE class_sections
      SET sl_dk = GREATEST(sl_dk - 1, 0)
      WHERE id = ${classSectionId}::uuid
      RETURNING (sl_max - sl_dk) AS remaining, sl_dk AS registered_count
    `;

    return {
      remaining: updated[0]?.remaining ?? 0,
      registeredCount: updated[0]?.registered_count ?? 0,
    };
  }

  // ─── Schedule conflict ─────────────────────────────────────────────────────

  /**
   * Kiểm tra trùng lịch: so sánh section mới với danh sách lịch đã có.
   * Trả về true nếu trùng.
   */
  checkScheduleConflict(
    section: ScheduleInfo,
    existing: ScheduleInfo[],
  ): boolean {
    if (!section.dayOfWeek || !section.startPeriod || !section.endPeriod) {
      return false; // Không có lịch cụ thể → bỏ qua
    }

    return existing.some(
      (s) =>
        s.dayOfWeek === section.dayOfWeek &&
        s.timeOfDay === section.timeOfDay &&
        weekRangesOverlap(s.weekRange, section.weekRange) &&
        s.startPeriod !== null &&
        s.endPeriod !== null &&
        s.startPeriod <= section.endPeriod! &&
        s.endPeriod >= section.startPeriod!,
    );
  }

  // ─── Prerequisite ──────────────────────────────────────────────────────────

  /**
   * Kiểm tra môn tiên quyết. Trả về true nếu đã pass hoặc không có tiên quyết.
   */
  async checkPrerequisite(
    userId: string,
    prerequisiteCourseCode: string | null,
  ): Promise<boolean> {
    if (!prerequisiteCourseCode) return true;

    const prereqCourse = await this.prisma.course.findUnique({
      where: { code: prerequisiteCourseCode },
      select: { id: true },
    });
    if (!prereqCourse) return true; // Không tìm thấy môn → bỏ qua

    const grade = await this.prisma.studentGrade.findFirst({
      where: {
        userId,
        courseId: prereqCourse.id,
        gradeLetter: { not: 'F' },
      },
      select: { id: true },
    });

    return grade !== null;
  }

  // ─── Batch item status ─────────────────────────────────────────────────────

  async markItemFailed(itemId: string, reason: string): Promise<void> {
    await this.prisma.registrationBatchItem.update({
      where: { id: itemId },
      data: {
        status: RegistrationBatchItemStatus.FAILED,
        failureReason: reason,
        processedAt: new Date(),
      },
    });
  }

  // ─── CTE optimized methods (1 query = acquireSlot + markSuccess) ────────────

  /**
   * Gộp acquireSlot + markSuccess thành 1 câu SQL CTE duy nhất.
   * Giảm từ 4 DB round-trips (BEGIN + UPDATE + UPDATE + COMMIT) → 1 round-trip.
   * Postgres đảm bảo atomic trong 1 statement.
   */
  async acquireSlotAndMarkSuccess(
    itemId: string,
    classSectionId: string,
  ): Promise<{ remaining: number }> {
    const result = await this.prisma.$queryRaw<
      Array<{ remaining: number }>
    >`
      WITH slot AS (
        UPDATE class_sections
        SET sl_dk = sl_dk + 1
        WHERE id = ${classSectionId}::uuid
          AND sl_dk < sl_max
        RETURNING (sl_max - sl_dk) AS remaining
      )
      UPDATE registration_batch_items
      SET status = 'SUCCESS',
          remaining_slots = (SELECT remaining FROM slot),
          processed_at = NOW()
      WHERE id = ${itemId}::uuid
        AND EXISTS (SELECT 1 FROM slot)
      RETURNING (SELECT remaining FROM slot) AS remaining
    `;

    if (result.length === 0) {
      throw new Error('Lớp học đã hết chỗ');
    }

    return { remaining: result[0].remaining };
  }

  /**
   * Gộp releaseSlot + mark source CANCELLED + mark cancel item SUCCESS thành 1 CTE.
   * Dùng cho Cancel batch — 1 query thay vì 5 round-trips.
   */
  async releaseSlotAndMarkItems(
    cancelItemId: string,
    classSectionId: string,
    sourceItemId: string,
  ): Promise<{ remaining: number }> {
    const result = await this.prisma.$queryRaw<
      Array<{ remaining: number }>
    >`
      WITH slot AS (
        UPDATE class_sections
        SET sl_dk = GREATEST(sl_dk - 1, 0)
        WHERE id = ${classSectionId}::uuid
        RETURNING (sl_max - sl_dk) AS remaining
      ),
      cancel_source AS (
        UPDATE registration_batch_items
        SET status = 'CANCELLED',
            remaining_slots = (SELECT remaining FROM slot),
            processed_at = NOW()
        WHERE id = ${sourceItemId}::uuid
      )
      UPDATE registration_batch_items
      SET status = 'SUCCESS',
          remaining_slots = (SELECT remaining FROM slot),
          processed_at = NOW()
      WHERE id = ${cancelItemId}::uuid
      RETURNING (SELECT remaining FROM slot) AS remaining
    `;

    return { remaining: result[0]?.remaining ?? 0 };
  }
}
