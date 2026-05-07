import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@app/shared';
import { RegistrationPrewarmService } from './registration-prewarm.service';

@Injectable()
export class RegistrationPrewarmCron {
  private readonly logger = new Logger(RegistrationPrewarmCron.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prewarmService: RegistrationPrewarmService,
  ) {}

  /**
   * Chạy mỗi phút, kiểm tra slot nào đến giờ prewarm nhưng chưa prewarm.
   * Sau khi admin tạo RegistrationSession + slots với prewarm_at,
   * cron này tự động trigger mà không cần admin gọi endpoint thêm.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkAndPrewarm(): Promise<void> {
    // Tránh chạy concurrent nếu prewarm lâu hơn 1 phút
    if (this.isRunning) {
      this.logger.warn('[PrewarmCron] Previous run still in progress, skip');
      return;
    }

    this.isRunning = true;
    try {
      await this.runPrewarm();
    } finally {
      this.isRunning = false;
    }
  }

  private async runPrewarm(): Promise<void> {
    const now = new Date();

    // Tìm các slot đã đến prewarm_at, chưa prewarm, session đang active
    const pendingSlots = await this.prisma.registrationSlot.findMany({
      where: {
        prewarmAt: { lte: now },
        isPrewarmed: false,
        session: { isActive: true },
      },
      include: {
        session: {
          include: { slots: true },
        },
      },
    });

    if (pendingSlots.length === 0) return;

    // Group theo session để tránh prewarm cùng session nhiều lần
    const sessionIds = new Set(pendingSlots.map((s) => s.sessionId));
    this.logger.log(
      `[PrewarmCron] Found ${pendingSlots.length} slots in ${sessionIds.size} sessions to prewarm`,
    );

    for (const slot of pendingSlots) {
      // Mỗi slot đại diện cho session — prewarm toàn bộ session 1 lần
      const session = slot.session;

      // Kiểm tra session chưa được prewarm (tất cả slots chưa prewarmed)
      const allAlreadyPrewarmed = session.slots.every((s) => s.isPrewarmed);
      if (allAlreadyPrewarmed) continue;

      try {
        await this.prewarmService.prewarmSession(session);
        this.logger.log(
          `[PrewarmCron] Session ${session.id} (${session.semester}) prewarmed successfully`,
        );
      } catch (error) {
        this.logger.error(
          `[PrewarmCron] Failed to prewarm session ${session.id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }
  }
}
