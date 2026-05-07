import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { RegistrationBatchItemStatus } from '@prisma/client';

@Injectable()
export class RegistrationHelperService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Slot ─────────────────────────────────────────────────────────────────

  /**
   * Tăng sl_dk nếu còn slot, trả về remaining slots.
   * Throws nếu hết chỗ.
   */
  async acquireSlot(
    tx: PrismaService,
    classSectionId: string,
  ): Promise<number> {
    const updated = await tx.$queryRaw<Array<{ remaining: number }>>`
      UPDATE class_sections
      SET sl_dk = sl_dk + 1
      WHERE id = ${classSectionId}::uuid
        AND sl_dk < sl_max
      RETURNING (sl_max - sl_dk) AS remaining
    `;

    if (updated.length === 0) {
      throw new Error('Lớp học đã hết chỗ');
    }

    return updated[0].remaining;
  }

  /**
   * Giảm sl_dk (không xuống dưới 0), trả về remaining slots.
   */
  async releaseSlot(
    tx: PrismaService,
    classSectionId: string,
  ): Promise<number> {
    const updated = await tx.$queryRaw<Array<{ remaining: number }>>`
      UPDATE class_sections
      SET sl_dk = GREATEST(sl_dk - 1, 0)
      WHERE id = ${classSectionId}::uuid
      RETURNING (sl_max - sl_dk) AS remaining
    `;

    return updated[0]?.remaining ?? 0;
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
}

export interface ScheduleInfo {
  dayOfWeek: number | null;
  timeOfDay: string | null;
  startPeriod: number | null;
  endPeriod: number | null;
}
