import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import type { UploadedCsvFile } from './types/uploaded-csv-file.type';
import type { UserCsvRow } from './types/user-csv-row.type';
import type { UserImportError } from './types/user-import-error.type';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryUsersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const where = this.buildUserWhereInput(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: this.userSelect(),
      }),
      this.prisma.user.count({ where }),
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

  async findOne(studentCode: string) {
    const user = await this.prisma.user.findUnique({
      where: { studentCode: studentCode.trim() },
      select: this.userSelect(),
    });

    if (!user) {
      throw new NotFoundException(`User not found: ${studentCode}`);
    }

    return user;
  }

  async create(dto: CreateUserDto) {
    const data = await this.toUserCreateInput(dto);

    try {
      return await this.prisma.user.create({
        data,
        select: this.userSelect(),
      });
    } catch (error) {
      this.handleUserWriteError(error);
    }
  }

  async update(studentCode: string, dto: UpdateUserDto) {
    const normalizedStudentCode = studentCode.trim();
    await this.ensureUserExists(normalizedStudentCode);
    const data = await this.toUserUpdateInput(dto);

    try {
      return await this.prisma.user.update({
        where: { studentCode: normalizedStudentCode },
        data,
        select: this.userSelect(),
      });
    } catch (error) {
      this.handleUserWriteError(error);
    }
  }

  async remove(studentCode: string) {
    const normalizedStudentCode = studentCode.trim();
    await this.ensureUserExists(normalizedStudentCode);

    try {
      return await this.prisma.user.delete({
        where: { studentCode: normalizedStudentCode },
        select: this.userSelect(),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          `Cannot delete user ${normalizedStudentCode} because it is referenced by other records`,
        );
      }

      throw error;
    }
  }

  async importUsers(file: UploadedCsvFile) {
    const text = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const rows = this.parseCsv(text);

    if (rows.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    const errors: UserImportError[] = [];
    const uniqueStudentCodes = new Set<string>();
    const uniqueEmails = new Set<string>();
    const users: Prisma.UserCreateManyInput[] = [];
    let skippedDuplicateRows = 0;

    for (const [index, row] of rows.entries()) {
      const lineNumber = index + 2;

      try {
        const user = await this.toUserCsvCreateInput(row, lineNumber);

        if (
          uniqueStudentCodes.has(user.studentCode) ||
          uniqueEmails.has(user.email)
        ) {
          skippedDuplicateRows += 1;
          continue;
        }

        uniqueStudentCodes.add(user.studentCode);
        uniqueEmails.add(user.email);
        users.push(user);
      } catch (error) {
        errors.push({
          row: lineNumber,
          studentCode: row.studentCode?.trim(),
          email: row.email?.trim(),
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

    const existingUsers = await this.findExistingUsers(
      users.map((user) => user.studentCode),
      users.map((user) => user.email),
    );
    const filteredUsers = users.filter(
      (user) =>
        !existingUsers.studentCodes.has(user.studentCode) &&
        !existingUsers.emails.has(user.email),
    );

    if (filteredUsers.length === 0) {
      return {
        fileName: file.originalname,
        totalRows: rows.length,
        inserted: 0,
        skippedDuplicateRows,
        skippedExisting: users.length,
      };
    }

    try {
      const result = await this.prisma.user.createMany({
        data: filteredUsers,
        skipDuplicates: true,
      });

      return {
        fileName: file.originalname,
        totalRows: rows.length,
        inserted: result.count,
        skippedDuplicateRows,
        skippedExisting: users.length - filteredUsers.length,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new BadRequestException({
          message: 'Database rejected the user import',
          code: error.code,
          detail: error.message,
        });
      }

      throw error;
    }
  }

  private userSelect() {
    return {
      id: true,
      studentCode: true,
      name: true,
      email: true,
      role: true,
      courseYear: true,
      department: true,
      isActive: true,
      createdAt: true,
    } satisfies Prisma.UserSelect;
  }

  private buildUserWhereInput(query: QueryUsersDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};
    const q = query.q?.trim();

    if (q) {
      where.OR = [
        { studentCode: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (query.role !== undefined) {
      where.role = query.role;
    }

    if (query.courseYear !== undefined) {
      where.courseYear = query.courseYear;
    }

    if (query.department?.trim()) {
      where.department = {
        contains: query.department.trim(),
        mode: 'insensitive',
      };
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    return where;
  }

  private async toUserCreateInput(
    dto: CreateUserDto,
  ): Promise<Prisma.UserCreateInput> {
    return {
      studentCode: dto.studentCode.trim(),
      name: dto.name.trim(),
      email: dto.email.trim().toLowerCase(),
      password: await bcrypt.hash(dto.password.trim(), 10),
      role: dto.role ?? UserRole.STUDENT,
      courseYear: dto.courseYear ?? null,
      department: dto.department?.trim() || null,
      isActive: dto.isActive ?? true,
    };
  }

  private async toUserUpdateInput(
    dto: UpdateUserDto,
  ): Promise<Prisma.UserUpdateInput> {
    const data: Prisma.UserUpdateInput = {};

    if (dto.studentCode !== undefined) {
      data.studentCode = dto.studentCode.trim();
    }

    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }

    if (dto.email !== undefined) {
      data.email = dto.email.trim().toLowerCase();
    }

    if (dto.password !== undefined) {
      data.password = await bcrypt.hash(dto.password.trim(), 10);
    }

    if (dto.role !== undefined) {
      data.role = dto.role;
    }

    if (dto.courseYear !== undefined) {
      data.courseYear = dto.courseYear;
    }

    if (dto.department !== undefined) {
      data.department = dto.department.trim() || null;
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    return data;
  }

  private async toUserCsvCreateInput(
    row: UserCsvRow,
    lineNumber: number,
  ): Promise<Prisma.UserCreateManyInput> {
    const studentCode = row.studentCode?.trim();
    const name = row.name?.trim();
    const email = row.email?.trim().toLowerCase();
    const password = row.password?.trim();
    const department = row.department?.trim() || null;
    const role = this.parseUserRole(row.role, lineNumber);
    const courseYear = this.parseOptionalInteger(
      row.courseYear,
      'courseYear',
      lineNumber,
    );
    const isActive =
      this.parseOptionalBoolean(row.isActive, 'isActive', lineNumber) ?? true;

    if (!studentCode) throw new Error('Missing studentCode');
    if (!name) throw new Error('Missing name');
    if (!email) throw new Error('Missing email');
    if (!password) throw new Error('Missing password');

    this.assertMaxLength(studentCode, 20, 'studentCode', lineNumber);
    this.assertMaxLength(name, 200, 'name', lineNumber);
    this.assertMaxLength(email, 200, 'email', lineNumber);
    this.assertMaxLength(department, 100, 'department', lineNumber);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Invalid email at row ${lineNumber}`);
    }

    return {
      studentCode,
      name,
      email,
      password: await bcrypt.hash(password, 10),
      role,
      courseYear,
      department,
      isActive,
    };
  }

  private async ensureUserExists(studentCode: string) {
    const user = await this.prisma.user.findUnique({
      where: { studentCode },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`User not found: ${studentCode}`);
    }
  }

  private handleUserWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('User studentCode or email already exists');
      }

      throw new BadRequestException({
        message: 'Database rejected the user write',
        code: error.code,
        detail: error.message,
      });
    }

    throw error;
  }

  private parseUserRole(value: string | undefined, row: number) {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) return UserRole.STUDENT;

    if (normalized === UserRole.STUDENT || normalized === UserRole.ADMIN) {
      return normalized;
    }

    throw new Error(`Invalid role at row ${row}`);
  }

  private parseOptionalInteger(
    value: string | undefined,
    field: string,
    row: number,
  ) {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      throw new Error(`Invalid ${field} at row ${row}`);
    }

    return parsed;
  }

  private parseOptionalBoolean(
    value: string | undefined,
    field: string,
    row: number,
  ) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return null;

    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;

    throw new Error(`Invalid ${field} at row ${row}`);
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

  private async findExistingUsers(studentCodes: string[], emails: string[]) {
    if (studentCodes.length === 0 && emails.length === 0) {
      return {
        studentCodes: new Set<string>(),
        emails: new Set<string>(),
      };
    }

    const users = await this.prisma.user.findMany({
      where: {
        OR: [{ studentCode: { in: studentCodes } }, { email: { in: emails } }],
      },
      select: {
        studentCode: true,
        email: true,
      },
    });

    return {
      studentCodes: new Set(users.map((user) => user.studentCode)),
      emails: new Set(users.map((user) => user.email)),
    };
  }

  private parseCsv(text: string): UserCsvRow[] {
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

      return {
        studentCode: this.getCsvValue(headers, values, [
          'studentCode',
          'student_code',
        ]),
        name: this.getCsvValue(headers, values, 'name'),
        email: this.getCsvValue(headers, values, 'email'),
        password: this.getCsvValue(headers, values, 'password'),
        role: this.getCsvValue(headers, values, 'role'),
        courseYear: this.getCsvValue(headers, values, [
          'courseYear',
          'course_year',
        ]),
        department: this.getCsvValue(headers, values, 'department'),
        isActive: this.getCsvValue(headers, values, ['isActive', 'is_active']),
      };
    });
  }

  private getCsvValue(
    headers: string[],
    values: string[],
    keys: string | string[],
  ) {
    const candidateKeys = Array.isArray(keys) ? keys : [keys];
    const index = candidateKeys
      .map((key) => headers.indexOf(key))
      .find((headerIndex) => headerIndex !== -1);

    return index === undefined ? '' : (values[index] ?? '');
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
