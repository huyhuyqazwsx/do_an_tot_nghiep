import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { JwtPayload } from '@app/shared';
import {
  PrismaService,
  RabbitmqPublisherService,
  type RegistrationBatchJobPayload,
  RegistrationQueueEvent,
} from '@app/shared';
import {
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';
import type { CreateRegistrationBatchDto } from './dto/create-registration-batch.dto';
import type { CancelRegistrationBatchDto } from './dto/cancel-registration-batch.dto';
import { RegistrationBatchValidatorService } from './helpers/registration-batch-validator.service';

@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: RabbitmqPublisherService,
    private readonly batchValidator: RegistrationBatchValidatorService,
  ) {}

  // ─── CREATE BATCH ────────────────────────────────────────────────────────────

  async createBatch(user: JwtPayload, dto: CreateRegistrationBatchDto) {
    const { semester, classSectionIds } = dto;
    const userId = user.sub;

    await this.batchValidator.assertRegistrationSessionOpen(semester);
    await this.batchValidator.assertNoPendingBatch(userId, semester);

    const sections = await this.prisma.classSection.findMany({
      where: { id: { in: classSectionIds }, semester },
      select: {
        id: true,
        courseId: true,
        sectionType: true,
        requiresLab: true,
        linkedSectionCode: true,
        sectionCode: true,
        sectionStatus: true,
        dayOfWeek: true,
        timeOfDay: true,
        startPeriod: true,
        endPeriod: true,
        course: { select: { code: true, name: true, prerequisite: true } },
      },
    });

    if (sections.length !== classSectionIds.length) {
      const foundIds = new Set(sections.map((s) => s.id));
      const missing = classSectionIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(
        `Lớp học phần không tồn tại hoặc không thuộc kỳ ${semester}: ${missing.join(', ')}`,
      );
    }

    const invalidStatus = sections.filter(
      (s) =>
        s.sectionStatus === 'CANCELLED' ||
        s.sectionStatus === 'REGISTRATION_CLOSED',
    );
    if (invalidStatus.length > 0) {
      throw new BadRequestException(
        `Lớp không thể đăng ký (đã huỷ/đóng): ${invalidStatus.map((s) => s.sectionCode).join(', ')}`,
      );
    }

    // 2c. Validate can_tn: nếu có LT+BT requiresLab=true thì batch phải có lớp TN cùng môn
    await this.batchValidator.assertLabSectionsPresent(
      userId,
      semester,
      sections,
    );

    // 3. Tạo batch + items trong transaction
    const { batch, items } = await this.prisma.$transaction(async (tx) => {
      const createdBatch = await tx.registrationBatch.create({
        data: {
          userId,
          semester,
          type: RegistrationBatchType.CREATE,
          status: RegistrationBatchStatus.PENDING,
          totalItems: classSectionIds.length,
        },
      });

      const createdItems = await Promise.all(
        classSectionIds.map((classSectionId) =>
          tx.registrationBatchItem.create({
            data: {
              batchId: createdBatch.id,
              classSectionId,
              status: RegistrationBatchItemStatus.PENDING,
            },
            select: { id: true, classSectionId: true },
          }),
        ),
      );

      return { batch: createdBatch, items: createdItems };
    });

    const sectionsById = new Map(
      sections.map((section) => [section.id, section]),
    );

    // 4. Publish event lên queue
    const payload: RegistrationBatchJobPayload = {
      type: RegistrationQueueEvent.CREATE_BATCH_REQUESTED,
      batchId: batch.id,
      userId,
      semester,
      items: items.map((item) => {
        const section = sectionsById.get(item.classSectionId!);
        if (!section) {
          throw new BadRequestException(
            `Lớp học phần không tồn tại: ${item.classSectionId}`,
          );
        }

        return {
          itemId: item.id,
          classSectionId: item.classSectionId!,
          courseId: section.courseId,
          courseCode: section.course.code,
          courseName: section.course.name,
          prerequisite: section.course.prerequisite,
          dayOfWeek: section.dayOfWeek,
          timeOfDay: section.timeOfDay,
          startPeriod: section.startPeriod,
          endPeriod: section.endPeriod,
        };
      }),
    };
    await this.publisher.publishToQueue(payload);

    this.logger.log(
      `[CreateBatch] batchId=${batch.id} userId=${userId} semester=${semester} items=${classSectionIds.length}`,
    );

    // 5. Trả về batch + items để FE polling
    return this.findBatchById(batch.id, userId);
  }

  // ─── CANCEL BATCH ────────────────────────────────────────────────────────────

  async cancelBatch(user: JwtPayload, dto: CancelRegistrationBatchDto) {
    const { classSectionIds } = dto;
    const userId = user.sub;

    const sections = await this.prisma.classSection.findMany({
      where: { id: { in: classSectionIds } },
      select: {
        id: true,
        semester: true,
        sectionCode: true,
      },
    });

    if (sections.length !== classSectionIds.length) {
      const foundIds = new Set(sections.map((s) => s.id));
      const missing = classSectionIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(
        `Không tìm thấy lớp học phần: ${missing.join(', ')}`,
      );
    }

    // Kiểm tra tất cả cùng semester
    const semesters = [...new Set(sections.map((s) => s.semester))];
    if (semesters.length > 1) {
      throw new BadRequestException(
        'Không thể hủy đăng ký của nhiều học kỳ khác nhau trong cùng 1 batch',
      );
    }
    const semester = semesters[0];

    await this.batchValidator.assertRegistrationSessionOpen(semester);

    const activeItems = await this.findActiveRegistrationItems(
      userId,
      semester,
      classSectionIds,
    );
    const activeClassSectionIds = new Set(
      activeItems.map((item) => item.classSectionId),
    );
    const inactiveSections = sections.filter(
      (section) => !activeClassSectionIds.has(section.id),
    );
    if (inactiveSections.length > 0) {
      throw new BadRequestException(
        `Chỉ có thể hủy lớp đang đăng ký: ${inactiveSections.map((s) => s.sectionCode).join(', ')}`,
      );
    }

    // 2. Kiểm tra không có batch cancel PENDING đang chờ
    await this.batchValidator.assertNoPendingBatch(
      userId,
      semester,
      RegistrationBatchType.CANCEL,
    );

    // 3. Tạo cancel batch + items
    const { batch, items } = await this.prisma.$transaction(async (tx) => {
      const createdBatch = await tx.registrationBatch.create({
        data: {
          userId,
          semester,
          type: RegistrationBatchType.CANCEL,
          status: RegistrationBatchStatus.PENDING,
          totalItems: classSectionIds.length,
        },
      });

      const createdItems = await Promise.all(
        classSectionIds.map((classSectionId) =>
          tx.registrationBatchItem.create({
            data: {
              batchId: createdBatch.id,
              classSectionId,
              status: RegistrationBatchItemStatus.PENDING,
            },
            select: { id: true, classSectionId: true },
          }),
        ),
      );

      return { batch: createdBatch, items: createdItems };
    });

    // 4. Publish event
    const payload: RegistrationBatchJobPayload = {
      type: RegistrationQueueEvent.CANCEL_BATCH_REQUESTED,
      batchId: batch.id,
      userId,
      semester,
      items: items.map((item) => ({
        itemId: item.id,
        classSectionId: item.classSectionId!,
      })),
    };
    await this.publisher.publishToQueue(payload);

    this.logger.log(
      `[CancelBatch] batchId=${batch.id} userId=${userId} semester=${semester} items=${classSectionIds.length}`,
    );

    return this.findBatchById(batch.id, userId);
  }

  // ─── READ: My Registrations ───────────────────────────────────────────────────

  async getMyRegistrations(user: JwtPayload, semester: string) {
    const activeItems = await this.findActiveRegistrationItems(
      user.sub,
      semester,
    );

    return activeItems.map((item) => ({
      id: item.classSectionId,
      batchItemId: item.id,
      status: 'ACTIVE',
      registeredAt: item.processedAt ?? item.createdAt,
      cancelledAt: null,
      classSection: item.classSection,
    }));
  }

  // ─── READ: Batch Detail ───────────────────────────────────────────────────────

  async findBatchById(batchId: string, userId: string) {
    const batch = await this.prisma.registrationBatch.findFirst({
      where: { id: batchId, userId },
      include: {
        items: {
          include: {
            classSection: {
              select: {
                id: true,
                sectionCode: true,
                sectionType: true,
                course: {
                  select: { id: true, code: true, name: true, credits: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} không tồn tại`);
    }

    return batch;
  }

  // ─── READ: Admin ──────────────────────────────────────────────────────────────

  async adminGetRegistrations(semester: string, studentCode?: string) {
    const successfulItems = await this.prisma.registrationBatchItem.findMany({
      where: {
        status: RegistrationBatchItemStatus.SUCCESS,
        classSectionId: { not: null },
        batch: {
          semester,
          ...(studentCode ? { user: { studentCode } } : {}),
        },
      },
      select: {
        id: true,
        classSectionId: true,
        processedAt: true,
        createdAt: true,
        batch: {
          select: {
            type: true,
            user: { select: { id: true, studentCode: true, name: true } },
          },
        },
        classSection: {
          select: {
            id: true,
            sectionCode: true,
            sectionType: true,
            course: {
              select: { id: true, code: true, name: true, credits: true },
            },
          },
        },
      },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const latestByUserAndSection = new Map<
      string,
      (typeof successfulItems)[number]
    >();
    for (const item of successfulItems) {
      if (!item.classSectionId) continue;
      const key = `${item.batch.user.id}:${item.classSectionId}`;
      if (!latestByUserAndSection.has(key)) {
        latestByUserAndSection.set(key, item);
      }
    }

    return [...latestByUserAndSection.values()]
      .filter((item) => item.batch.type === RegistrationBatchType.CREATE)
      .map((item) => ({
        id: item.classSectionId,
        batchItemId: item.id,
        status: 'ACTIVE',
        registeredAt: item.processedAt ?? item.createdAt,
        cancelledAt: null,
        user: item.batch.user,
        classSection: item.classSection,
      }));
  }

  private async findActiveRegistrationItems(
    userId: string,
    semester: string,
    classSectionIds?: string[],
  ) {
    const successfulItems = await this.prisma.registrationBatchItem.findMany({
      where: {
        status: RegistrationBatchItemStatus.SUCCESS,
        classSectionId: classSectionIds
          ? { in: classSectionIds }
          : { not: null },
        batch: { userId, semester },
      },
      select: {
        id: true,
        classSectionId: true,
        processedAt: true,
        createdAt: true,
        batch: { select: { type: true } },
        classSection: {
          select: {
            id: true,
            sectionCode: true,
            semester: true,
            dayOfWeek: true,
            timeOfDay: true,
            startPeriod: true,
            endPeriod: true,
            timeRange: true,
            weekRange: true,
            room: true,
            sectionType: true,
            maxCapacity: true,
            registeredCount: true,
            course: {
              select: { id: true, code: true, name: true, credits: true },
            },
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

    return [...latestBySection.values()].filter(
      (item) => item.batch.type === RegistrationBatchType.CREATE,
    );
  }
}
