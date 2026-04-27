import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCourseDto } from './dto/create-course.dto';
import { QueryCoursesDto } from './dto/query-courses.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { CourseCsvRow } from './types/course-csv-row.type';
import { CourseImportError } from './types/course-import-error.type';
import { UploadedCsvFile } from './types/uploaded-csv-file.type';

interface ImportedCourseRow {
  code: string;
  name: string;
  englishName: string | null;
  credits: number;
  tuitionCredits: number | null;
  courseLoad: string | null;
  department: string | null;
  prerequisite: string | null;
  weight: number;
}

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryCoursesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where = this.buildCourseWhereInput(query);
    const orderBy = this.buildCourseOrderBy(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.course.count({ where }),
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

  async findOne(code: string) {
    const normalizedCode = code.trim();
    const course = await this.prisma.course.findUnique({
      where: { code: normalizedCode },
    });

    if (!course) {
      throw new NotFoundException(`Course not found: ${normalizedCode}`);
    }

    return course;
  }

  async create(createCourseDto: CreateCourseDto) {
    const data = this.toCourseCreateInput(createCourseDto);

    try {
      return await this.prisma.course.create({ data });
    } catch (error) {
      this.handleCourseWriteError(error, data.code);
    }
  }

  async update(code: string, updateCourseDto: UpdateCourseDto) {
    const normalizedCode = code.trim();
    await this.ensureCourseExists(normalizedCode);

    const data = this.toCourseUpdateInput(updateCourseDto);
    const targetCode = updateCourseDto.code?.trim() || normalizedCode;

    try {
      return await this.prisma.course.update({
        where: { code: normalizedCode },
        data,
      });
    } catch (error) {
      this.handleCourseWriteError(error, targetCode);
    }
  }

  async remove(code: string) {
    const normalizedCode = code.trim();
    await this.ensureCourseExists(normalizedCode);

    try {
      return await this.prisma.course.delete({
        where: { code: normalizedCode },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          `Cannot delete course ${normalizedCode} because it is referenced by other records`,
        );
      }

      throw error;
    }
  }

  async importCourses(file: UploadedCsvFile) {
    const text = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const rows = this.parseCsv(text);

    if (rows.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    const errors: CourseImportError[] = [];
    const uniqueCourseCodes = new Set<string>();
    const data: ImportedCourseRow[] = [];

    for (const [index, row] of rows.entries()) {
      const lineNumber = index + 2;

      try {
        const validatedRow = this.validateCourseRow(row, lineNumber);
        const courseData = this.toCourseInput(validatedRow, lineNumber);

        if (uniqueCourseCodes.has(courseData.code)) {
          throw new Error(`Duplicate course code in CSV: ${courseData.code}`);
        }

        uniqueCourseCodes.add(courseData.code);
        data.push(courseData);
      } catch (error) {
        errors.push({
          row: lineNumber,
          code: row.code?.trim(),
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

    const existingCourseCodes = await this.findExistingCourseCodes(
      data.map((course) => course.code),
    );
    const filteredData = data.filter(
      (course) => !existingCourseCodes.has(course.code),
    );

    if (filteredData.length === 0) {
      return {
        fileName: file.originalname,
        totalRows: rows.length,
        inserted: 0,
        skippedExisting: existingCourseCodes.size,
      };
    }

    try {
      const result = await this.prisma.course.createMany({
        data: filteredData,
        skipDuplicates: true,
      });

      return {
        fileName: file.originalname,
        totalRows: rows.length,
        inserted: result.count,
        skippedExisting: existingCourseCodes.size,
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

  private buildCourseWhereInput(
    query: QueryCoursesDto,
  ): Prisma.CourseWhereInput {
    const where: Prisma.CourseWhereInput = {};
    const q = query.q?.trim();
    const department = query.department?.trim();

    if (q) {
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { englishName: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (department) {
      where.department = { contains: department, mode: 'insensitive' };
    }

    if (query.credits !== undefined) {
      where.credits = query.credits;
    } else if (
      query.minCredits !== undefined ||
      query.maxCredits !== undefined
    ) {
      where.credits = {
        gte: query.minCredits,
        lte: query.maxCredits,
      };
    }

    return where;
  }

  private buildCourseOrderBy(
    query: QueryCoursesDto,
  ): Prisma.CourseOrderByWithRelationInput {
    const sortBy = query.sortBy ?? 'code';
    const sortOrder = query.sortOrder ?? 'asc';

    return {
      [sortBy]: sortOrder,
    };
  }

  private toCourseCreateInput(
    dto: CreateCourseDto,
  ): Prisma.CourseUncheckedCreateInput {
    return {
      code: dto.code.trim(),
      name: dto.name.trim(),
      englishName: dto.englishName?.trim() || null,
      credits: dto.credits,
      tuitionCredits: dto.tuitionCredits,
      courseLoad: dto.courseLoad?.trim() || null,
      department: dto.department?.trim() || null,
      prerequisite: dto.prerequisite?.trim() || null,
      weight: dto.weight ?? 1,
    };
  }

  private toCourseUpdateInput(
    dto: UpdateCourseDto,
  ): Prisma.CourseUncheckedUpdateInput {
    const data: Prisma.CourseUncheckedUpdateInput = {};

    if (dto.code !== undefined) {
      data.code = dto.code.trim();
    }

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.englishName !== undefined) {
      data.englishName = dto.englishName.trim() || null;
    }

    if (dto.credits !== undefined) {
      data.credits = dto.credits;
    }

    if (dto.tuitionCredits !== undefined) {
      data.tuitionCredits = dto.tuitionCredits;
    }

    if (dto.courseLoad !== undefined) {
      data.courseLoad = dto.courseLoad.trim() || null;
    }

    if (dto.department !== undefined) {
      data.department = dto.department.trim() || null;
    }

    if (dto.prerequisite !== undefined) {
      data.prerequisite = dto.prerequisite.trim() || null;
    }

    if (dto.weight !== undefined) {
      data.weight = dto.weight;
    }

    return data;
  }

  private async ensureCourseExists(code: string) {
    const existingCourse = await this.prisma.course.findUnique({
      where: { code },
      select: { id: true },
    });

    if (!existingCourse) {
      throw new NotFoundException(`Course not found: ${code}`);
    }
  }

  private handleCourseWriteError(error: unknown, code: string) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException(`Course code already exists: ${code}`);
      }

      throw new BadRequestException({
        message: 'Database rejected the course write',
        code: error.code,
        detail: error.message,
      });
    }

    throw error;
  }

  private toCourseInput(
    row: CourseCsvRow,
    lineNumber: number,
  ): ImportedCourseRow {
    const code = row.code?.trim();
    const name = row.name?.trim();
    const englishName = row.english_name?.trim() || null;
    const courseLoad = row.duration?.trim() || null;
    const department = row.department?.trim() || null;
    const prerequisite = row.prerequisite?.trim() || null;
    const credits = this.parseInteger(row.credits, 'credits', lineNumber);
    const tuitionCredits = this.parseOptionalFloat(row.tuition_credits);
    const weight = this.parseOptionalFloat(row.weight) ?? 1;

    if (!code) {
      throw new Error('Missing course code');
    }

    if (!name) {
      throw new Error('Missing course name');
    }

    this.assertMaxLength(code, 20, 'code', lineNumber);
    this.assertMaxLength(name, 300, 'name', lineNumber);
    this.assertMaxLength(englishName, 300, 'english_name', lineNumber);
    this.assertMaxLength(courseLoad, 20, 'duration', lineNumber);
    this.assertMaxLength(department, 100, 'department', lineNumber);

    return {
      code,
      name,
      englishName,
      credits,
      tuitionCredits,
      courseLoad,
      department,
      prerequisite,
      weight,
    };
  }

  private validateCourseRow(row: CourseCsvRow, lineNumber: number) {
    const instance = plainToInstance(CourseCsvRow, row);
    const errors = validateSync(instance);

    if (errors.length === 0) {
      return instance;
    }

    const messages = errors
      .flatMap((error) => Object.values(error.constraints ?? {}))
      .join(', ');

    throw new Error(`Invalid CSV row ${lineNumber}: ${messages}`);
  }

  private parseInteger(value: string | undefined, field: string, row: number) {
    const trimmed = value?.trim();
    const parsed = Number(trimmed);

    if (!trimmed || Number.isNaN(parsed)) {
      throw new Error(`Invalid ${field} at row ${row}`);
    }

    return parsed;
  }

  private parseOptionalFloat(value: string | undefined) {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      return null;
    }

    return parsed;
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

  private parseCsv(text: string): CourseCsvRow[] {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length < 2) {
      return [];
    }

    const headers = this.parseCsvLine(lines[0]).map((header) => header.trim());

    return lines.slice(1).map((line) => {
      const values = this.parseCsvLine(line);
      const codeIndex = headers.indexOf('code');
      const nameIndex = headers.indexOf('name');
      const durationIndex = headers.indexOf('duration');
      const creditsIndex = headers.indexOf('credits');
      const tuitionCreditsIndex = headers.indexOf('tuition_credits');
      const departmentIndex = headers.indexOf('department');
      const prerequisiteIndex = headers.indexOf('prerequisite');
      const englishNameIndex = headers.indexOf('english_name');
      const weightIndex = headers.indexOf('weight');

      return {
        code: codeIndex === -1 ? '' : (values[codeIndex] ?? ''),
        name: nameIndex === -1 ? '' : (values[nameIndex] ?? ''),
        duration: durationIndex === -1 ? '' : (values[durationIndex] ?? ''),
        credits: creditsIndex === -1 ? '' : (values[creditsIndex] ?? ''),
        tuition_credits:
          tuitionCreditsIndex === -1 ? '' : (values[tuitionCreditsIndex] ?? ''),
        department:
          departmentIndex === -1 ? '' : (values[departmentIndex] ?? ''),
        prerequisite:
          prerequisiteIndex === -1 ? '' : (values[prerequisiteIndex] ?? ''),
        english_name:
          englishNameIndex === -1 ? '' : (values[englishNameIndex] ?? ''),
        weight: weightIndex === -1 ? '' : (values[weightIndex] ?? ''),
      };
    });
  }

  private async findExistingCourseCodes(courseCodes: string[]) {
    if (courseCodes.length === 0) {
      return new Set<string>();
    }

    const existingCourses = await this.prisma.course.findMany({
      where: {
        code: {
          in: courseCodes,
        },
      },
      select: {
        code: true,
      },
    });

    return new Set(existingCourses.map((course) => course.code));
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];

      if (char === '"') {
        const nextChar = line[i + 1];
        if (inQuotes && nextChar === '"') {
          current += '"';
          i += 1;
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
