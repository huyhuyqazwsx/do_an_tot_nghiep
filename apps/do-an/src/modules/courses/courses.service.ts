import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { Prisma } from '@prisma/client';
import { CreateCourseDto } from './dto/create-course.dto';
import { QueryCoursesDto } from './dto/query-courses.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { CourseImportError } from './types/course-import-error.type';
import { ImportedCourseRow } from './types/imported-course-row.type';
import { UploadedCsvFile } from './types/uploaded-csv-file.type';
import { CoursesHelperService } from './helpers/courses-helper.service';

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: CoursesHelperService,
  ) {}

  async findAll(query: QueryCoursesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where = this.helper.buildCourseWhereInput(query);
    const orderBy = this.helper.buildCourseOrderBy(query);

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
    const data = this.helper.toCourseCreateInput(createCourseDto);

    try {
      return await this.prisma.course.create({ data });
    } catch (error) {
      this.helper.handleCourseWriteError(error, data.code);
    }
  }

  async update(code: string, updateCourseDto: UpdateCourseDto) {
    const normalizedCode = code.trim();
    await this.helper.ensureCourseExists(normalizedCode);

    const data = this.helper.toCourseUpdateInput(updateCourseDto);
    const targetCode = updateCourseDto.code?.trim() || normalizedCode;

    try {
      return await this.prisma.course.update({
        where: { code: normalizedCode },
        data,
      });
    } catch (error) {
      this.helper.handleCourseWriteError(error, targetCode);
    }
  }

  async remove(code: string) {
    const normalizedCode = code.trim();
    await this.helper.ensureCourseExists(normalizedCode);

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
    const rows = this.helper.parseCsv(text);

    if (rows.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    const errors: CourseImportError[] = [];
    const uniqueCourseCodes = new Set<string>();
    const data: ImportedCourseRow[] = [];

    for (const [index, row] of rows.entries()) {
      const lineNumber = index + 2;

      try {
        const validatedRow = this.helper.validateCourseRow(row, lineNumber);
        const courseData = this.helper.toCourseInput(validatedRow, lineNumber);

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

    const existingCourseCodes = await this.helper.findExistingCourseCodes(
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
}
