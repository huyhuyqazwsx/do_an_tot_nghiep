import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RegistrationNotificationService } from './registration-notification.service';

@Injectable()
export class RegistrationNotificationCron {
  private readonly logger = new Logger(RegistrationNotificationCron.name);
  private isRunning = false;

  constructor(
    private readonly notificationService: RegistrationNotificationService,
  ) { }

  @Cron('*/1 * * * *')
  async sendRegistrationSummaries(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('[RegistrationNotification] Previous run still in progress, skip');
      return;
    }

    this.isRunning = true;
    try {
      await this.notificationService.sendPendingSummaries();
    } finally {
      this.isRunning = false;
    }
  }
}
