import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@app/shared';
import { RegistrationPrewarmService } from './registration-prewarm.service';

@Injectable()
export class RegistrationPrewarmCron {
  private readonly logger = new Logger(RegistrationPrewarmCron.name);
  private isRunning = false;
  private isReconciling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prewarmService: RegistrationPrewarmService,
  ) { }

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

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileRedisSlots(): Promise<void> {
    if (this.isReconciling) {
      this.logger.warn('[ReconcileCron] Previous run still in progress, skip');
      return;
    }

    this.isReconciling = true;
    try {
      await this.prewarmService.reconcileCurrentSemesterSlots();
    } finally {
      this.isReconciling = false;
    }
  }

  private async runPrewarm(): Promise<void> {
    const now = new Date();
    const settings = await this.prisma.systemSetting.findUnique({
      where: { id: 1 },
    });

    if (!settings) {
      this.logger.warn('[PrewarmCron] No system settings, skip');
      return;
    }

    // Bắt một slot đến giờ prewarm là prewarm lại toàn bộ kỳ hiện tại.
    // Redis SET/HSET ghi đè, SADD idempotent, nên chạy lại session vẫn ổn.
    const pendingSlots = await this.prisma.registrationSlot.findMany({
      where: {
        semester: settings.currentSemester,
        prewarmAt: { lte: now },
        isPrewarmed: false,
      },
    });

    if (pendingSlots.length === 0) return;

    this.logger.log(
      `[PrewarmCron] Found ${pendingSlots.length} slots to prewarm for semester ${settings.currentSemester}`,
    );

    try {
      await this.prewarmService.prewarmCurrentSettings(settings, pendingSlots);
      this.logger.log(
        `[PrewarmCron] Semester ${settings.currentSemester} prewarmed successfully`,
      );
    } catch (error) {
      this.logger.error(
        `[PrewarmCron] Failed to prewarm semester ${settings.currentSemester}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
