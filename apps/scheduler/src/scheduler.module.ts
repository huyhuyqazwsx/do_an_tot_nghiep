import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule, RedisModule } from '@app/shared';
import { PrewarmModule } from './prewarm/prewarm.module';

/**
 * SchedulerModule — chạy 1 instance duy nhất.
 * Chứa tất cả cron jobs: prewarm, outbox processor (sau này).
 *
 * Không import RabbitmqModule vì scheduler không publish/consume queue.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    PrewarmModule,
    // OutboxModule (sau khi implement outbox processor)
  ],
})
export class SchedulerModule {}
