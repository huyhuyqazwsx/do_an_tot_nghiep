import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import type { SystemSettings } from './dto/update-settings.dto';

const DEFAULT_SETTINGS: SystemSettings = {
  currentSemester: '20252',
  semesterStartDate: '2026-02-17',
  semesterEndDate: '2026-06-30',
  registrationOpenAt: '2026-05-25T00:00:00.000Z',
  registrationCloseAt: '2026-06-30T16:59:59.000Z',
  maxCreditsPerSemester: 24,
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  // In-memory cache — loaded from DB on startup, updated on PATCH
  private settings: SystemSettings = { ...DEFAULT_SETTINGS };

  constructor(private readonly prisma: PrismaService) { }

  async onModuleInit() {
    const row = await this.prisma.systemSetting.findUnique({ where: { id: 1 } });
    if (row) {
      this.settings = {
        currentSemester: row.currentSemester,
        semesterStartDate: row.semesterStartDate,
        semesterEndDate: row.semesterEndDate,
        registrationOpenAt: row.registrationOpenAt.toISOString(),
        registrationCloseAt: row.registrationCloseAt.toISOString(),
        maxCreditsPerSemester: row.maxCreditsPerSemester,
      };
      this.logger.log(`[Settings] Loaded from DB: semester=${this.settings.currentSemester}`);
    } else {
      this.logger.warn('[Settings] No DB row found, using defaults. Call PATCH /api/settings to persist.');
    }
  }

  getAll(): SystemSettings {
    return { ...this.settings };
  }

  get(key: keyof SystemSettings) {
    return this.settings[key];
  }

  async update(patch: Partial<SystemSettings>): Promise<SystemSettings> {
    // Merge vào memory trước
    const nextSettings = { ...this.settings, ...patch };
    this.assertValidRegistrationRange(
      nextSettings.registrationOpenAt,
      nextSettings.registrationCloseAt,
    );
    this.settings = nextSettings;

    // Upsert vào DB (singleton row id=1)
    await this.prisma.systemSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        currentSemester: this.settings.currentSemester,
        semesterStartDate: this.settings.semesterStartDate,
        semesterEndDate: this.settings.semesterEndDate,
        registrationOpenAt: new Date(this.settings.registrationOpenAt),
        registrationCloseAt: new Date(this.settings.registrationCloseAt),
        maxCreditsPerSemester: this.settings.maxCreditsPerSemester,
      },
      update: {
        ...(patch.currentSemester !== undefined && { currentSemester: patch.currentSemester }),
        ...(patch.semesterStartDate !== undefined && { semesterStartDate: patch.semesterStartDate }),
        ...(patch.semesterEndDate !== undefined && { semesterEndDate: patch.semesterEndDate }),
        ...(patch.registrationOpenAt !== undefined && { registrationOpenAt: new Date(patch.registrationOpenAt) }),
        ...(patch.registrationCloseAt !== undefined && { registrationCloseAt: new Date(patch.registrationCloseAt) }),
        ...(patch.maxCreditsPerSemester !== undefined && { maxCreditsPerSemester: patch.maxCreditsPerSemester }),
      },
    });

    this.logger.log(`[Settings] Updated: ${JSON.stringify(patch)}`);
    return { ...this.settings };
  }

  private assertValidRegistrationRange(openAtValue: string, closeAtValue: string) {
    const openAt = new Date(openAtValue);
    const closeAt = new Date(closeAtValue);

    if (Number.isNaN(openAt.getTime()) || Number.isNaN(closeAt.getTime())) {
      throw new BadRequestException('Thời gian mở/đóng đăng ký không hợp lệ');
    }

    if (openAt >= closeAt) {
      throw new BadRequestException(
        'Thời gian mở đăng ký phải nhỏ hơn thời gian đóng đăng ký',
      );
    }
  }
}
