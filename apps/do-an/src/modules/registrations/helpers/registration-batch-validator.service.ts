import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '@app/shared';
import {
  ClassSectionType,
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';

type LabValidationSection = {
  id: string;
  courseId: string;
  sectionType: string | null;
  requiresLab: boolean;
  sectionCode: string;
};

@Injectable()
export class RegistrationBatchValidatorService {
  constructor(private readonly prisma: PrismaService) {}

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
    const session = await this.prisma.registrationSession.findFirst({
      where: { semester },
      select: {
        semester: true,
        openAt: true,
        closeAt: true,
        isActive: true,
      },
    });

    if (!session) {
      throw new BadRequestException(
        `Kỳ ${semester} chưa được cấu hình thời gian đăng ký`,
      );
    }

    if (!session.isActive) {
      throw new BadRequestException(`Kỳ ${semester} chưa mở đăng ký`);
    }

    const now = new Date();
    if (now < session.openAt) {
      throw new BadRequestException(
        `Kỳ ${semester} chưa đến thời gian đăng ký. Mở từ ${session.openAt.toISOString()}`,
      );
    }

    if (now > session.closeAt) {
      throw new BadRequestException(
        `Kỳ ${semester} đã hết thời gian đăng ký. Đóng lúc ${session.closeAt.toISOString()}`,
      );
    }
  }

  async assertLabSectionsPresent(
    userId: string,
    semester: string,
    sections: LabValidationSection[],
  ) {
    const sectionsByCourse = new Map<string, LabValidationSection[]>();
    for (const section of sections) {
      const courseSections = sectionsByCourse.get(section.courseId) ?? [];
      courseSections.push(section);
      sectionsByCourse.set(section.courseId, courseSections);
    }

    const missingLabByCourse = new Map<string, LabValidationSection>();
    for (const [courseId, courseSections] of sectionsByCourse) {
      const mainSections = courseSections.filter((s) => s.requiresLab);
      if (mainSections.length === 0) continue;

      const hasLabInBatch = courseSections.some(
        (s) =>
          s.sectionType === ClassSectionType.TN ||
          s.sectionType === ClassSectionType.TH,
      );
      if (!hasLabInBatch) {
        missingLabByCourse.set(courseId, mainSections[0]);
      }
    }

    if (missingLabByCourse.size === 0) return;

    const successfulLabItems = await this.prisma.registrationBatchItem.findMany(
      {
        where: {
          status: RegistrationBatchItemStatus.SUCCESS,
          batch: { userId, semester },
          classSection: {
            courseId: { in: [...missingLabByCourse.keys()] },
            sectionType: { in: [ClassSectionType.TN, ClassSectionType.TH] },
          },
        },
        select: {
          classSectionId: true,
          batch: { select: { type: true } },
          classSection: { select: { courseId: true } },
        },
        orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
      },
    );

    const latestBySection = new Map<
      string,
      (typeof successfulLabItems)[number]
    >();
    for (const item of successfulLabItems) {
      if (!item.classSectionId || !item.classSection) continue;
      if (!latestBySection.has(item.classSectionId)) {
        latestBySection.set(item.classSectionId, item);
      }
    }

    for (const item of latestBySection.values()) {
      if (
        item.batch.type === RegistrationBatchType.CREATE &&
        item.classSection
      ) {
        missingLabByCourse.delete(item.classSection.courseId);
      }
    }

    const [missingSection] = missingLabByCourse.values();
    if (missingSection) {
      throw new BadRequestException(
        `Môn ${missingSection.sectionCode} yêu cầu đăng ký kèm lớp TN/TH. Vui lòng thêm lớp thực hành vào batch.`,
      );
    }
  }
}
