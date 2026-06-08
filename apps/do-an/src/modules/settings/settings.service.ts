import {
  BadRequestException,
  Injectable,
  Logger,
  Inject,
} from '@nestjs/common';
import { PrismaService, REDIS_CLIENT, RegistrationRedisKey } from '@app/shared';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import type { SystemSettings } from './dto/update-settings.dto';

const DEFAULT_SETTINGS: SystemSettings = {
  currentSemester: '20252',
  semesterStartDate: '2026-02-17',
  semesterEndDate: '2026-06-30',
  registrationOpenAt: '2026-05-25T00:00:00.000Z',
  registrationCloseAt: '2026-06-30T16:59:59.000Z',
  maxCreditsPerSemester: 24,
};
const SETTINGS_CACHE_TTL_SECONDS = 30 * 60;
const SETTINGS_CACHE_LOCK_TTL_MS = 5_000;
const SETTINGS_CACHE_WAIT_MS = 50;
const SETTINGS_CACHE_MAX_WAIT_MS = 1_000;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getAll(): Promise<SystemSettings> {
    const settings = await this.readThroughSettingsCache();
    return { ...settings };
  }

  async get<K extends keyof SystemSettings>(key: K): Promise<SystemSettings[K]> {
    const settings = await this.getAll();
    return settings[key];
  }

  async update(patch: Partial<SystemSettings>): Promise<SystemSettings> {
    const currentSettings = await this.getAll();
    const nextSettings = { ...currentSettings, ...patch };
    this.assertValidRegistrationRange(
      nextSettings.registrationOpenAt,
      nextSettings.registrationCloseAt,
    );

    const row = await this.prisma.systemSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        currentSemester: nextSettings.currentSemester,
        semesterStartDate: nextSettings.semesterStartDate,
        semesterEndDate: nextSettings.semesterEndDate,
        registrationOpenAt: new Date(nextSettings.registrationOpenAt),
        registrationCloseAt: new Date(nextSettings.registrationCloseAt),
        maxCreditsPerSemester: nextSettings.maxCreditsPerSemester,
      },
      update: {
        ...(patch.currentSemester !== undefined && {
          currentSemester: patch.currentSemester,
        }),
        ...(patch.semesterStartDate !== undefined && {
          semesterStartDate: patch.semesterStartDate,
        }),
        ...(patch.semesterEndDate !== undefined && {
          semesterEndDate: patch.semesterEndDate,
        }),
        ...(patch.registrationOpenAt !== undefined && {
          registrationOpenAt: new Date(patch.registrationOpenAt),
        }),
        ...(patch.registrationCloseAt !== undefined && {
          registrationCloseAt: new Date(patch.registrationCloseAt),
        }),
        ...(patch.maxCreditsPerSemester !== undefined && {
          maxCreditsPerSemester: patch.maxCreditsPerSemester,
        }),
      },
    });

    const settings = this.toSystemSettings(row);
    await this.writeSettingsCache(settings);

    this.logger.log(`[Settings] Updated: ${JSON.stringify(patch)}`);

    this.logger.log('[Settings] Redis settings cache updated');

    return { ...settings };
  }

  private async readThroughSettingsCache(): Promise<SystemSettings> {
    const cacheKey = RegistrationRedisKey.settings();
    const cached = await this.readSettingsCache();
    if (cached) return cached;

    const lockKey = `${cacheKey}:lock`;
    const lockToken = randomUUID();

    try {
      const locked = await this.redis.set(
        lockKey,
        lockToken,
        'PX',
        SETTINGS_CACHE_LOCK_TTL_MS,
        'NX',
      );

      if (locked === 'OK') {
        try {
          const settings = await this.loadSettingsFromDb();
          await this.writeSettingsCache(settings);
          return settings;
        } finally {
          await this.releaseSettingsCacheLock(lockKey, lockToken);
        }
      }

      const waitUntil = Date.now() + SETTINGS_CACHE_MAX_WAIT_MS;
      while (Date.now() < waitUntil) {
        await this.sleep(SETTINGS_CACHE_WAIT_MS);
        const value = await this.readSettingsCache();
        if (value) return value;
      }

      return this.loadSettingsFromDb();
    } catch (error) {
      this.logger.warn(
        `[Settings] Redis lock unavailable, loading DB directly: ${(error as Error).message}`,
      );
      return this.loadSettingsFromDb();
    }
  }

  private async loadSettingsFromDb(): Promise<SystemSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { id: 1 } });
    if (row) return this.toSystemSettings(row);

    this.logger.warn(
      '[Settings] No DB row found, using defaults. Call PATCH /api/settings to persist.',
    );
    return { ...DEFAULT_SETTINGS };
  }

  private async readSettingsCache(): Promise<SystemSettings | null> {
    const key = RegistrationRedisKey.settings();
    const cached = await this.redis.get(key).catch((error) => {
      this.logger.warn(`[Settings] Redis read failed: ${error.message}`);
      return null;
    });

    if (!cached) return null;

    try {
      const parsed = JSON.parse(cached) as SystemSettings;
      if (!this.isValidSettings(parsed)) {
        await this.redis.del(key);
        return null;
      }
      return parsed;
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  private async writeSettingsCache(settings: SystemSettings) {
    await this.redis
      .set(
        RegistrationRedisKey.settings(),
        JSON.stringify(settings),
        'EX',
        SETTINGS_CACHE_TTL_SECONDS,
      )
      .catch((error) => {
        this.logger.warn(`[Settings] Redis write failed: ${error.message}`);
      });
  }

  private async releaseSettingsCacheLock(lockKey: string, lockToken: string) {
    await this.redis
      .eval(
        `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        end
        return 0
        `,
        1,
        lockKey,
        lockToken,
      )
      .catch((error) => {
        this.logger.warn(`[Settings] Redis lock release failed: ${error.message}`);
      });
  }

  private async deleteRedisKeys(...keys: string[]) {
    if (keys.length === 0) return;

    await this.redis.del(...keys).catch((error) => {
      this.logger.warn(`[Settings] Redis delete failed: ${error.message}`);
    });
  }

  private toSystemSettings(row: {
    currentSemester: string;
    semesterStartDate: string;
    semesterEndDate: string;
    registrationOpenAt: Date;
    registrationCloseAt: Date;
    maxCreditsPerSemester: number;
  }): SystemSettings {
    return {
      currentSemester: row.currentSemester,
      semesterStartDate: row.semesterStartDate,
      semesterEndDate: row.semesterEndDate,
      registrationOpenAt: row.registrationOpenAt.toISOString(),
      registrationCloseAt: row.registrationCloseAt.toISOString(),
      maxCreditsPerSemester: row.maxCreditsPerSemester,
    };
  }

  private isValidSettings(value: SystemSettings) {
    return (
      value !== null &&
      typeof value === 'object' &&
      typeof value.currentSemester === 'string' &&
      typeof value.semesterStartDate === 'string' &&
      typeof value.semesterEndDate === 'string' &&
      typeof value.registrationOpenAt === 'string' &&
      typeof value.registrationCloseAt === 'string' &&
      typeof value.maxCreditsPerSemester === 'number'
    );
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

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
