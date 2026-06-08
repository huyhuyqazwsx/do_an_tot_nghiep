import { Module } from '@nestjs/common';
import { RegistrationNotificationCron } from './registration-notification.cron';
import { RegistrationNotificationService } from './registration-notification.service';

@Module({
  providers: [RegistrationNotificationService, RegistrationNotificationCron],
})
export class RegistrationNotificationModule {}
