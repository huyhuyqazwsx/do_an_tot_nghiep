import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { SettingsService } from '../../settings/settings.service';
import {
  ClassSectionType,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';

@Injectable()
export class RegistrationBatchValidatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  async assertNoPendingBatch(
    userId: string,
    semester: string,
    type?: RegistrationBatchType,
  ) {
    const existing = await this.prisma.registrationBatch.findFirst({
      where: {
        userId,
        semester,
        ...(type ? { type } : {}),
        status: RegistrationBatchStatus.PENDING,
      },
      select: { id: true, type: true, status: true },
    });

    if (existing) {
      throw new ConflictException(
        `Đang có batch ${existing.type} (${existing.status}) chờ xử lý (id: ${existing.id}). Vui lòng đợi hoặc kiểm tra lại.`,
      );
    }
  }

  async assertRegistrationSessionOpen(semester: string) {
    const settings = await this.settingsService.getAll();

    if (semester !== settings.currentSemester) {
      throw new BadRequestException(
        `Kỳ ${semester} không phải kỳ hiện tại (${settings.currentSemester})`,
      );
    }

    const openAt = new Date(settings.registrationOpenAt);
    const closeAt = new Date(settings.registrationCloseAt);

    const now = new Date();
    if (now < openAt) {
      throw new BadRequestException(
        `Kỳ ${semester} chưa đến thời gian đăng ký. Mở từ ${openAt.toISOString()}`,
      );
    }

    if (now > closeAt) {
      throw new BadRequestException(
        `Kỳ ${semester} đã hết thời gian đăng ký. Đóng lúc ${closeAt.toISOString()}`,
      );
    }
  }

  assertLabPairing(
    sections: Array<{
      id: string;
      courseId: string;
      sectionType: string | null;
      requiresLab: boolean;
      sectionCode: string;
    }>,
  ): void {
    const byCourse = new Map<string, typeof sections>();
    for (const s of sections) {
      const group = byCourse.get(s.courseId) ?? [];
      group.push(s);
      byCourse.set(s.courseId, group);
    }

    for (const [, group] of byCourse) {
      // Lớp thực hành / thí nghiệm
      const labSections = group.filter(
        (s) =>
          s.sectionType === ClassSectionType.TN ||
          s.sectionType === ClassSectionType.TH,
      );
      // Lớp lý thuyết đi kèm: nhận diện theo LOẠI lớp (LT / LT_BT / BT), không
      // dựa vào can_tn vì cờ này không nhất quán giữa các môn trong dữ liệu.
      const theorySections = group.filter(
        (s) =>
          s.sectionType === ClassSectionType.LT ||
          s.sectionType === ClassSectionType.LT_BT ||
          s.sectionType === ClassSectionType.BT,
      );
      // Lớp LT được đánh dấu bắt buộc kèm TN/TH (can_tn = true)
      const mainSectionsRequiringLab = group.filter((s) => s.requiresLab);

      // Chiều 1: có lớp LT yêu cầu kèm TN/TH nhưng batch thiếu lớp thực hành
      if (mainSectionsRequiringLab.length > 0 && labSections.length === 0) {
        throw new BadRequestException(
          `Môn ${mainSectionsRequiringLab[0].sectionCode} yêu cầu đăng ký kèm lớp TN/TH. Vui lòng thêm lớp thực hành vào batch.`,
        );
      }

      // Chiều 2: có lớp TN/TH nhưng thiếu lớp lý thuyết tương ứng
      // (kể cả khi sinh viên chỉ đăng ký mỗi lớp thí nghiệm — group chỉ có 1 phần tử)
      if (labSections.length > 0 && theorySections.length === 0) {
        throw new BadRequestException(
          `Lớp TN/TH ${labSections[0].sectionCode} không có lớp lý thuyết tương ứng trong batch.`,
        );
      }
    }
  }

  /**
   * Kiểm tra trùng lịch giữa các buổi học trong batch.
   * Nhận vào allRows (toàn bộ row của tất cả mã lớp, bao gồm nhiều buổi/tuần).
   * Hai buổi bị coi là trùng lịch nếu: cùng dayOfWeek, cùng timeOfDay, và tiết học overlap.
   * Buổi cùng 1 mã lớp (sectionCode) không check vì chú́ng là lịch hợp lệ của cùng 1 lớp.
   */
  assertNoScheduleConflict(
    rows: Array<{
      id: string;
      sectionCode: string;
      dayOfWeek: number | null;
      timeOfDay: string | null;
      startPeriod: number | null;
      endPeriod: number | null;
    }>,
  ): void {
    // Chỉ xét các row có đủ thông tin lịch
    const scheduled = rows.filter(
      (r) =>
        r.dayOfWeek !== null &&
        r.timeOfDay !== null &&
        r.startPeriod !== null &&
        r.endPeriod !== null,
    ) as Array<{
      id: string;
      sectionCode: string;
      dayOfWeek: number;
      timeOfDay: string;
      startPeriod: number;
      endPeriod: number;
    }>;

    // Nhóm theo (dayOfWeek, timeOfDay)
    const bySlot = new Map<string, (typeof scheduled)>();
    for (const row of scheduled) {
      const key = `${row.dayOfWeek}__${row.timeOfDay}`;
      const group = bySlot.get(key) ?? [];
      group.push(row);
      bySlot.set(key, group);
    }

    for (const [, group] of bySlot) {
      if (group.length < 2) continue;

      // So sánh từng cặp — bỏ qua nếu cùng sectionCode
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          if (a.sectionCode === b.sectionCode) continue;

          // Kiểm tra overlap tiết: [a.start, a.end] giao [b.start, b.end]
          const overlaps = a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod;
          if (overlaps) {
            throw new BadRequestException(
              `Trùng lịch giữa lớp ${a.sectionCode} (tiết ${a.startPeriod}–${a.endPeriod}) ` +
                `và lớp ${b.sectionCode} (tiết ${b.startPeriod}–${b.endPeriod}) ` +
                `vào Thứ ${a.dayOfWeek} buổi ${a.timeOfDay}.`,
            );
          }
        }
      }
    }
  }
}
