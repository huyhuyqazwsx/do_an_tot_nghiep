import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { JwtPayload } from '@app/shared';
import {
  PrismaService,
  RabbitmqPublisherService,
  REDIS_CLIENT,
  RegistrationRedisKey,
  type RegistrationBatchJobPayload,
  RegistrationQueueEvent,
} from '@app/shared';
import {
  Prisma,
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
  RegistrationBatchType,
} from '@prisma/client';
import type Redis from 'ioredis';
import type { CreateRegistrationBatchDto } from './dto/create-registration-batch.dto';
import type { CancelRegistrationBatchDto } from './dto/cancel-registration-batch.dto';
import { RegistrationBatchValidatorService } from './helpers/registration-batch-validator.service';
import { SettingsService } from '../settings/settings.service';

const CLASS_SECTION_LOOKUP_CACHE_TTL_SECONDS = 30 * 60;

type ResolvedSectionRow = Prisma.ClassSectionGetPayload<{
  include: { course: true };
}>;

type CachedSectionByCodeResponse = {
  items: ResolvedSectionRow[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: RabbitmqPublisherService,
    private readonly batchValidator: RegistrationBatchValidatorService,
    private readonly settingsService: SettingsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async resolveSectionCodes(
    sectionCodes: string[],
    semester: string,
  ): Promise<Map<string, ResolvedSectionRow[]>> {
    const bySectionCode = new Map<string, ResolvedSectionRow[]>();
    const missedCodes: string[] = [];

    // 1. Đọc cache theo mã lớp trước (reg:section:code) — cache đã chứa đầy đủ
    //    thông tin lớp kèm id (UUID), nhờ đó hàm trừ slot dùng được uuid mà
    //    không phải truy vấn DB ở đường nóng.
    for (const sectionCode of sectionCodes) {
      const cached = await this.readSectionByCodeCache(semester, sectionCode);
      if (cached && cached.length > 0) {
        bySectionCode.set(sectionCode, cached);
      } else {
        missedCodes.push(sectionCode);
      }
    }

    // 2. Chỉ những mã cache miss mới truy vấn DB, rồi ghi lại cache.
    if (missedCodes.length > 0) {
      const rows = await this.prisma.classSection.findMany({
        where: { sectionCode: { in: missedCodes }, semester },
        orderBy: [
          { sectionCode: 'asc' },
          { dayOfWeek: 'asc' },
          { startPeriod: 'asc' },
          { createdAt: 'asc' },
        ],
        include: { course: true },
      });

      const dbRowsBySectionCode = new Map<string, ResolvedSectionRow[]>();
      for (const row of rows) {
        const group = dbRowsBySectionCode.get(row.sectionCode) ?? [];
        group.push(row);
        dbRowsBySectionCode.set(row.sectionCode, group);
      }

      for (const sectionCode of missedCodes) {
        const group = dbRowsBySectionCode.get(sectionCode) ?? [];
        if (group.length > 0) {
          bySectionCode.set(sectionCode, group);
        }
      }

      // Ghi cache cho phần vừa nạp từ DB (reg:section:code + khởi tạo
      // reg:section:slots). Phần cache-hit ở trên KHÔNG ghi lại để tránh
      // ghi đè counter số chỗ đang sống (đang được DECRBY/INCRBY).
      await this.writeSectionLookupCaches(
        semester,
        missedCodes,
        dbRowsBySectionCode,
      );
    }

    return bySectionCode;
  }

  private async readSectionByCodeCache(
    semester: string,
    sectionCode: string,
  ): Promise<ResolvedSectionRow[] | null> {
    const key = RegistrationRedisKey.sectionByCode(semester, sectionCode);
    const cached = await this.redis.get(key).catch((error) => {
      this.logger.warn(
        `[Registrations] Redis section lookup failed for ${key}: ${error.message}`,
      );
      return null;
    });

    if (!cached) return null;

    try {
      const parsed = JSON.parse(cached) as CachedSectionByCodeResponse;
      if (!Array.isArray(parsed.items) || !parsed.meta) {
        await this.redis.del(key);
        return null;
      }

      if (!parsed.items.every((item) => this.hasRequiredCourseInfo(item))) {
        await this.redis.del(key);
        return null;
      }

      return parsed.items;
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  private hasRequiredCourseInfo(row: unknown): row is ResolvedSectionRow {
    const value = row as Partial<ResolvedSectionRow>;
    const course = value.course as Partial<ResolvedSectionRow['course']>;

    return (
      row !== null &&
      typeof row === 'object' &&
      value.course !== null &&
      typeof value.course === 'object' &&
      typeof course.code === 'string' &&
      typeof course.name === 'string' &&
      Object.prototype.hasOwnProperty.call(course, 'prerequisite')
    );
  }

  private async writeSectionLookupCaches(
    semester: string,
    sectionCodes: string[],
    rowsBySectionCode: Map<string, ResolvedSectionRow[]>,
  ) {
    const pipeline = this.redis.pipeline();

    for (const sectionCode of sectionCodes) {
      const items = rowsBySectionCode.get(sectionCode) ?? [];
      const response: CachedSectionByCodeResponse = {
        items,
        meta: {
          page: 1,
          limit: items.length,
          total: items.length,
          totalPages: items.length === 0 ? 0 : 1,
        },
      };

      pipeline.set(
        RegistrationRedisKey.sectionByCode(semester, sectionCode),
        JSON.stringify(response),
        'EX',
        CLASS_SECTION_LOOKUP_CACHE_TTL_SECONDS,
      );
    }

    for (const rows of rowsBySectionCode.values()) {
      for (const row of rows) {
        pipeline.set(
          RegistrationRedisKey.sectionSlots(row.id),
          Math.max(row.maxCapacity - row.registeredCount, 0).toString(),
          'EX',
          CLASS_SECTION_LOOKUP_CACHE_TTL_SECONDS,
        );
      }
    }

    await pipeline.exec().catch((error) => {
      this.logger.warn(
        `[Registrations] Redis section cache write failed: ${error.message}`,
      );
    });
  }

  // ─── CREATE BATCH ────────────────────────────────────────────────────────────

  async createBatch(user: JwtPayload, dto: CreateRegistrationBatchDto) {
    const { semester } = dto;
    const sectionCodes = [...new Set(dto.sectionCodes)];
    const userId = user.sub;

    // 1. Kỳ học đã mở đăng ký chưa?
    await this.batchValidator.assertRegistrationSessionOpen(semester);

    // 2. Đã có batch PENDING cho kỳ này chưa? (mỗi SV chỉ 1 batch/kỳ)
    await this.batchValidator.assertNoPendingBatch(userId, semester);

    // 3. Resolve sectionCodes → tất cả buổi học (nhiều row/mã lớp)
    const bySectionCode = await this.resolveSectionCodes(
      sectionCodes,
      semester,
    );

    // 4. Tất cả sectionCode có tồn tại và thuộc kỳ này không?
    const missing = sectionCodes.filter((code) => !bySectionCode.has(code));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Lớp học phần không tồn tại hoặc không thuộc kỳ ${semester}: ${missing.join(', ')}`,
      );
    }

    // representativeSections: 1 row đại diện mỗi mã lớp — dùng để check status, lab, credit
    const representativeSections = sectionCodes.map(
      (code) => bySectionCode.get(code)![0],
    );
    // allRows: toàn bộ các buổi học của tất cả mã lớp — dùng để check trùng lịch và gửi queue
    const allRows = sectionCodes.flatMap((code) => bySectionCode.get(code)!);

    // 5. Lớp có đang mở đăng ký không? (check theo đại diện)
    const invalidStatus = representativeSections.filter(
      (s) =>
        s.sectionStatus === 'CANCELLED' ||
        s.sectionStatus === 'REGISTRATION_CLOSED',
    );
    if (invalidStatus.length > 0) {
      throw new BadRequestException(
        `Lớp không thể đăng ký (đã huỷ/đóng): ${invalidStatus.map((s) => s.sectionCode).join(', ')}`,
      );
    }

    // 6. Check còn slot theo Redis trước, Redis miss thì fallback DB.
    // Worker vẫn kiểm tra DB trong transaction nên đây là fast-fail ở API.
    await this.assertSectionsHaveCapacityRedisFirst(allRows);

    // 7. Có trùng mã lớp trong batch không?
    // Đã được xử lý deduplicate (Set) ở đầu hàm để hỗ trợ TKB nhiều buổi.

    // 8. Lấy danh sách lớp đã đăng ký thành công trong kỳ — dùng cho các check bên dưới
    const existingItems = await this.findActiveRegistrationItems(
      userId,
      semester,
    );
    const existingScheduleRows = existingItems
      .filter((item) => item.classSection !== null)
      .map((item) => ({
        id: item.classSectionId!,
        sectionCode: item.classSection!.sectionCode,
        dayOfWeek: item.classSection!.dayOfWeek,
        timeOfDay: item.classSection!.timeOfDay as string | null,
        startPeriod: item.classSection!.startPeriod,
        endPeriod: item.classSection!.endPeriod,
      }));

    // 9. Sinh viên đã đăng ký môn này trong kỳ chưa?
    const existingCourseIds = new Set(
      existingItems.map((item) => item.classSection?.course.id).filter(Boolean),
    );
    const duplicateCourses = representativeSections.filter((s) =>
      existingCourseIds.has(s.courseId),
    );
    if (duplicateCourses.length > 0) {
      throw new BadRequestException(
        `Môn học đã được đăng ký trong kỳ ${semester}: ${duplicateCourses.map((s) => s.course.code).join(', ')}`,
      );
    }

    // 10. Check cặp lớp thí nghiệm — merge batch + lớp đã đăng ký
    const existingLabRows = existingItems
      .filter((item) => item.classSection !== null)
      .map((item) => ({
        id: item.classSectionId!,
        courseId: item.classSection!.courseId,
        sectionType: item.classSection!.sectionType as string | null,
        requiresLab: item.classSection!.requiresLab,
        sectionCode: item.classSection!.sectionCode,
      }));
    this.batchValidator.assertLabPairing([
      ...representativeSections,
      ...existingLabRows,
    ]);

    // 11. Check trùng lịch: giữa batch mới + các lớp đã đăng ký
    this.batchValidator.assertNoScheduleConflict([
      ...allRows,
      ...existingScheduleRows,
    ]);

    // 12. Kiểm tra giới hạn tín chỉ tối đa từ DB để tránh lệch cache
    const { maxCreditsPerSemester } = await this.settingsService.getAll();
    const existingCredits = await this.getExistingCredits(userId, semester);

    // Tín chỉ tính theo courseId distinct (mỗi môn chỉ tính 1 lần dù có nhiều buổi)
    const newCourseIds = [
      ...new Set(representativeSections.map((s) => s.courseId)),
    ];
    const { _sum } = await this.prisma.course.aggregate({
      where: { id: { in: newCourseIds } },
      _sum: { credits: true },
    });
    const newCredits = _sum.credits ?? 0;

    const totalCredits = existingCredits + newCredits;
    if (totalCredits > maxCreditsPerSemester) {
      throw new BadRequestException(
        `Tổng tín chỉ (${totalCredits}) vượt quá giới hạn ${maxCreditsPerSemester} TC/kỳ. Hiện đã đăng ký ${existingCredits} TC, batch này yêu cầu thêm ${newCredits} TC.`,
      );
    }

    const batchId = randomUUID();

    // Reserve slot trước khi ghi DB để chặn ngay các request đến sau,
    // tránh race condition trong khoảng thời gian DB đang bận.
    const uniqueClassSectionIds = [...new Set(allRows.map((r) => r.id))];
    if (uniqueClassSectionIds.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const classSectionId of uniqueClassSectionIds) {
        pipeline.decrby(RegistrationRedisKey.sectionSlots(classSectionId), 1);
      }
      await pipeline.exec().catch((err) => {
        this.logger.warn(
          `[CreateBatch] Redis pre-decrement failed: ${err.message}`,
        );
      });
    }

    // Ghi batch + items vào DB. Nếu lỗi thì rollback Redis (cộng lại slot).
    let createdItems: Array<{ id: string; classSectionId: string | null }> = [];
    try {
      const batch = await this.prisma.registrationBatch.create({
        data: {
          id: batchId,
          userId,
          semester,
          type: RegistrationBatchType.CREATE,
          status: RegistrationBatchStatus.PENDING,
          totalItems: allRows.length,
          items: {
            createMany: {
              data: allRows.map((row) => ({
                classSectionId: row.id,
                status: RegistrationBatchItemStatus.PENDING,
              })),
            },
          },
        },
        include: {
          items: {
            select: { id: true, classSectionId: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      createdItems = batch.items;
    } catch (dbError) {
      // Rollback: trả lại slot vừa trừ để tránh "ghost slot" treo mãi trên Redis.
      // Nếu INCR cũng lỗi thì cronjob reconcile (mỗi 2 phút) sẽ tự dọn.
      this.logger.error(
        `[CreateBatch] DB write failed, rolling back Redis slots. batchId=${batchId} userId=${userId}`,
        (dbError as Error).stack,
      );
      if (uniqueClassSectionIds.length > 0) {
        const rollbackPipeline = this.redis.pipeline();
        for (const classSectionId of uniqueClassSectionIds) {
          rollbackPipeline.incrby(
            RegistrationRedisKey.sectionSlots(classSectionId),
            1,
          );
        }
        await rollbackPipeline.exec().catch((rollbackErr) => {
          this.logger.error(
            `[CreateBatch] Redis rollback failed after DB error — reconcile sẽ tự sửa: ${rollbackErr.message}`,
          );
        });
      }
      throw new InternalServerErrorException(
        'Không thể tạo batch đăng ký, vui lòng thử lại sau.',
      );
    }

    // Build map classSectionId → itemId để gửi kèm trong payload
    const itemIdBySectionId = new Map(
      createdItems.map((item) => [item.classSectionId, item.id]),
    );

    const payload: RegistrationBatchJobPayload = {
      type: RegistrationQueueEvent.CREATE_BATCH_REQUESTED,
      batchId,
      userId,
      semester,
      queuedAt: new Date().toISOString(),
      // Gửi TẤT CẢ row (allRows) kèm itemId để Worker không cần query DB
      items: allRows.map((row) => ({
        itemId: itemIdBySectionId.get(row.id) ?? '',
        classSectionId: row.id,
        courseId: row.courseId,
        courseCode: row.course.code,
        courseName: row.course.name,
        prerequisite: row.course.prerequisite,
        dayOfWeek: row.dayOfWeek,
        timeOfDay: row.timeOfDay,
        startPeriod: row.startPeriod,
        endPeriod: row.endPeriod,
      })),
    };
    const publish = await this.publisher.publishToQueue(payload);

    this.logger.log(
      `[CreateBatch] accepted batchId=${batchId} userId=${userId} semester=${semester} sectionCodes=${sectionCodes.length} totalSlots=${allRows.length} credits=${newCredits}/${maxCreditsPerSemester}`,
    );

    return {
      accepted: true,
      batchId,
      type: RegistrationBatchType.CREATE,
      semester,
      totalItems: allRows.length,
      publish,
    };
  }

  private async assertSectionsHaveCapacityRedisFirst(
    sections: Array<{
      id: string;
      sectionCode: string;
      maxCapacity: number;
      registeredCount: number;
    }>,
  ): Promise<void> {
    const uniqueSections = [
      ...new Map(sections.map((s) => [s.id, s])).values(),
    ];
    if (uniqueSections.length === 0) return;

    const keys = uniqueSections.map((section) =>
      RegistrationRedisKey.sectionSlots(section.id),
    );
    const redisValues = await this.redis.mget(...keys);
    const fullSections: string[] = [];
    const missedSections: typeof uniqueSections = [];

    uniqueSections.forEach((section, index) => {
      const redisValue = redisValues[index];
      const redisRemaining =
        redisValue === null ? null : Number.parseInt(redisValue, 10);

      if (redisRemaining === null || Number.isNaN(redisRemaining)) {
        missedSections.push(section);
        return;
      }

      if (redisRemaining <= 0) fullSections.push(section.sectionCode);
    });

    if (missedSections.length > 0) {
      this.logger.debug(
        `[CreateBatch] Redis slot miss=${missedSections.length}/${uniqueSections.length}, used DB fallback`,
      );

      const dbSections = await this.prisma.classSection.findMany({
        where: { id: { in: missedSections.map((section) => section.id) } },
        select: {
          id: true,
          sectionCode: true,
          maxCapacity: true,
          registeredCount: true,
        },
      });

      const pipeline = this.redis.pipeline();
      for (const section of dbSections) {
        const remaining = Math.max(
          section.maxCapacity - section.registeredCount,
          0,
        );
        if (remaining <= 0) fullSections.push(section.sectionCode);
        pipeline.set(
          RegistrationRedisKey.sectionSlots(section.id),
          remaining.toString(),
          'EX',
          CLASS_SECTION_LOOKUP_CACHE_TTL_SECONDS,
        );
      }

      await pipeline.exec().catch((error) => {
        this.logger.warn(
          `[CreateBatch] Redis slot cache refill failed: ${error.message}`,
        );
      });
    }

    if (fullSections.length > 0) {
      throw new BadRequestException(
        `Lớp học đã hết chỗ: ${[...new Set(fullSections)].join(', ')}`,
      );
    }
  }

  // ─── CANCEL BATCH ────────────────────────────────────────────────────────────

  async cancelBatch(user: JwtPayload, dto: CancelRegistrationBatchDto) {
    const { semester } = dto;
    // Deduplicate sectionCodes since a class might have multiple schedule rows in the frontend
    const sectionCodes = [...new Set(dto.sectionCodes)];
    const userId = user.sub;

    // Resolve sectionCodes → tất cả buổi học (nhiều row/mã lớp)
    const bySectionCode = await this.resolveSectionCodes(
      sectionCodes,
      semester,
    );

    const missing = sectionCodes.filter((code) => !bySectionCode.has(code));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Không tìm thấy lớp học phần: ${missing.join(', ')}`,
      );
    }

    // allRows: toàn bộ row (tất cả buổi học) của các mã lớp cần huỷ
    const allRows = sectionCodes.flatMap((code) => bySectionCode.get(code)!);
    // Đại diện mỗi mã lớp — dùng cho thông báo lỗi
    const representativeSections = sectionCodes.map(
      (code) => bySectionCode.get(code)![0],
    );
    const classSectionIds = allRows.map((r) => r.id);

    await this.batchValidator.assertRegistrationSessionOpen(semester);

    const activeItems = await this.findActiveRegistrationItems(
      userId,
      semester,
      classSectionIds,
    );
    const activeClassSectionIds = new Set(
      activeItems.map((item) => item.classSectionId),
    );
    // Check theo đại diện (id của buổi đầu tiên) để tránh false-positive khi 1 mã lớp có 2 buổi
    const inactiveSections = representativeSections.filter(
      (section) => !activeClassSectionIds.has(section.id),
    );
    if (inactiveSections.length > 0) {
      throw new BadRequestException(
        `Chỉ có thể hủy lớp đang đăng ký: ${inactiveSections.map((s) => s.sectionCode).join(', ')}`,
      );
    }

    // Kiểm tra không có batch cancel PENDING đang chờ
    await this.batchValidator.assertNoPendingBatch(
      userId,
      semester,
      RegistrationBatchType.CANCEL,
    );

    // Build sourceItemId map: classSectionId → batch item ID gốc (CREATE SUCCESS)
    const sourceItemMap = new Map(
      activeItems.map((item) => [item.classSectionId!, item.id]),
    );

    const batchId = randomUUID();

    // Release slot trước khi ghi DB để nhả chỗ trống ngay lập tức cho người khác,
    // tránh race condition trong khoảng thời gian DB đang bận.
    const uniqueCancelSectionIds = [...new Set(classSectionIds)];
    if (uniqueCancelSectionIds.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const classSectionId of uniqueCancelSectionIds) {
        pipeline.incrby(RegistrationRedisKey.sectionSlots(classSectionId), 1);
      }
      await pipeline.exec().catch((err) => {
        this.logger.warn(
          `[CancelBatch] Redis pre-increment failed: ${err.message}`,
        );
      });
    }

    // Ghi batch + items vào DB. Nếu lỗi thì rollback Redis (trừ lại slot vừa cộng).
    let cancelCreatedItems: Array<{ id: string; classSectionId: string | null }> = [];
    try {
      const batch = await this.prisma.registrationBatch.create({
        data: {
          id: batchId,
          userId,
          semester,
          type: RegistrationBatchType.CANCEL,
          status: RegistrationBatchStatus.PENDING,
          totalItems: classSectionIds.length,
          items: {
            createMany: {
              data: classSectionIds.map((classSectionId) => ({
                classSectionId,
                status: RegistrationBatchItemStatus.PENDING,
              })),
            },
          },
        },
        include: {
          items: {
            select: { id: true, classSectionId: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      cancelCreatedItems = batch.items;
    } catch (dbError) {
      // Rollback: trừ lại slot vừa cộng để tránh slot bị thừa trên Redis.
      // Nếu DECR cũng lỗi thì cronjob reconcile (mỗi 2 phút) sẽ tự dọn.
      this.logger.error(
        `[CancelBatch] DB write failed, rolling back Redis slots. batchId=${batchId} userId=${userId}`,
        (dbError as Error).stack,
      );
      if (uniqueCancelSectionIds.length > 0) {
        const rollbackPipeline = this.redis.pipeline();
        for (const classSectionId of uniqueCancelSectionIds) {
          rollbackPipeline.decrby(
            RegistrationRedisKey.sectionSlots(classSectionId),
            1,
          );
        }
        await rollbackPipeline.exec().catch((rollbackErr) => {
          this.logger.error(
            `[CancelBatch] Redis rollback failed after DB error — reconcile sẽ tự sửa: ${rollbackErr.message}`,
          );
        });
      }
      throw new InternalServerErrorException(
        'Không thể tạo batch hủy đăng ký, vui lòng thử lại sau.',
      );
    }

    // Build map classSectionId → cancelItemId
    const cancelItemIdBySectionId = new Map(
      cancelCreatedItems.map((item) => [item.classSectionId, item.id]),
    );

    const payload: RegistrationBatchJobPayload = {
      type: RegistrationQueueEvent.CANCEL_BATCH_REQUESTED,
      batchId,
      userId,
      semester,
      queuedAt: new Date().toISOString(),
      items: classSectionIds.map((classSectionId) => ({
        itemId: cancelItemIdBySectionId.get(classSectionId) ?? '',
        classSectionId,
        sourceItemId: sourceItemMap.get(classSectionId)!,
      })),
    };
    const publish = await this.publisher.publishToQueue(payload);

    this.logger.log(
      `[CancelBatch] accepted batchId=${batchId} userId=${userId} semester=${semester} sectionCodes=${sectionCodes.length} totalSlots=${classSectionIds.length}`,
    );

    return {
      accepted: true,
      batchId,
      type: RegistrationBatchType.CANCEL,
      semester,
      totalItems: classSectionIds.length,
      publish,
    };
  }

  // ─── READ: My Registrations ───────────────────────────────────────────────────

  async getMyRegistrations(user: JwtPayload, semester: string) {
    const userId = user.sub;
    const items = await this.findLatestRegistrationResultItems(
      userId,
      semester,
    );

    return items.map((item) => ({
      id: item.id,
      batchItemId: item.id,
      batchId: item.batch.id,
      classSectionId: item.classSectionId,
      status: item.status,
      failureReason: item.failureReason,
      remainingSlots: item.remainingSlots,
      registeredAt: item.processedAt ?? item.createdAt,
      cancelledAt:
        item.status === RegistrationBatchItemStatus.CANCELLED
          ? (item.processedAt ?? item.createdAt)
          : null,
      batch: item.batch,
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
                requiresLab: true,
                linkedSectionCode: true,
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
          type: RegistrationBatchType.CREATE,
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
            requiresLab: true,
            linkedSectionCode: true,
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
      (typeof successfulItems)[0]
    >();
    for (const item of successfulItems) {
      if (!item.classSectionId) continue;
      const key = `${item.batch.user.id}:${item.classSectionId}`;
      if (!latestByUserAndSection.has(key)) {
        latestByUserAndSection.set(key, item);
      }
    }

    return [...latestByUserAndSection.values()].map((item) => ({
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
        batch: { userId, semester, type: RegistrationBatchType.CREATE },
      },
      select: {
        id: true,
        status: true,
        classSectionId: true,
        processedAt: true,
        createdAt: true,
        batch: {
          select: {
            id: true,
            type: true,
            status: true,
            createdAt: true,
            processedAt: true,
          },
        },
        classSection: {
          select: {
            id: true,
            courseId: true,
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
            requiresLab: true,
            linkedSectionCode: true,
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

    const latestBySection = new Map<string, (typeof successfulItems)[0]>();
    for (const item of successfulItems) {
      if (!item.classSectionId || !item.classSection) continue;
      if (!latestBySection.has(item.classSectionId)) {
        latestBySection.set(item.classSectionId, item);
      }
    }

    return [...latestBySection.values()];
  }

  private async findLatestRegistrationResultItems(
    userId: string,
    semester: string,
  ) {
    const items = await this.prisma.registrationBatchItem.findMany({
      where: {
        classSectionId: { not: null },
        batch: { userId, semester, type: RegistrationBatchType.CREATE },
      },
      select: {
        id: true,
        status: true,
        failureReason: true,
        remainingSlots: true,
        classSectionId: true,
        processedAt: true,
        createdAt: true,
        batch: {
          select: {
            id: true,
            type: true,
            status: true,
            createdAt: true,
            processedAt: true,
          },
        },
        classSection: {
          select: {
            id: true,
            courseId: true,
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
            requiresLab: true,
            linkedSectionCode: true,
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

    const latestBySection = new Map<string, (typeof items)[0]>();
    for (const item of items) {
      if (!item.classSectionId || !item.classSection) continue;
      if (!latestBySection.has(item.classSectionId)) {
        latestBySection.set(item.classSectionId, item);
      }
    }

    return [...latestBySection.values()];
  }

  private async getExistingCredits(
    userId: string,
    semester: string,
  ): Promise<number> {
    return this.computeCreditsFromDb(userId, semester);
  }

  private async computeCreditsFromDb(
    userId: string,
    semester: string,
  ): Promise<number> {
    const items = await this.prisma.registrationBatchItem.findMany({
      where: {
        batch: { userId, semester, type: RegistrationBatchType.CREATE },
        status: RegistrationBatchItemStatus.SUCCESS,
      },
      select: { classSection: { select: { courseId: true } } },
    });

    const courseIds = [
      ...new Set(
        items
          .filter((i) => i.classSection !== null)
          .map((i) => i.classSection!.courseId),
      ),
    ];
    if (courseIds.length === 0) return 0;

    const { _sum } = await this.prisma.course.aggregate({
      where: { id: { in: courseIds } },
      _sum: { credits: true },
    });
    return _sum.credits ?? 0;
  }
}
