import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@app/shared';
import type { CreateRegistrationSessionDto } from './dto/create-registration-session.dto';
import type { UpdateRegistrationSessionDto } from './dto/update-registration-session.dto';

@Injectable()
export class RegistrationSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.registrationSession.findMany({
      orderBy: [{ semester: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(semester: string) {
    const session = await this.prisma.registrationSession.findFirst({
      where: { semester },
    });

    if (!session) {
      throw new NotFoundException(`Chưa cấu hình kỳ đăng ký ${semester}`);
    }

    return session;
  }

  async create(dto: CreateRegistrationSessionDto) {
    const data = {
      semester: dto.semester.trim(),
      name: dto.name?.trim(),
      openAt: new Date(dto.openAt),
      closeAt: new Date(dto.closeAt),
      isActive: dto.isActive ?? true,
    };
    this.assertValidRange(data.openAt, data.closeAt);

    try {
      return await this.prisma.registrationSession.create({ data });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(`Kỳ ${dto.semester} đã được cấu hình`);
      }
      throw error;
    }
  }

  async update(semester: string, dto: UpdateRegistrationSessionDto) {
    const current = await this.prisma.registrationSession.findFirst({
      where: { semester },
    });

    if (!current) {
      throw new NotFoundException(`Chưa cấu hình kỳ đăng ký ${semester}`);
    }

    const data = {
      ...(dto.semester !== undefined ? { semester: dto.semester.trim() } : {}),
      ...(dto.name !== undefined ? { name: dto.name?.trim() } : {}),
      ...(dto.openAt !== undefined ? { openAt: new Date(dto.openAt) } : {}),
      ...(dto.closeAt !== undefined ? { closeAt: new Date(dto.closeAt) } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
    const nextOpenAt = data.openAt ?? current.openAt;
    const nextCloseAt = data.closeAt ?? current.closeAt;
    this.assertValidRange(nextOpenAt, nextCloseAt);

    try {
      return await this.prisma.registrationSession.update({
        where: { id: current.id },
        data,
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(`Kỳ ${dto.semester} đã được cấu hình`);
      }
      throw error;
    }
  }

  async remove(semester: string) {
    const session = await this.findOne(semester);

    return this.prisma.registrationSession.delete({
      where: { id: session.id },
    });
  }

  private assertValidRange(openAt: Date, closeAt: Date) {
    if (Number.isNaN(openAt.getTime()) || Number.isNaN(closeAt.getTime())) {
      throw new BadRequestException('Thời gian mở/đóng đăng ký không hợp lệ');
    }

    if (openAt >= closeAt) {
      throw new BadRequestException(
        'Thời gian mở đăng ký phải nhỏ hơn thời gian đóng đăng ký',
      );
    }
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
