import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CourseRedisKey, PrismaService, REDIS_CLIENT } from '@app/shared';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { CreateCourseDto } from './dto/create-course.dto';
import { QueryCoursesDto } from './dto/query-courses.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { CourseImportError } from './types/course-import-error.type';
import { ImportedCourseRow } from './types/imported-course-row.type';
import { UploadedCsvFile } from './types/uploaded-csv-file.type';
import { CoursesHelperService } from './helpers/courses-helper.service';

const COURSE_CACHE_TTL_SECONDS = 30 * 60;
const COURSE_CACHE_LOCK_TTL_MS = 2_000;
const COURSE_CACHE_WAIT_MS = 2;
const COURSE_CACHE_MAX_WAIT_MS = 2_000;

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: CoursesHelperService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) { }

  async findAll(query: QueryCoursesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where = this.helper.buildCourseWhereInput(query);
    const orderBy = this.helper.buildCourseOrderBy(query);
    const cacheKey = this.buildCourseListCacheKey({
      page,
      limit,
      skip,
      where,
      orderBy,
    });

    return this.readThroughCourseCache(cacheKey, async () => {
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
    });
  }

  async findOne(code: string) {
    const normalizedCode = code.trim();
    const cacheKey = CourseRedisKey.one(
      this.hashCachePayload({ code: normalizedCode }),
    );

    const course = await this.readThroughCourseCache(cacheKey, () =>
      this.prisma.course.findUnique({
        where: { code: normalizedCode },
      }),
    );

    if (!course) {
      throw new NotFoundException(`Course not found: ${normalizedCode}`);
    }

    return course;
  }

  async create(createCourseDto: CreateCourseDto) {
    const data = this.helper.toCourseCreateInput(createCourseDto);

    try {
      const course = await this.prisma.course.create({ data });
      await this.clearCoursesCache();
      return course;
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
      const course = await this.prisma.course.update({
        where: { code: normalizedCode },
        data,
      });
      await this.clearCoursesCache();
      return course;
    } catch (error) {
      this.helper.handleCourseWriteError(error, targetCode);
    }
  }

  async remove(code: string) {
    const normalizedCode = code.trim();
    await this.helper.ensureCourseExists(normalizedCode);

    try {
      const course = await this.prisma.course.delete({
        where: { code: normalizedCode },
      });
      await this.clearCoursesCache();
      return course;
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
      await this.clearCoursesCache();

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

  private async readThroughCourseCache<T>(
    cacheKey: string,
    loadFromDb: () => Promise<T>,
  ): Promise<T> {
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return JSON.parse(cached) as T;

      const lockKey = `${cacheKey}:lock`;
      const lockToken = randomUUID();
      const locked = await this.redis.set(
        lockKey,
        lockToken,
        'PX',
        COURSE_CACHE_LOCK_TTL_MS,
        'NX',
      );

      if (locked === 'OK') {
        try {
          const value = await loadFromDb();
          await this.redis.set(
            cacheKey,
            JSON.stringify(value),
            'EX',
            COURSE_CACHE_TTL_SECONDS,
          );
          return value;
        } finally {
          await this.releaseCourseCacheLock(lockKey, lockToken);
        }
      }

      const waitUntil = Date.now() + COURSE_CACHE_MAX_WAIT_MS;
      while (Date.now() < waitUntil) {
        await this.sleep(COURSE_CACHE_WAIT_MS);
        const value = await this.redis.get(cacheKey);
        if (value !== null) return JSON.parse(value) as T;
      }

      return loadFromDb();
    } catch {
      return loadFromDb();
    }
  }

  private async releaseCourseCacheLock(lockKey: string, lockToken: string) {
    await this.redis.eval(
      `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
      `,
      1,
      lockKey,
      lockToken,
    );
  }

  private buildCourseListCacheKey(payload: {
    page: number;
    limit: number;
    skip: number;
    where: Prisma.CourseWhereInput;
    orderBy: Prisma.CourseOrderByWithRelationInput;
  }) {
    return CourseRedisKey.list(this.hashCachePayload(payload));
  }

  private hashCachePayload(payload: unknown) {
    return createHash('sha1')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private async clearCoursesCache() {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          CourseRedisKey.all(),
          'COUNT',
          100,
        );
        cursor = nextCursor;
        const cacheKeys = keys.filter((key) => !key.endsWith(':lock'));
        if (cacheKeys.length > 0) await this.redis.del(...cacheKeys);
      } while (cursor !== '0');
    } catch {
      // DB writes must not fail just because cache invalidation is unavailable.
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
