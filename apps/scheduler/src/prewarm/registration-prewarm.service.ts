import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/shared';
import { REDIS_CLIENT } from '@app/shared';
import { RegistrationRedisKey } from '@app/shared';
import Redis from 'ioredis';
import type { RegistrationSession, RegistrationSlot } from '@prisma/client';

type SessionWithSlots = RegistrationSession & { slots: RegistrationSlot[] };

@Injectable()
export class RegistrationPrewarmService {
  private readonly logger = new Logger(RegistrationPrewarmService.name);
  private readonly BATCH_SIZE = 500;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async prewarmSession(session: SessionWithSlots): Promise<void> {
    const { semester } = session;
    this.logger.log(
      `[Prewarm] Start — semester=${semester} sessionId=${session.id}`,
    );

    await this.cacheSessionInfo(session);
    await this.cacheSectionSlots(semester);
    await this.cacheSectionInfos(semester);
    await this.cacheUserRegistrations(semester);
    await this.cacheSlotAllowed(session.slots);

    // Đánh dấu tất cả slot đã prewarm
    await this.prisma.registrationSlot.updateMany({
      where: { sessionId: session.id },
      data: { isPrewarmed: true, prewarmedAt: new Date() },
    });

    this.logger.log(`[Prewarm] Done — semester=${semester}`);
  }

  // ─── Session info ───────────────────────────────────────────────────────────

  private async cacheSessionInfo(session: SessionWithSlots): Promise<void> {
    const ttlSeconds = Math.floor(
      (session.closeAt.getTime() - Date.now()) / 1000,
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

  // ─── Section slots (sl_max - sl_dk) ────────────────────────────────────────

  private async cacheSectionSlots(semester: string): Promise<void> {
    let cursor = 0;
    let total = 0;

    while (true) {
      const sections = await this.prisma.classSection.findMany({
        where: { semester },
        select: { id: true, maxCapacity: true, registeredCount: true },
        skip: cursor,
        take: this.BATCH_SIZE,
      });

      if (sections.length === 0) break;

      const pipeline = this.redis.pipeline();
      for (const s of sections) {
        pipeline.set(
          RegistrationRedisKey.sectionSlots(s.id),
          Math.max(s.maxCapacity - s.registeredCount, 0).toString(),
        );
      }
      await pipeline.exec();

      total += sections.length;
      cursor += sections.length;
      if (sections.length < this.BATCH_SIZE) break;
    }

    this.logger.log(`[Prewarm] Section slots: ${total} cached`);
  }

  // ─── Section infos (lịch học) ───────────────────────────────────────────────

  private async cacheSectionInfos(semester: string): Promise<void> {
    let cursor = 0;
    let total = 0;

    while (true) {
      const sections = await this.prisma.classSection.findMany({
        where: { semester },
        select: {
          id: true,
          courseId: true,
          dayOfWeek: true,
          timeOfDay: true,
          startPeriod: true,
          endPeriod: true,
          timeRange: true,
          weekRange: true,
          sectionType: true,
          requiresLab: true,
          maxCapacity: true,
          registeredCount: true,
        },
        skip: cursor,
        take: this.BATCH_SIZE,
      });

      if (sections.length === 0) break;

      const pipeline = this.redis.pipeline();
      for (const s of sections) {
        const key = RegistrationRedisKey.sectionInfo(s.id);
        pipeline.hset(key, {
          courseId: s.courseId,
          dayOfWeek: s.dayOfWeek?.toString() ?? '',
          timeOfDay: s.timeOfDay ?? '',
          startPeriod: s.startPeriod?.toString() ?? '',
          endPeriod: s.endPeriod?.toString() ?? '',
          timeRange: s.timeRange ?? '',
          weekRange: s.weekRange ?? '',
          sectionType: s.sectionType ?? '',
          requiresLab: s.requiresLab ? '1' : '0',
          maxCapacity: s.maxCapacity.toString(),
          registeredCount: s.registeredCount.toString(),
        });
        pipeline.expire(key, 3600);
      }
      await pipeline.exec();

      total += sections.length;
      cursor += sections.length;
      if (sections.length < this.BATCH_SIZE) break;
    }

    this.logger.log(`[Prewarm] Section infos: ${total} cached`);
  }

  // ─── User registrations ACTIVE trong kỳ ────────────────────────────────────

  private async cacheUserRegistrations(semester: string): Promise<void> {
    let cursor = 0;
    const userMap = new Map<
      string,
      { classSectionIds: string[]; scheduleKeys: string[] }
    >();
    const latestByUserAndSection = new Map<
      string,
      {
        type: 'CREATE' | 'CANCEL';
        userId: string;
        classSectionId: string;
        classSection: {
          dayOfWeek: number | null;
          timeOfDay: string | null;
          startPeriod: number | null;
          endPeriod: number | null;
        } | null;
      }
    >();

    while (true) {
      const items = await this.prisma.registrationBatchItem.findMany({
        where: {
          status: 'SUCCESS',
          classSectionId: { not: null },
          batch: { semester },
        },
        select: {
          classSectionId: true,
          batch: { select: { type: true, userId: true } },
          classSection: {
            select: {
              dayOfWeek: true,
              timeOfDay: true,
              startPeriod: true,
              endPeriod: true,
            },
          },
        },
        orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
        skip: cursor,
        take: 1000,
      });

      if (items.length === 0) break;

      for (const item of items) {
        if (!item.classSectionId) continue;

        const key = `${item.batch.userId}:${item.classSectionId}`;
        if (!latestByUserAndSection.has(key)) {
          latestByUserAndSection.set(key, {
            type: item.batch.type,
            userId: item.batch.userId,
            classSectionId: item.classSectionId,
            classSection: item.classSection,
          });
        }
      }

      cursor += items.length;
      if (items.length < 1000) break;
    }

    for (const item of latestByUserAndSection.values()) {
      if (item.type !== 'CREATE') continue;

      if (!userMap.has(item.userId)) {
        userMap.set(item.userId, { classSectionIds: [], scheduleKeys: [] });
      }
      const entry = userMap.get(item.userId)!;
      entry.classSectionIds.push(item.classSectionId);

      const cs = item.classSection;
      if (cs?.dayOfWeek && cs.timeOfDay && cs.startPeriod && cs.endPeriod) {
        entry.scheduleKeys.push(
          `${cs.dayOfWeek}:${cs.timeOfDay}:${cs.startPeriod}:${cs.endPeriod}`,
        );
      }
    }

    // Flush pipeline
    const pipeline = this.redis.pipeline();
    for (const [userId, { classSectionIds, scheduleKeys }] of userMap) {
      if (classSectionIds.length > 0) {
        pipeline.sadd(
          RegistrationRedisKey.userRegistered(userId, semester),
          ...classSectionIds,
        );
      }
      if (scheduleKeys.length > 0) {
        pipeline.sadd(
          RegistrationRedisKey.userSchedule(userId, semester),
          ...scheduleKeys,
        );
      }
    }
    await pipeline.exec();

    this.logger.log(
      `[Prewarm] User registrations: ${userMap.size} users cached`,
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
      const ttlSeconds = Math.floor(
        (slot.closeAt.getTime() - Date.now()) / 1000,
      );

      const pipeline = this.redis.pipeline();
      pipeline.sadd(key, ...users.map((u) => u.id));
      if (ttlSeconds > 0) pipeline.expire(key, ttlSeconds);
      await pipeline.exec();

      this.logger.log(`[Prewarm] Slot ${slot.id}: ${users.length} users`);
    }
  }
}
