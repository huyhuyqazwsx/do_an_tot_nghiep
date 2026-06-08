import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  getRegistrationLocalDateTimeParts,
  getRegistrationSlotEffectiveCloseAt,
  getRegistrationSlotNextOpenAt,
  isRegistrationSlotActiveAt,
  PrismaService,
  REDIS_CLIENT,
  registrationLocalDateTimeToDate,
  RegistrationRedisKey,
  type LocalDateTimeParts,
} from '@app/shared';
import { Prisma, type RegistrationSlot } from '@prisma/client';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import type { CreateSlotDto } from './dto/create-slot.dto';
import type { UpdateSlotDto } from './dto/update-slot.dto';
import { SettingsService } from '../settings/settings.service';

const REGISTRATION_SLOT_CACHE_TTL_SECONDS = 30 * 60;
const REGISTRATION_SLOT_CACHE_LOCK_TTL_MS = 5_000;
const REGISTRATION_SLOT_CACHE_WAIT_MS = 50;
const REGISTRATION_SLOT_CACHE_MAX_WAIT_MS = 1_000;
type CachedRegistrationSlot = Omit<RegistrationSlot, 'createdAt'> & {
  createdAt: string;
};

type RegistrationWindowStatus = 'UPCOMING' | 'RUNNING' | 'CLOSED';
type RegistrationSlotStatus =
  | 'UPCOMING'
  | 'RUNNING'
  | 'CLOSED'
  | 'NOT_ASSIGNED';
