import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { Prisma } from '@prisma/client';
import type { CreateSlotDto } from './dto/create-slot.dto';
import type { UpdateSlotDto } from './dto/update-slot.dto';

@Injectable()
export class RegistrationSlotsService {
  private readonly logger = new Logger(RegistrationSlotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(semester?: string) {
    const where = semester ? { semester } : {};
    return this.prisma.registrationSlot.findMany({
      where,
      orderBy: { openAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const slot = await this.prisma.registrationSlot.findUnique({
      where: { id },
    });
    if (!slot) throw new NotFoundException(`Slot ${id} không tồn tại`);
    return slot;
  }

  async create(dto: CreateSlotDto) {
    // TODO: validate time ranges
    return this.prisma.registrationSlot.create({
      data: {
        semester: dto.semester.trim(),
        name: dto.name,
        studentFilter: (dto.studentFilter ?? {}) as Prisma.InputJsonValue,
        openAt: new Date(dto.openAt),
        closeAt: new Date(dto.closeAt),
        prewarmAt: new Date(dto.prewarmAt),
      },
    });
  }

  async update(id: string, dto: UpdateSlotDto) {
    await this.findOne(id);
    return this.prisma.registrationSlot.update({
      where: { id },
      data: {
        ...(dto.semester !== undefined ? { semester: dto.semester.trim() } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.studentFilter !== undefined
          ? { studentFilter: dto.studentFilter as Prisma.InputJsonValue }
          : {}),
        ...(dto.openAt !== undefined ? { openAt: new Date(dto.openAt) } : {}),
        ...(dto.closeAt !== undefined
          ? { closeAt: new Date(dto.closeAt) }
          : {}),
        ...(dto.prewarmAt !== undefined
          ? { prewarmAt: new Date(dto.prewarmAt) }
          : {}),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.registrationSlot.delete({ where: { id } });
  }

  // TODO: Implement actual Redis prewarm logic — load all class sections to Redis
  async triggerPrewarm(id: string) {
    await this.findOne(id);

    this.logger.warn(
      `[triggerPrewarm] TODO: Actually load class sections to Redis for slot ${id}`,
    );

    // TODO: Call Redis prewarm service, update isPrewarmed & prewarmedAt
    return this.prisma.registrationSlot.update({
      where: { id },
      data: {
        isPrewarmed: true,
        prewarmedAt: new Date(),
      },
    });
  }
}
