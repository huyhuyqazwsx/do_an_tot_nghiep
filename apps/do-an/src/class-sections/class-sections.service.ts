import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import {
  ClassSectionStatus,
  ClassSectionType,
  ClassTimeOfDay,
  Prisma,
  SectionOpenGroup,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ClassSectionCsvRow } from './types/class-section-csv-row.type';
import { ClassSectionImportError } from './types/class-section-import-error.type';
import { ImportedClassSectionRow } from './types/imported-class-section-row.type';
import { ParsedClassSectionRow } from './types/parsed-class-section-row.type';
import { UploadedCsvFile } from './types/uploaded-csv-file.type';

// noinspection JSNonASCIINames
@Injectable()
export class ClassSectionsService {
  constructor(private readonly prisma: PrismaService) {}

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

  findAll() {
    return {
      message: 'Class sections list endpoint placeholder',
    };
  }

  findOne(sectionCode: string) {
    return {
      message: 'Class section details endpoint placeholder',
      sectionCode,
    };
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
      .filter(({ line }) => line.trim().length > 0)
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
