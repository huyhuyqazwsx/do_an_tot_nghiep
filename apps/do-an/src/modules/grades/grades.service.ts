import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import type { CreateGradeDto } from './dto/create-grade.dto';
import type { UpdateGradeDto } from './dto/update-grade.dto';

// TODO: Add query DTO with pagination, filters (semester, userId, courseId)
interface QueryGradesDto {
  page?: number;
  limit?: number;
  q?: string;
  semester?: string;
  userId?: string;
}

@Injectable()
export class GradesService {
  private readonly logger = new Logger(GradesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // TODO: Implement proper search/filter logic
  async findAll(query: QueryGradesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.semester) where.semester = query.semester;
    if (query.userId) where.userId = query.userId;

    const [items, total] = await Promise.all([
      this.prisma.studentGrade.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              studentCode: true,
              name: true,
              email: true,
              courseYear: true,
              department: true,
            },
          },
          course: {
            select: { id: true, code: true, name: true, credits: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.studentGrade.count({ where }),
    ]);

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // TODO: implement student-level grade summary (all grades of a student)
  async findByStudent(studentCode: string) {
    const user = await this.prisma.user.findUnique({
      where: { studentCode },
    });
    if (!user)
      throw new NotFoundException(`Sinh viên ${studentCode} không tồn tại`);

    const grades = await this.prisma.studentGrade.findMany({
      where: { userId: user.id },
      include: {
        course: { select: { id: true, code: true, name: true, credits: true } },
      },
      orderBy: [{ semester: 'desc' }, { createdAt: 'desc' }],
    });

    return { user, grades };
  }

  async findOne(id: string) {
    const grade = await this.prisma.studentGrade.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, studentCode: true, name: true } },
        course: { select: { id: true, code: true, name: true, credits: true } },
      },
    });
    if (!grade) throw new NotFoundException(`Grade ${id} không tồn tại`);
    return grade;
  }

  // TODO: Validate gradeLetter enum, calculate gradePoint from gradeLetter
  async create(dto: CreateGradeDto) {
    return this.prisma.studentGrade.create({
      data: {
        userId: dto.userId,
        courseId: dto.courseId,
        semester: dto.semester,
        gradeLetter: dto.gradeLetter,
        gradePoint: dto.gradePoint,
        gradeNumber: dto.gradeNumber,
      },
      include: {
        user: { select: { id: true, studentCode: true, name: true } },
        course: { select: { id: true, code: true, name: true, credits: true } },
      },
    });
  }

  // TODO: Recalculate gradePoint when gradeLetter changes
  async update(id: string, dto: UpdateGradeDto) {
    await this.findOne(id);
    return this.prisma.studentGrade.update({
      where: { id },
      data: {
        ...(dto.gradeLetter !== undefined
          ? { gradeLetter: dto.gradeLetter }
          : {}),
        ...(dto.gradePoint !== undefined ? { gradePoint: dto.gradePoint } : {}),
        ...(dto.gradeNumber !== undefined
          ? { gradeNumber: dto.gradeNumber }
          : {}),
      },
      include: {
        user: { select: { id: true, studentCode: true, name: true } },
        course: { select: { id: true, code: true, name: true, credits: true } },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.studentGrade.delete({ where: { id } });
  }
}
