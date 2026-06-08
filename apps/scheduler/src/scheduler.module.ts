import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule, RedisModule } from '@app/shared';
import { PrewarmModule } from './prewarm/prewarm.module';
import { RegistrationNotificationModule } from './notification/registration-notification.module';

/**
 * SchedulerModule — chạy 1 instance duy nhất.
 * Chứa tất cả cron jobs: prewarm.
 *
 * Không import RabbitmqModule vì scheduler không publish/consume queue.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    PrewarmModule,
    // RegistrationNotificationModule,
  ],
})
export class SchedulerModule { }
