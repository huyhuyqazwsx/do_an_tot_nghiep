import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RegistrationPrewarmService } from './registration-prewarm.service';

@Injectable()
export class RegistrationPrewarmCron {
  private readonly logger = new Logger(RegistrationPrewarmCron.name);
  private isRunning = false;
  private isReconciling = false;

  constructor(private readonly prewarmService: RegistrationPrewarmService) { }

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

  @Cron('*/10 * * * *') // Mỗi 10 phút — sync Redis slots với DB (worker không SET trực tiếp nữa)
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
    await this.prewarmService.healIfNeeded();
  }
}
