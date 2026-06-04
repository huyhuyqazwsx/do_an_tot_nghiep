import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService, REDIS_CLIENT, RegistrationRedisKey } from '@app/shared';
import {
  ClassSectionStatus,
  ClassSectionType,
  ClassTimeOfDay,
  Prisma,
  SectionOpenGroup,
} from '@prisma/client';
import type Redis from 'ioredis';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ClassSectionCsvRow } from './types/class-section-csv-row.type';
import { ClassSectionImportError } from './types/class-section-import-error.type';
import { ImportedClassSectionRow } from './types/imported-class-section-row.type';
import { ParsedClassSectionRow } from './types/parsed-class-section-row.type';
import { UploadedCsvFile } from './types/uploaded-csv-file.type';
import { QueryClassSectionsDto } from './dto/query-class-sections.dto';
import { CreateClassSectionDto } from './dto/create-class-section.dto';
import { UpdateClassSectionDto } from './dto/update-class-section.dto';

const CLASS_SECTION_LOOKUP_CACHE_TTL_SECONDS = 30 * 60;

type ClassSectionLookupResponse = {
  items: Array<
    Prisma.ClassSectionGetPayload<{
      include: {
        course: {
          select: { id: true; code: true; name: true; credits: true };
        };
      };
    }>
  >;
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

// noinspection JSNonASCIINames
@Injectable()
export class ClassSectionsService {
  private readonly logger = new Logger(ClassSectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async importClassSections(file: UploadedCsvFile) {
    const text = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const rows = this.parseScheduleCsv(text);

    if (rows.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    const courseMap = await this.findCourseMap(
      rows.map(({ row }) => row.courseCode.trim()),
    );

    const errors: ClassSectionImportError[] = [];
    const data: ImportedClassSectionRow[] = [];
    const scheduleKeys = new Set<string>();
    let skippedDuplicateRows = 0;

    for (const { lineNumber, row } of rows) {
      try {
        const validatedRow = this.validateClassSectionRow(row, lineNumber);
        const courseId = courseMap.get(validatedRow.courseCode.trim());

        if (!courseId) {
          throw new Error(
            `Course code does not exist in courses table: ${validatedRow.courseCode.trim()}`,
          );
        }

        const classSectionData = this.toClassSectionInput(
          validatedRow,
          courseId,
          lineNumber,
        );
        const scheduleKey = this.buildScheduleKey(classSectionData);

        if (scheduleKeys.has(scheduleKey)) {
          skippedDuplicateRows += 1;
          continue;
        }

        scheduleKeys.add(scheduleKey);
        data.push(classSectionData);
      } catch (error) {
        errors.push({
          row: lineNumber,
          sectionCode: row.sectionCode?.trim(),
          courseCode: row.courseCode?.trim(),
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'CSV contains invalid rows',
        totalRows: rows.length,
        failed: errors.length,
        errors,
      });
    }

    if (data.length === 0) {
      return {
        fileName: file.originalname,
        totalRows: rows.length,
        inserted: 0,
        skippedDuplicateRows,
        skippedExisting: 0,
      };
    }

    try {
      const result = await this.prisma.classSection.createMany({
        data,
        skipDuplicates: true,
      });

      await this.invalidateSectionLookupCaches(data);

      return {
        fileName: file.originalname,
        totalRows: rows.length,
        inserted: result.count,
        skippedDuplicateRows,
        skippedExisting: data.length - result.count,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException({
          message: 'Database rejected the import',
          code: error.code,
          detail: error.message,
        });
      }

      throw error;
    }
  }

  async findAll(query: QueryClassSectionsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const q = query.q?.trim();
    const where: Prisma.ClassSectionWhereInput = {};

    if (q) {
      throw new BadRequestException(
        'Không hỗ trợ tìm kiếm mờ bằng q. Vui lòng nhập mã lớp bằng sectionCode.',
      );
    }

    if (query.semester?.trim()) {
      where.semester = query.semester.trim();
    }

    if (query.sectionCode?.trim()) {
      where.sectionCode = query.sectionCode.trim();
    }

    if (query.courseCode?.trim()) {
      where.course = {
        code: query.courseCode.trim(),
      };
    }

    if (query.sectionType) {
      where.sectionType = query.sectionType;
    }

    if (query.sectionStatus) {
      where.sectionStatus = query.sectionStatus;
    }

    const orderBy: Prisma.ClassSectionOrderByWithRelationInput = {
      [query.sortBy ?? 'sectionCode']: query.sortOrder ?? 'asc',
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.classSection.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          course: {
            select: { id: true, code: true, name: true, credits: true },
          },
        },
      }),
      this.prisma.classSection.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const classSection = await this.prisma.classSection.findUnique({
      where: { id },
      include: {
        course: {
          select: { id: true, code: true, name: true, credits: true },
        },
      },
    });

    if (!classSection) {
      throw new NotFoundException(`Class section not found: ${id}`);
    }

    return classSection;
  }

  async findBySectionCode(semester: string, sectionCode: string) {
    const normalizedSemester = semester?.trim();
    const normalizedSectionCode = sectionCode?.trim();

    if (!normalizedSemester || !normalizedSectionCode) {
      throw new BadRequestException('semester and sectionCode are required');
    }

    const cached = await this.readSectionByCodeCache(
      normalizedSemester,
      normalizedSectionCode,
    );
    if (cached) {
      return this.withCurrentRegisteredCounts(cached);
    }

    const items = await this.prisma.classSection.findMany({
      where: {
        semester: normalizedSemester,
        sectionCode: normalizedSectionCode,
      },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startPeriod: 'asc' },
        { createdAt: 'asc' },
      ],
      include: {
        course: {
          select: { id: true, code: true, name: true, credits: true },
        },
      },
    });

    const response = this.toLookupResponse(items);
    await this.writeSectionSlotsCache(items);
    await this.writeSectionByCodeCache(
      normalizedSemester,
      normalizedSectionCode,
      response,
    );

    return this.withCurrentRegisteredCounts(response);
  }

  private toLookupResponse(
    items: ClassSectionLookupResponse['items'],
  ): ClassSectionLookupResponse {
    return {
      items,
      meta: {
        page: 1,
        limit: items.length,
        total: items.length,
        totalPages: items.length === 0 ? 0 : 1,
      },
    };
  }

  private async readSectionByCodeCache(
    semester: string,
    sectionCode: string,
  ): Promise<ClassSectionLookupResponse | null> {
    const key = RegistrationRedisKey.sectionByCode(semester, sectionCode);
    const cached = await this.redis.get(key).catch((error) => {
      this.logger.warn(
        `[ClassSections] Redis lookup failed for ${key}: ${error.message}`,
      );
      return null;
    });

    if (!cached) return null;

    try {
      const parsed = JSON.parse(cached) as ClassSectionLookupResponse;
      if (!Array.isArray(parsed.items) || !parsed.meta) {
        await this.redis.del(key);
        return null;
      }
      return parsed;
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  private async writeSectionByCodeCache(
    semester: string,
    sectionCode: string,
    response: ClassSectionLookupResponse,
  ) {
    await this.redis
      .set(
        RegistrationRedisKey.sectionByCode(semester, sectionCode),
        JSON.stringify(response),
        'EX',
        CLASS_SECTION_LOOKUP_CACHE_TTL_SECONDS,
      )
      .catch((error) => {
        this.logger.warn(
          `[ClassSections] Redis cache write failed for ${semester}/${sectionCode}: ${error.message}`,
        );
      });
  }

  private async writeSectionSlotsCache(
    items: ClassSectionLookupResponse['items'],
  ) {
    if (items.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const item of items) {
      pipeline.set(
        RegistrationRedisKey.sectionSlots(item.id),
        Math.max(item.maxCapacity - item.registeredCount, 0).toString(),
        'EX',
        CLASS_SECTION_LOOKUP_CACHE_TTL_SECONDS,
      );
    }
    await pipeline.exec().catch((error) => {
      this.logger.warn(
        `[ClassSections] Redis slot cache write failed: ${error.message}`,
      );
    });
  }

  private async invalidateSectionLookupCaches(
    refs: Array<{ semester: string; sectionCode: string; id?: string }>,
  ) {
    const keys = [
      ...new Set(
        refs.flatMap((ref) => [
          RegistrationRedisKey.sectionByCode(ref.semester, ref.sectionCode),
          ...(ref.id ? [RegistrationRedisKey.sectionSlots(ref.id)] : []),
        ]),
      ),
    ];

    if (keys.length === 0) return;

    await this.redis.del(...keys).catch((error) => {
      this.logger.warn(
        `[ClassSections] Redis cache invalidation failed: ${error.message}`,
      );
    });
  }

  private async withCurrentRegisteredCounts(
    response: ClassSectionLookupResponse,
  ): Promise<ClassSectionLookupResponse> {
    if (response.items.length === 0) return response;

    const keys = response.items.map((item) =>
      RegistrationRedisKey.sectionSlots(item.id),
    );
    const slotValues = await this.redis.mget(...keys).catch((error) => {
      this.logger.warn(
        `[ClassSections] Redis slot read failed: ${error.message}`,
      );
      return [];
    });

    if (slotValues.length === 0) return response;

    return {
      ...response,
      items: response.items.map((item, index) => {
        const rawRemaining = slotValues[index];
        if (rawRemaining === null || rawRemaining === undefined) return item;

        const remaining = Number.parseInt(rawRemaining, 10);
        if (Number.isNaN(remaining)) return item;

        return {
          ...item,
          registeredCount: Math.max(item.maxCapacity - remaining, 0),
        };
      }),
    };
  }

  async create(dto: CreateClassSectionDto) {
    const course = await this.prisma.course.findUnique({
      where: { code: dto.courseCode.trim() },
      select: { id: true },
    });

    if (!course) {
      throw new BadRequestException(
        `Course not found: ${dto.courseCode.trim()}`,
      );
    }

    const startPeriod = dto.startPeriod ?? null;
    const endPeriod = dto.endPeriod ?? null;
    const dayOfWeek = dto.dayOfWeek ?? null;
    const timeRange = dto.timeRange?.trim() || null;
    if (startPeriod !== null && endPeriod !== null && startPeriod > endPeriod) {
      throw new BadRequestException('startPeriod must be <= endPeriod');
    }

    if (
      [dayOfWeek, startPeriod, endPeriod, timeRange].some(
        (value) => value !== null,
      ) &&
      [dayOfWeek, startPeriod, endPeriod, timeRange].some(
        (value) => value === null,
      )
    ) {
      throw new BadRequestException(
        'Schedule fields must be fully provided or fully empty',
      );
    }

    try {
      const created = await this.prisma.classSection.create({
        data: {
          sectionCode: dto.sectionCode.trim(),
          linkedSectionCode: dto.linkedSectionCode?.trim() || null,
          courseId: course.id,
          semester: dto.semester.trim(),
          dayOfWeek,
          timeOfDay: dto.timeOfDay ?? null,
          startPeriod,
          endPeriod,
          timeRange,
          weekRange: dto.weekRange?.trim() || null,
          room: dto.room?.trim() || null,
          sectionType: dto.sectionType ?? null,
          openingGroup: dto.openingGroup ?? null,
          sectionStatus: dto.sectionStatus ?? null,
          requiresLab: dto.requiresLab ?? false,
          note: dto.note?.trim() || null,
          maxCapacity: dto.maxCapacity ?? 0,
          registeredCount: dto.registeredCount ?? 0,
        },
        include: {
          course: {
            select: { id: true, code: true, name: true, credits: true },
          },
        },
      });

      await this.invalidateSectionLookupCaches([
        {
          id: created.id,
          semester: created.semester,
          sectionCode: created.sectionCode,
        },
      ]);

      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Class section schedule already exists: ${dto.sectionCode.trim()}`,
        );
      }

      throw error;
    }
  }

  async update(id: string, dto: UpdateClassSectionDto) {
    const current = await this.prisma.classSection.findUnique({
      where: { id },
      select: {
        id: true,
        semester: true,
        sectionCode: true,
        dayOfWeek: true,
        startPeriod: true,
        endPeriod: true,
        timeRange: true,
      },
    });

    if (!current) {
      throw new NotFoundException(`Class section not found: ${id}`);
    }

    const course =
      dto.courseCode !== undefined
        ? await this.prisma.course.findUnique({
            where: { code: dto.courseCode.trim() },
            select: { id: true },
          })
        : undefined;

    if (dto.courseCode !== undefined && !course) {
      throw new BadRequestException(
        `Course not found: ${dto.courseCode.trim()}`,
      );
    }

    const nextDayOfWeek =
      dto.dayOfWeek !== undefined ? dto.dayOfWeek : current.dayOfWeek;
    const nextStartPeriod =
      dto.startPeriod !== undefined ? dto.startPeriod : current.startPeriod;
    const nextEndPeriod =
      dto.endPeriod !== undefined ? dto.endPeriod : current.endPeriod;
    const nextTimeRange =
      dto.timeRange !== undefined
        ? dto.timeRange?.trim() || null
        : current.timeRange;

    if (
      nextStartPeriod !== null &&
      nextEndPeriod !== null &&
      nextStartPeriod > nextEndPeriod
    ) {
      throw new BadRequestException('startPeriod must be <= endPeriod');
    }

    if (
      [nextDayOfWeek, nextStartPeriod, nextEndPeriod, nextTimeRange].some(
        (value) => value !== null,
      ) &&
      [nextDayOfWeek, nextStartPeriod, nextEndPeriod, nextTimeRange].some(
        (value) => value === null,
      )
    ) {
      throw new BadRequestException(
        'Schedule fields must be fully provided or fully empty',
      );
    }

    try {
      const updated = await this.prisma.classSection.update({
        where: { id },
        data: {
          ...(dto.sectionCode !== undefined
            ? { sectionCode: dto.sectionCode.trim() }
            : {}),
          ...(dto.linkedSectionCode !== undefined
            ? { linkedSectionCode: dto.linkedSectionCode?.trim() || null }
            : {}),
          ...(course ? { courseId: course.id } : {}),
          ...(dto.semester !== undefined
            ? { semester: dto.semester.trim() }
            : {}),
          ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
          ...(dto.timeOfDay !== undefined ? { timeOfDay: dto.timeOfDay } : {}),
          ...(dto.startPeriod !== undefined
            ? { startPeriod: dto.startPeriod }
            : {}),
          ...(dto.endPeriod !== undefined ? { endPeriod: dto.endPeriod } : {}),
          ...(dto.timeRange !== undefined
            ? { timeRange: dto.timeRange?.trim() || null }
            : {}),
          ...(dto.weekRange !== undefined
            ? { weekRange: dto.weekRange?.trim() || null }
            : {}),
          ...(dto.room !== undefined ? { room: dto.room?.trim() || null } : {}),
          ...(dto.sectionType !== undefined
            ? { sectionType: dto.sectionType }
            : {}),
          ...(dto.openingGroup !== undefined
            ? { openingGroup: dto.openingGroup }
            : {}),
          ...(dto.sectionStatus !== undefined
            ? { sectionStatus: dto.sectionStatus }
            : {}),
          ...(dto.requiresLab !== undefined
            ? { requiresLab: dto.requiresLab }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
          ...(dto.maxCapacity !== undefined
            ? { maxCapacity: dto.maxCapacity }
            : {}),
          ...(dto.registeredCount !== undefined
            ? { registeredCount: dto.registeredCount }
            : {}),
        },
        include: {
          course: {
            select: { id: true, code: true, name: true, credits: true },
          },
        },
      });

      await this.invalidateSectionLookupCaches([
        {
          id: current.id,
          semester: current.semester,
          sectionCode: current.sectionCode,
        },
        {
          id: updated.id,
          semester: updated.semester,
          sectionCode: updated.sectionCode,
        },
      ]);

      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`Class section schedule already exists`);
      }

      throw error;
    }
  }

  async remove(id: string) {
    const current = await this.findOne(id);

    try {
      const deleted = await this.prisma.classSection.delete({ where: { id } });
      await this.invalidateSectionLookupCaches([
        {
          id: current.id,
          semester: current.semester,
          sectionCode: current.sectionCode,
        },
      ]);
      return deleted;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          `Cannot delete class section ${id} because it is referenced by other records`,
        );
      }

      throw error;
    }
  }

  private toClassSectionInput(
    row: ClassSectionCsvRow,
    courseId: string,
    lineNumber: number,
  ): ImportedClassSectionRow {
    const semester = row.semester.trim();
    const sectionCode = row.sectionCode.trim();
    const linkedSectionCode = row.linkedSectionCode?.trim() || null;
    const courseCode = row.courseCode.trim();
    const note = row.note?.trim() || null;
    const dayOfWeek = this.parseNullableInteger(row.dayOfWeek);
    const timeRange = row.timeRange?.trim() || null;
    const startPeriod = this.parseNullableInteger(row.startPeriod);
    const endPeriod = this.parseNullableInteger(row.endPeriod);
    const timeOfDay = this.parseTimeOfDay(row.timeOfDay);
    const weekRange = row.weekRange?.trim() || null;
    const room = row.room?.trim() || null;
    const requiresLab = this.parseBooleanFlag(row.requiresLab);
    const registeredCount = this.parseNullableInteger(row.registeredCount) ?? 0;
    const maxCapacity = this.parseNullableInteger(row.maxCapacity) ?? 0;
    const sectionStatus = this.parseSectionStatus(row.sectionStatus);
    const sectionType = this.parseSectionType(row.sectionType);
    const openingGroup = this.parseOpeningGroup(row.openingGroup);

    if (dayOfWeek !== null && (dayOfWeek < 2 || dayOfWeek > 8)) {
      throw new Error(`dayOfWeek must be between 2 and 8 at row ${lineNumber}`);
    }

    if (startPeriod !== null && endPeriod !== null && startPeriod > endPeriod) {
      throw new Error(`startPeriod must be <= endPeriod at row ${lineNumber}`);
    }

    if (
      [dayOfWeek, startPeriod, endPeriod, timeRange].some(
        (value) => value !== null,
      ) &&
      [dayOfWeek, startPeriod, endPeriod, timeRange].some(
        (value) => value === null,
      )
    ) {
      throw new Error(
        `Schedule fields must be fully provided or fully empty at row ${lineNumber}`,
      );
    }

    this.assertMaxLength(semester, 10, 'semester', lineNumber);
    this.assertMaxLength(sectionCode, 20, 'sectionCode', lineNumber);
    this.assertMaxLength(
      linkedSectionCode,
      20,
      'linkedSectionCode',
      lineNumber,
    );
    this.assertMaxLength(courseCode, 20, 'courseCode', lineNumber);
    this.assertMaxLength(timeOfDay, 10, 'timeOfDay', lineNumber);
    this.assertMaxLength(timeRange, 20, 'timeRange', lineNumber);
    this.assertMaxLength(weekRange, 50, 'weekRange', lineNumber);
    this.assertMaxLength(room, 50, 'room', lineNumber);
    this.assertMaxLength(sectionType, 20, 'sectionType', lineNumber);
    this.assertMaxLength(openingGroup, 5, 'openingGroup', lineNumber);
    this.assertMaxLength(sectionStatus, 50, 'sectionStatus', lineNumber);

    return {
      sectionCode,
      linkedSectionCode,
      courseId,
      semester,
      dayOfWeek,
      timeOfDay,
      startPeriod,
      endPeriod,
      timeRange,
      weekRange,
      room,
      sectionType,
      openingGroup,
      sectionStatus,
      requiresLab,
      note,
      maxCapacity,
      registeredCount,
    };
  }

  private validateClassSectionRow(row: ClassSectionCsvRow, lineNumber: number) {
    const instance = plainToInstance(ClassSectionCsvRow, row);
    const errors = validateSync(instance);

    if (errors.length === 0) {
      return instance;
    }

    const messages = errors
      .flatMap((error) => Object.values(error.constraints ?? {}))
      .join(', ');

    throw new Error(`Invalid CSV row ${lineNumber}: ${messages}`);
  }

  private parseScheduleCsv(text: string): ParsedClassSectionRow[] {
    const lines = text.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => {
      const headers = this.parseCsvLine(line).map((value) => value.trim());
      return (
        headers.includes('Kỳ') &&
        headers.includes('Mã_lớp') &&
        headers.includes('Mã_HP')
      );
    });

    if (headerIndex === -1) {
      throw new BadRequestException('Schedule CSV header row was not found');
    }

    const headers = this.parseCsvLine(lines[headerIndex]).map((header) =>
      header.trim(),
    );

    this.assertRequiredHeaders(headers, [
      'Kỳ',
      'Mã_lớp',
      'Mã_lớp_kèm',
      'Mã_HP',
      'Ghi_chú',
      'Thứ',
      'Thời_gian',
      'BĐ',
      'KT',
      'Kíp',
      'Tuần',
      'Phòng',
      'Cần_TN',
      'SLĐK',
      'SL_Max',
      'Trạng_thái',
      'Loại_lớp',
      'Đợt_mở',
    ]);

    return lines
      .slice(headerIndex + 1)
      .map((line, index) => ({
        line,
        lineNumber: headerIndex + index + 2,
      }))
      .filter(({ line }) => line.replace(/[,"]/g, '').trim().length > 0)
      .map(({ line, lineNumber }) => {
        const values = this.parseCsvLine(line);

        return {
          lineNumber,
          row: {
            semester: this.getCsvValue(headers, values, 'Kỳ'),
            sectionCode: this.getCsvValue(headers, values, 'Mã_lớp'),
            linkedSectionCode: this.getCsvValue(headers, values, 'Mã_lớp_kèm'),
            courseCode: this.getCsvValue(headers, values, 'Mã_HP'),
            note: this.getCsvValue(headers, values, 'Ghi_chú'),
            dayOfWeek: this.getCsvValue(headers, values, 'Thứ'),
            timeRange: this.getCsvValue(headers, values, 'Thời_gian'),
            startPeriod: this.getCsvValue(headers, values, 'BĐ'),
            endPeriod: this.getCsvValue(headers, values, 'KT'),
            timeOfDay: this.getCsvValue(headers, values, 'Kíp'),
            weekRange: this.getCsvValue(headers, values, 'Tuần'),
            room: this.getCsvValue(headers, values, 'Phòng'),
            requiresLab: this.getCsvValue(headers, values, 'Cần_TN'),
            registeredCount: this.getCsvValue(headers, values, 'SLĐK'),
            maxCapacity: this.getCsvValue(headers, values, 'SL_Max'),
            sectionStatus: this.getCsvValue(headers, values, 'Trạng_thái'),
            sectionType: this.getCsvValue(headers, values, 'Loại_lớp'),
            openingGroup: this.getCsvValue(headers, values, 'Đợt_mở'),
          },
        };
      });
  }

  private async findCourseMap(courseCodes: string[]) {
    const uniqueCourseCodes = [...new Set(courseCodes.filter(Boolean))];

    if (uniqueCourseCodes.length === 0) {
      return new Map<string, string>();
    }

    const courses = await this.prisma.course.findMany({
      where: {
        code: {
          in: uniqueCourseCodes,
        },
      },
      select: {
        id: true,
        code: true,
      },
    });

    return new Map(courses.map((course) => [course.code, course.id]));
  }

  private parseInteger(value: string | undefined, field: string, row: number) {
    const trimmed = value?.trim();
    const parsed = Number(trimmed);

    if (!trimmed || Number.isNaN(parsed)) {
      throw new Error(`Invalid ${field} at row ${row}`);
    }

    return parsed;
  }

  private parseNullableInteger(value?: string) {
    const trimmed = value?.trim();

    if (!trimmed || trimmed.toLowerCase() === 'null') {
      return null;
    }

    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      return null;
    }

    return parsed;
  }

  private parseBooleanFlag(value?: string) {
    const normalized = value?.trim().toLowerCase();

    if (!normalized || normalized === 'null') {
      return false;
    }

    if (['1', 'true', 'x', 'yes', 'tn', 'tb'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no'].includes(normalized)) {
      return false;
    }

    throw new Error(`Invalid requiresLab value: ${value}`);
  }

  private parseTimeOfDay(value?: string) {
    const normalized = value?.trim();

    if (!normalized) {
      return null;
    }

    const timeOfDayMap: Record<string, ClassTimeOfDay> = {
      Sáng: ClassTimeOfDay.MORNING,
      Chiều: ClassTimeOfDay.AFTERNOON,
      Tối: ClassTimeOfDay.EVENING,
    };

    const timeOfDay = timeOfDayMap[normalized];
    if (!timeOfDay) {
      throw new Error(`Invalid timeOfDay value: ${value}`);
    }

    return timeOfDay;
  }

  private parseSectionType(value?: string) {
    const normalized = value?.trim();

    if (!normalized) {
      return null;
    }

    const sectionTypeMap: Record<string, ClassSectionType> = {
      'LT+BT': ClassSectionType.LT_BT,
      TN: ClassSectionType.TN,
      TH: ClassSectionType.TH,
      BT: ClassSectionType.BT,
      LT: ClassSectionType.LT,
      ĐA: ClassSectionType.DA,
      TT: ClassSectionType.TT,
      ĐATN: ClassSectionType.DATN,
      TTTN: ClassSectionType.TTTN,
      TTKT: ClassSectionType.TTKT,
      TTKS: ClassSectionType.TTKS,
      ĐATNKS: ClassSectionType.DATNKS,
      KLTN: ClassSectionType.KLTN,
      KLNC: ClassSectionType.KLNC,
    };

    const sectionType = sectionTypeMap[normalized];
    if (!sectionType) {
      throw new Error(`Invalid sectionType value: ${value}`);
    }

    return sectionType;
  }

  private parseOpeningGroup(value?: string) {
    const normalized = value?.trim();

    if (!normalized) {
      return null;
    }

    const openingGroupMap: Record<string, SectionOpenGroup> = {
      A: SectionOpenGroup.A,
      B: SectionOpenGroup.B,
      AB: SectionOpenGroup.AB,
    };

    const openingGroup = openingGroupMap[normalized];
    if (!openingGroup) {
      throw new Error(`Invalid openingGroup value: ${value}`);
    }

    return openingGroup;
  }

  private parseSectionStatus(value?: string) {
    const normalized = value?.trim();

    if (!normalized) {
      return null;
    }

    const sectionStatusMap: Record<string, ClassSectionStatus> = {
      'Điều chỉnh ĐK': ClassSectionStatus.ADJUSTING_REGISTRATION,
      'Kết thúc ĐK': ClassSectionStatus.REGISTRATION_CLOSED,
      'Huỷ lớp': ClassSectionStatus.CANCELLED,
      'Đang xếp TKB': ClassSectionStatus.SCHEDULING,
      'Đăng ký': ClassSectionStatus.OPEN_FOR_REGISTRATION,
    };

    const sectionStatus = sectionStatusMap[normalized];
    if (!sectionStatus) {
      throw new Error(`Invalid sectionStatus value: ${value}`);
    }

    return sectionStatus;
  }

  private assertMaxLength(
    value: string | null,
    maxLength: number,
    field: string,
    row: number,
  ) {
    if (value && value.length > maxLength) {
      throw new Error(
        `Field ${field} exceeds max length ${maxLength} at row ${row}`,
      );
    }
  }

  private assertRequiredHeaders(headers: string[], requiredHeaders: string[]) {
    const missingHeaders = requiredHeaders.filter(
      (header) => !headers.includes(header),
    );

    if (missingHeaders.length > 0) {
      throw new BadRequestException({
        message: 'CSV is missing required headers',
        missingHeaders,
      });
    }
  }

  private getCsvValue(headers: string[], values: string[], headerName: string) {
    const headerIndex = headers.indexOf(headerName);
    const rawValue = headerIndex === -1 ? '' : (values[headerIndex] ?? '');
    const trimmedValue = rawValue.trim();

    if (trimmedValue.toLowerCase() === 'null') {
      return '';
    }

    return rawValue;
  }

  private buildScheduleKey(row: ImportedClassSectionRow) {
    return `${row.sectionCode}::${row.timeRange}::${row.dayOfWeek}`;
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];

      if (char === '"') {
        const nextChar = line[index + 1];
        if (inQuotes && nextChar === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    values.push(current);
    return values;
  }
}
