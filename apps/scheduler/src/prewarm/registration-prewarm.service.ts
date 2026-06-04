import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { REDIS_CLIENT } from '@app/shared';
import { RegistrationRedisKey } from '@app/shared';
import Redis from 'ioredis';
import type { RegistrationSlot, SystemSetting } from '@prisma/client';

const PREWARM_CACHE_TTL_SECONDS = 30 * 60;

type RegistrationWindow = {
  id: string;
  semester: string;
  openAt: Date;
  closeAt: Date;
  slots: RegistrationSlot[];
};

type CachedSectionByCodeResponse = {
  items: unknown[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

@Injectable()
export class RegistrationPrewarmService {
  private readonly logger = new Logger(RegistrationPrewarmService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.redis.on('ready', () => {
      this.healIfNeeded().catch((err: Error) =>
        this.logger.error(
          `[Prewarm] Auto-heal error: ${err.message}`,
          err.stack,
        ),
      );
    });
  }

  async prewarmCurrentSettings(
    settings: SystemSetting,
    slots?: RegistrationSlot[],
  ): Promise<void> {
    const semester = settings.currentSemester;
    const window: RegistrationWindow = {
      id: `settings-${semester}`,
      semester,
      openAt: settings.registrationOpenAt,
      closeAt: settings.registrationCloseAt,
      slots:
        slots ??
        (await this.prisma.registrationSlot.findMany({
          where: { semester },
        })),
    };

    await this.prewarmWindow(window);
  }

  async prewarmWindow(window: RegistrationWindow): Promise<void> {
    const { semester } = window;
    this.logger.log(
      `[Prewarm] Start — semester=${semester} windowId=${window.id}`,
    );

    await this.cacheSessionInfo(window);
    await this.cacheSections(semester);
    await this.cacheSlotAllowed(window.slots);

    // Đánh dấu tất cả slot đã prewarm
    await this.prisma.registrationSlot.updateMany({
      where: { semester },
      data: { isPrewarmed: true, prewarmedAt: new Date() },
    });

    this.logger.log(`[Prewarm] Done — semester=${semester}`);
  }

  /**
   * Tự heal khi Scheduler restart: nếu kỳ hiện tại đang trong thời gian đăng ký mà Redis
   * chưa có data (Redis vừa restart hoặc TTL hết), chạy prewarm lại.
   */
  async healIfNeeded(): Promise<void> {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { id: 1 },
    });

    if (!settings || settings.registrationCloseAt <= new Date()) {
      this.logger.log('[Prewarm] No active registration window — heal skipped');
      return;
    }

    const redisKey = RegistrationRedisKey.session(settings.currentSemester);
    const exists = await this.redis.exists(redisKey);
    if (exists) {
      this.logger.log(
        `[Prewarm] Redis HIT for semester ${settings.currentSemester} — heal skipped`,
      );
      return;
    }

    this.logger.warn(
      `[Prewarm] Redis MISS for semester ${settings.currentSemester} — auto-healing...`,
    );
    await this.prewarmCurrentSettings(settings);
  }

  async reconcileCurrentSemesterSlots(): Promise<void> {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { id: 1 },
    });

    if (!settings) {
      this.logger.warn('[Reconcile] No system settings, skip');
      return;
    }

    const sections = await this.prisma.classSection.findMany({
      where: { semester: settings.currentSemester },
      select: {
        id: true,
        maxCapacity: true,
        registeredCount: true,
      },
    });

    if (sections.length === 0) {
      this.logger.log(
        `[Reconcile] No class sections for semester ${settings.currentSemester}`,
      );
      return;
    }

    const redisValues = await this.redis.mget(
      ...sections.map((section) =>
        RegistrationRedisKey.sectionSlots(section.id),
      ),
    );
    const pipeline = this.redis.pipeline();
    let fixedCount = 0;

    sections.forEach((section, index) => {
      const expected = Math.max(
        section.maxCapacity - section.registeredCount,
        0,
      );
      const rawValue = redisValues[index];
      const actual = rawValue === null ? null : Number(rawValue);

      if (actual !== expected) {
        fixedCount++;
        pipeline.set(
          RegistrationRedisKey.sectionSlots(section.id),
          expected.toString(),
          'EX',
          PREWARM_CACHE_TTL_SECONDS,
        );
      }
    });

    if (fixedCount > 0) {
      await pipeline.exec();
      this.logger.warn(
        `[Reconcile] Fixed ${fixedCount}/${sections.length} section slot caches for semester ${settings.currentSemester}`,
      );
      return;
    }

    this.logger.log(
      `[Reconcile] Redis section slots in sync for semester ${settings.currentSemester} (${sections.length} sections)`,
    );
  }

  // ─── Session info ───────────────────────────────────────────────────────────

  private async cacheSessionInfo(session: RegistrationWindow): Promise<void> {
    const ttlSeconds = Math.min(
      Math.floor((session.closeAt.getTime() - Date.now()) / 1000),
      PREWARM_CACHE_TTL_SECONDS,
    );
    if (ttlSeconds <= 0) {
      this.logger.warn(`[Prewarm] Session ${session.id} already closed, skip`);
      return;
    }

    await this.redis.set(
      RegistrationRedisKey.session(session.semester),
      JSON.stringify({
        id: session.id,
        semester: session.semester,
        openAt: session.openAt.toISOString(),
        closeAt: session.closeAt.toISOString(),
        slotIds: session.slots.map((s) => s.id),
      }),
      'EX',
      ttlSeconds,
    );

    this.logger.log(`[Prewarm] Session info cached, TTL=${ttlSeconds}s`);
  }

  // ─── Section slots + lookup-by-code cache ──────────────────────────────────
  // Data chỉ vài MB/kỳ → load 1 query, push 1 pipeline, không cần pagination.

  private async cacheSections(semester: string): Promise<void> {
    const sections = await this.prisma.classSection.findMany({
      where: { semester },
      orderBy: [
        { sectionCode: 'asc' },
        { dayOfWeek: 'asc' },
        { startPeriod: 'asc' },
        { createdAt: 'asc' },
      ],
      include: {
        course: {
          select: { id: true, code: true, name: true, credits: true },
        },
      },
    });

    const sectionsByCode = new Map<string, typeof sections>();
    const pipeline = this.redis.pipeline();
    for (const s of sections) {
      // slot key: số chỗ còn trống
      pipeline.set(
        RegistrationRedisKey.sectionSlots(s.id),
        Math.max(s.maxCapacity - s.registeredCount, 0).toString(),
        'EX',
        PREWARM_CACHE_TTL_SECONDS,
      );

      const rows = sectionsByCode.get(s.sectionCode) ?? [];
      rows.push(s);
      sectionsByCode.set(s.sectionCode, rows);
    }

    for (const [sectionCode, items] of sectionsByCode) {
      const response: CachedSectionByCodeResponse = {
        items,
        meta: {
          page: 1,
          limit: items.length,
          total: items.length,
          totalPages: items.length === 0 ? 0 : 1,
        },
      };
      pipeline.set(
        RegistrationRedisKey.sectionByCode(semester, sectionCode),
        JSON.stringify(response),
        'EX',
        PREWARM_CACHE_TTL_SECONDS,
      );
    }
    await pipeline.exec();

    this.logger.log(
      `[Prewarm] Sections cached: ${sections.length} rows, ${sectionsByCode.size} section codes`,
    );
  }

  // ─── Slot allowed (SV được phép theo khung giờ) ────────────────────────────

  private async cacheSlotAllowed(slots: RegistrationSlot[]): Promise<void> {
    for (const slot of slots) {
      const filter = slot.studentFilter as Record<string, unknown>;
      const where: Record<string, unknown> = { isActive: true };
      if (filter['courseYear']) where['courseYear'] = filter['courseYear'];
      if (filter['department']) where['department'] = filter['department'];

      const users = await this.prisma.user.findMany({
        where,
        select: { id: true },
      });

      if (users.length === 0) continue;

      const key = RegistrationRedisKey.slotAllowed(slot.id);
      const pipeline = this.redis.pipeline();
      pipeline.sadd(key, ...users.map((u) => u.id));
      pipeline.expire(key, PREWARM_CACHE_TTL_SECONDS);
      await pipeline.exec();

      this.logger.log(`[Prewarm] Slot ${slot.id}: ${users.length} users`);
    }
  }
}
