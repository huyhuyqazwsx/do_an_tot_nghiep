import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { CreateRegistrationSessionDto } from './dto/create-registration-session.dto';
import type { UpdateRegistrationSessionDto } from './dto/update-registration-session.dto';

@Injectable()
export class RegistrationSessionsService {
  private readonly logger = new Logger(RegistrationSessionsService.name);

  constructor(private readonly settingsService: SettingsService) {}

  findAll() {
    return [this.getSessionFromSettings()];
  }

  async findOne(semester: string) {
    const session = this.getSessionFromSettings();

    if (semester !== session.semester) {
      throw new NotFoundException(`Chưa cấu hình kỳ đăng ký ${semester}`);
    }

    return session;
  }

  async create(dto: CreateRegistrationSessionDto) {
    const openAt = new Date(dto.openAt);
    const closeAt = new Date(dto.closeAt);
    this.assertValidRange(openAt, closeAt);

    await this.settingsService.update({
      currentSemester: dto.semester.trim(),
      registrationOpenAt: openAt.toISOString(),
      registrationCloseAt: closeAt.toISOString(),
    });

    return this.getSessionFromSettings(dto.name?.trim());
  }

  async update(semester: string, dto: UpdateRegistrationSessionDto) {
    const current = this.getSessionFromSettings();

    if (semester !== current.semester) {
      throw new NotFoundException(`Chưa cấu hình kỳ đăng ký ${semester}`);
    }

    const nextOpenAt =
      dto.openAt !== undefined ? new Date(dto.openAt) : new Date(current.openAt);
    const nextCloseAt =
      dto.closeAt !== undefined
        ? new Date(dto.closeAt)
        : new Date(current.closeAt);
    this.assertValidRange(nextOpenAt, nextCloseAt);

    await this.settingsService.update({
      ...(dto.semester !== undefined ? { currentSemester: dto.semester.trim() } : {}),
      ...(dto.openAt !== undefined
        ? { registrationOpenAt: nextOpenAt.toISOString() }
        : {}),
      ...(dto.closeAt !== undefined
        ? { registrationCloseAt: nextCloseAt.toISOString() }
        : {}),
    });

    return this.getSessionFromSettings(dto.name?.trim() ?? current.name);
  }

  async remove(semester: string) {
    return this.findOne(semester);
  }

  // ─── Student: current session ─────────────────────────────────────────────

  async findCurrent(semester: string) {
    const session = this.getSessionFromSettings();

    if (semester !== session.semester) {
      throw new NotFoundException(`Chưa cấu hình kỳ đăng ký ${semester}`);
    }

    const now = new Date();
    let status: 'UPCOMING' | 'RUNNING' | 'CLOSED';
    let canRegister = false;
    const openAt = new Date(session.openAt);
    const closeAt = new Date(session.closeAt);

    if (now < openAt) {
      status = 'UPCOMING';
    } else if (now > closeAt) {
      status = 'CLOSED';
    } else {
      status = 'RUNNING';
      canRegister = true;
    }

    return {
      id: session.id,
      semester: session.semester,
      name: session.name,
      openAt: openAt.toISOString(),
      closeAt: closeAt.toISOString(),
      isActive: session.isActive,
      status,
      serverTime: now.toISOString(),
      canRegister,
    };
  }

  // ─── Admin: session stats (hardcoded) ─────────────────────────────────────

  async getStats(semester: string) {
    // Verify the session exists
    await this.findOne(semester);

    this.logger.warn(
      `[getStats] Returning hardcoded stats for semester=${semester}. TODO: implement real aggregation.`,
    );

    return {
      semester,
      estimatedStudents: 18230,
      registeredStudents: 12480,
      successRate: 96.4,
      conflictCount: 312,
      averageBatchProcessMs: 1800,
    };
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

  private getSessionFromSettings(name?: string) {
    const settings = this.settingsService.getAll();

    return {
      id: `settings-${settings.currentSemester}`,
      semester: settings.currentSemester,
      name: name ?? `Đăng ký học phần kỳ ${settings.currentSemester}`,
      openAt: settings.registrationOpenAt,
      closeAt: settings.registrationCloseAt,
      isActive: true,
      createdAt: new Date(0).toISOString(),
    };
  }
}