@Injectable()
export class RegistrationSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async findAll(semester?: string) {
    const where = semester ? { semester: semester.trim() } : {};
    return this.prisma.registrationSlot.findMany({
      where,
      orderBy: [
        { startDate: 'asc' },
        { startTime: 'asc' },
        { studentCodeFrom: 'asc' },
      ],
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
    const settings = await this.settingsService.getAll();
    this.assertCurrentSemester(dto.semester.trim(), settings.currentSemester);
    const studentCodeFrom = this.normalizeStudentCode(
      dto.studentCodeFrom,
      'studentCodeFrom',
    );
    const studentCodeTo = this.normalizeStudentCode(
      dto.studentCodeTo,
      'studentCodeTo',
    );
    const startDate = this.normalizeDateString(dto.startDate, 'startDate');
    const endDate = this.normalizeDateString(dto.endDate, 'endDate');
    const startTime = this.normalizeTimeString(dto.startTime, 'startTime');
    const endTime = this.normalizeTimeString(dto.endTime, 'endTime');
    this.assertValidSlotRange(
      studentCodeFrom,
      studentCodeTo,
      startDate,
      endDate,
      startTime,
      endTime,
    );
    this.assertSlotWithinCurrentRegistrationWindow(
      settings,
      startDate,
      endDate,
      startTime,
      endTime,
    );

    const slot = await this.prisma.registrationSlot.create({
      data: {
        semester: dto.semester.trim(),
        name: dto.name?.trim() || null,
        studentCodeFrom,
        studentCodeTo,
        startDate,
        endDate,
        startTime,
        endTime,
      } satisfies Prisma.RegistrationSlotCreateInput,
    });

    await this.clearRegistrationSlotsCache(slot.semester);
    return slot;
  }

  async update(id: string, dto: UpdateSlotDto) {
    const settings = await this.settingsService.getAll();
    const current = await this.findOne(id);
    const semester =
      dto.semester !== undefined ? dto.semester.trim() : current.semester;
    this.assertCurrentSemester(semester, settings.currentSemester);
    const studentCodeFrom =
      dto.studentCodeFrom !== undefined
        ? this.normalizeStudentCode(dto.studentCodeFrom, 'studentCodeFrom')
        : current.studentCodeFrom;
    const studentCodeTo =
      dto.studentCodeTo !== undefined
        ? this.normalizeStudentCode(dto.studentCodeTo, 'studentCodeTo')
        : current.studentCodeTo;
    const startDate =
      dto.startDate !== undefined
        ? this.normalizeDateString(dto.startDate, 'startDate')
        : current.startDate;
    const endDate =
      dto.endDate !== undefined
        ? this.normalizeDateString(dto.endDate, 'endDate')
        : current.endDate;
    const startTime =
      dto.startTime !== undefined
        ? this.normalizeTimeString(dto.startTime, 'startTime')
        : current.startTime;
    const endTime =
      dto.endTime !== undefined
        ? this.normalizeTimeString(dto.endTime, 'endTime')
        : current.endTime;
    this.assertValidSlotRange(
      studentCodeFrom,
      studentCodeTo,
      startDate,
      endDate,
      startTime,
      endTime,
    );
    this.assertSlotWithinCurrentRegistrationWindow(
      settings,
      startDate,
      endDate,
      startTime,
      endTime,
    );

    const slot = await this.prisma.registrationSlot.update({
      where: { id },
      data: {
        semester,
        ...(dto.name !== undefined ? { name: dto.name.trim() || null } : {}),
        ...(dto.studentCodeFrom !== undefined ? { studentCodeFrom } : {}),
        ...(dto.studentCodeTo !== undefined ? { studentCodeTo } : {}),
        ...(dto.startDate !== undefined ? { startDate } : {}),
        ...(dto.endDate !== undefined ? { endDate } : {}),
        ...(dto.startTime !== undefined ? { startTime } : {}),
        ...(dto.endTime !== undefined ? { endTime } : {}),
      } satisfies Prisma.RegistrationSlotUpdateInput,
    });

    await this.clearRegistrationSlotsCache(current.semester);
    if (slot.semester !== current.semester) {
      await this.clearRegistrationSlotsCache(slot.semester);
    }

    return slot;
  }

  async findCurrentForStudent(
    semester: string,
    studentCode: string,
    at = new Date(),
  ) {
    const normalizedSemester = semester.trim();
    const normalizedStudentCode = this.normalizeStudentCode(studentCode);
    const settings = await this.settingsService.getAll();
    if (normalizedSemester !== settings.currentSemester) return null;
    const windowStatus = this.getRegistrationWindowStatus(settings, at);
    if (windowStatus !== 'RUNNING') return null;
    const parts = this.getLocalDateTimeParts(at);
    const slots = await this.getSlotsForSemester(normalizedSemester);

    return (
      slots.find(
        (slot) =>
          this.isStudentCodeInSlot(normalizedStudentCode, slot) &&
          this.isSlotActiveAt(slot, parts),
      ) ?? null
    );
  }

  async findNextForStudent(
    semester: string,
    studentCode: string,
    at = new Date(),
  ) {
    const normalizedSemester = semester.trim();
    const normalizedStudentCode = this.normalizeStudentCode(studentCode);
    const settings = await this.settingsService.getAll();
    if (normalizedSemester !== settings.currentSemester) return null;
    const windowStatus = this.getRegistrationWindowStatus(settings, at);
    if (windowStatus === 'CLOSED') return null;
    const slots = await this.getSlotsForSemester(normalizedSemester);

    return (
      slots.find(
        (slot) =>
          this.isStudentCodeInSlot(normalizedStudentCode, slot) &&
          this.getNextOpenAt(slot, at) !== null,
      ) ?? null
    );
  }

  async assertStudentCanRegister(semester: string, studentCode: string) {
    const now = new Date();
    const normalizedSemester = semester.trim();
    const normalizedStudentCode = this.normalizeStudentCode(studentCode);
    const settings = await this.settingsService.getAll();
    this.assertCurrentSemester(normalizedSemester, settings.currentSemester);

    const currentSlot = await this.findCurrentForStudent(
      normalizedSemester,
      normalizedStudentCode,
      now,
    );
    if (currentSlot) return currentSlot;

    const nextSlot = await this.findNextForStudent(
      normalizedSemester,
      normalizedStudentCode,
      now,
    );
    const nextOpenAt = nextSlot ? this.getNextOpenAt(nextSlot, now) : null;
    if (nextOpenAt) {
      throw new BadRequestException(
        `Sinh viên ${studentCode} chưa đến khung giờ đăng ký. Còn ${this.formatDuration(nextOpenAt.getTime() - now.getTime())} nữa đến lượt.`,
      );
    }

    const slots = await this.getSlotsForSemester(normalizedSemester);
    if (!this.findAssignedSlot(normalizedStudentCode, slots)) {
      throw new BadRequestException(
        `Sinh viên ${studentCode} không thuộc khung giờ đăng ký nào của kỳ ${semester}`,
      );
    }

    const status = this.getRegistrationWindowStatus(settings, now);
    const openAt = new Date(settings.registrationOpenAt);
    if (status === 'UPCOMING') {
      throw new BadRequestException(
        `Chưa đến thời gian đăng ký. Còn ${this.formatDuration(openAt.getTime() - now.getTime())} nữa đến lượt.`,
      );
    }

    throw new BadRequestException('Phiên đăng ký đã kết thúc');
  }

  async remove(id: string) {
    const current = await this.findOne(id);
    const slot = await this.prisma.registrationSlot.delete({ where: { id } });
    await this.clearRegistrationSlotsCache(current.semester);
    return slot;
  }

  async getCurrentRegistrationWindowForStudent(
    semester: string,
    studentCode: string,
    at = new Date(),
  ) {
    const settings = await this.settingsService.getAll();
    if (semester.trim() !== settings.currentSemester) {
      throw new NotFoundException(`Chưa cấu hình kỳ đăng ký ${semester}`);
    }

    const normalizedStudentCode = this.normalizeStudentCode(studentCode);
    const status = this.getRegistrationWindowStatus(settings, at);
    const slots = await this.getSlotsForSemester(settings.currentSemester);
    const currentSlot =
      status === 'RUNNING'
        ? await this.findCurrentForStudent(
            settings.currentSemester,
            normalizedStudentCode,
            at,
          )
        : null;
    const nextSlot = currentSlot
      ? null
      : await this.findNextForStudent(
          settings.currentSemester,
          normalizedStudentCode,
          at,
        );
    const assignedSlot =
      currentSlot ?? nextSlot ?? this.findAssignedSlot(normalizedStudentCode, slots);
    const slotStatus: RegistrationSlotStatus = currentSlot
      ? 'RUNNING'
      : nextSlot
        ? 'UPCOMING'
        : assignedSlot
          ? 'CLOSED'
          : 'NOT_ASSIGNED';

    return {
      semester: settings.currentSemester,
      name: `Đăng ký học phần kỳ ${settings.currentSemester}`,
      openAt: settings.registrationOpenAt,
      closeAt: settings.registrationCloseAt,
      status,
      slotStatus,
      slotWindow: assignedSlot
        ? this.toPublicSlotWindow(assignedSlot, at)
        : null,
      serverTime: at.toISOString(),
      canRegister: status === 'RUNNING' && currentSlot !== null,
    };
  }

  private normalizeStudentCode(
    value: string | undefined,
    field = 'studentCode',
  ) {
    const normalized = value?.trim();
    if (!normalized) {
      throw new BadRequestException(`${field} không được để trống`);
    }

    return normalized;
  }

  private assertValidStudentCodeRange(
    studentCodeFrom: string,
    studentCodeTo: string,
  ) {
    if (studentCodeFrom > studentCodeTo) {
      throw new BadRequestException(
        'studentCodeFrom phải nhỏ hơn hoặc bằng studentCodeTo',
      );
    }
  }

  private normalizeDateString(value: string | undefined, field: string) {
    const normalized = value?.trim();
    if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      throw new BadRequestException(`${field} phải có dạng YYYY-MM-DD`);
    }

    const date = new Date(`${normalized}T00:00:00+07:00`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} không hợp lệ`);
    }

    return normalized;
  }

  private normalizeTimeString(value: string | undefined, field: string) {
    const normalized = value?.trim();
    if (!normalized || !/^\d{2}:\d{2}$/.test(normalized)) {
      throw new BadRequestException(`${field} phải có dạng HH:mm`);
    }

    const [hour, minute] = normalized.split(':').map(Number);
    if (hour > 23 || minute > 59) {
      throw new BadRequestException(`${field} không hợp lệ`);
    }

    return normalized;
  }

  private assertValidSlotRange(
    studentCodeFrom: string,
    studentCodeTo: string,
    startDate: string,
    endDate: string,
    startTime: string,
    endTime: string,
  ) {
    this.assertValidStudentCodeRange(studentCodeFrom, studentCodeTo);

    if (startDate > endDate) {
      throw new BadRequestException(
        'startDate phải nhỏ hơn hoặc bằng endDate của khung đăng ký',
      );
    }

    if (startTime >= endTime) {
      throw new BadRequestException(
        'startTime phải nhỏ hơn endTime của khung đăng ký trong ngày',
      );
    }
  }

  private assertCurrentSemester(semester: string, currentSemester: string) {
    if (semester !== currentSemester) {
      throw new BadRequestException(
        `Chỉ được cấu hình khung đăng ký cho kỳ hiện tại ${currentSemester}`,
      );
    }
  }

  private assertSlotWithinCurrentRegistrationWindow(
    settings: {
      registrationOpenAt: string;
      registrationCloseAt: string;
    },
    startDate: string,
    endDate: string,
    startTime: string,
    endTime: string,
  ) {
    const firstOpenAt = registrationLocalDateTimeToDate(startDate, startTime);
    const lastCloseAt = registrationLocalDateTimeToDate(endDate, endTime);
    const registrationOpenAt = new Date(settings.registrationOpenAt);
    const registrationCloseAt = new Date(settings.registrationCloseAt);

    if (firstOpenAt < registrationOpenAt || lastCloseAt > registrationCloseAt) {
      throw new BadRequestException(
        `Khung đăng ký phải nằm trong thời gian đăng ký của kỳ hiện tại: từ ${registrationOpenAt.toISOString()} đến ${registrationCloseAt.toISOString()}`,
      );
    }
  }

  private async getSlotsForSemester(semester: string) {
    const cacheKey = RegistrationRedisKey.registrationSlots(semester);

    return this.readThroughRegistrationSlotsCache(cacheKey, () =>
      this.loadSlotsFromDb(semester),
    );
  }

  private async loadSlotsFromDb(semester: string) {
    return this.prisma.registrationSlot.findMany({
      where: { semester },
      orderBy: [
        { startDate: 'asc' },
        { startTime: 'asc' },
        { studentCodeFrom: 'asc' },
      ],
    });
  }

  private async readThroughRegistrationSlotsCache(
    cacheKey: string,
    loadFromDb: () => Promise<RegistrationSlot[]>,
  ) {
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return this.parseCachedSlots(cached);

      const lockKey = `${cacheKey}:lock`;
      const lockToken = randomUUID();
      const locked = await this.redis.set(
        lockKey,
        lockToken,
        'PX',
        REGISTRATION_SLOT_CACHE_LOCK_TTL_MS,
        'NX',
      );

      if (locked === 'OK') {
        try {
          const slots = await loadFromDb();
          await this.redis.set(
            cacheKey,
            JSON.stringify(slots.map((slot) => this.toCachedSlot(slot))),
            'EX',
            REGISTRATION_SLOT_CACHE_TTL_SECONDS,
          );
          return slots;
        } finally {
          await this.releaseRegistrationSlotsCacheLock(lockKey, lockToken);
        }
      }

      const waitUntil = Date.now() + REGISTRATION_SLOT_CACHE_MAX_WAIT_MS;
      while (Date.now() < waitUntil) {
        await this.sleep(REGISTRATION_SLOT_CACHE_WAIT_MS);
        const value = await this.redis.get(cacheKey);
        if (value !== null) return this.parseCachedSlots(value);
      }

      return loadFromDb();
    } catch {
      return loadFromDb();
    }
  }

  private parseCachedSlots(value: string): RegistrationSlot[] {
    const cached = JSON.parse(value) as CachedRegistrationSlot[];
    return cached.map((slot) => ({
      ...slot,
      createdAt: new Date(slot.createdAt),
    }));
  }

  private toCachedSlot(slot: RegistrationSlot): CachedRegistrationSlot {
    return {
      ...slot,
      createdAt: slot.createdAt.toISOString(),
    };
  }

  private async releaseRegistrationSlotsCacheLock(
    lockKey: string,
    lockToken: string,
  ) {
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

  private async clearRegistrationSlotsCache(semester: string) {
    try {
      await this.redis.del(RegistrationRedisKey.registrationSlots(semester));
    } catch {
      // DB writes must not fail just because cache invalidation is unavailable.
    }
  }

  private isStudentCodeInSlot(studentCode: string, slot: RegistrationSlot) {
    return (
      slot.studentCodeFrom <= studentCode && slot.studentCodeTo >= studentCode
    );
  }

  private findAssignedSlot(studentCode: string, slots: RegistrationSlot[]) {
    return slots.find((slot) => this.isStudentCodeInSlot(studentCode, slot)) ?? null;
  }

  getNextOpenAt(slot: RegistrationSlot, at = new Date()) {
    return getRegistrationSlotNextOpenAt(slot, at);
  }

  getEffectiveCloseAt(slot: RegistrationSlot, at = new Date()) {
    return getRegistrationSlotEffectiveCloseAt(slot, at);
  }

  private isSlotActiveAt(slot: RegistrationSlot, parts: LocalDateTimeParts) {
    return isRegistrationSlotActiveAt(slot, this.localPartsToDate(parts));
  }

  private getLocalDateTimeParts(date: Date): LocalDateTimeParts {
    return getRegistrationLocalDateTimeParts(date);
  }

  private localPartsToDate(parts: LocalDateTimeParts) {
    return registrationLocalDateTimeToDate(parts.date, parts.time);
  }

  private getRegistrationWindowStatus(
    settings: {
      registrationOpenAt: string;
      registrationCloseAt: string;
    },
    at: Date,
  ): RegistrationWindowStatus {
    const openAt = new Date(settings.registrationOpenAt);
    const closeAt = new Date(settings.registrationCloseAt);
    if (at < openAt) return 'UPCOMING';
    if (at > closeAt) return 'CLOSED';
    return 'RUNNING';
  }

  private toSlotWindow(slot: RegistrationSlot, at = new Date()) {
    const effectiveOpenAt = this.getNextOpenAt(slot, at);
    const effectiveCloseAt = this.getEffectiveCloseAt(slot, at);

    return {
      id: slot.id,
      name: slot.name,
      studentCodeFrom: slot.studentCodeFrom,
      studentCodeTo: slot.studentCodeTo,
      startDate: slot.startDate,
      endDate: slot.endDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      openAt: effectiveOpenAt?.toISOString() ?? null,
      closeAt: effectiveCloseAt?.toISOString() ?? null,
    };
  }

  toPublicSlotWindow(slot: RegistrationSlot | null, at = new Date()) {
    return slot ? this.toSlotWindow(slot, at) : null;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatDuration(ms: number) {
    const totalMinutes = Math.max(Math.ceil(ms / 60_000), 1);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];

    if (days > 0) parts.push(`${days} ngày`);
    if (hours > 0) parts.push(`${hours} giờ`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes} phút`);

    return parts.join(' ');
  }
}
