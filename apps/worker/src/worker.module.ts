import { Module } from '@nestjs/common';
import { PrismaModule, RedisModule } from '@app/shared';
import { WorkerController } from './worker.controller';
import { WorkerService } from './worker.service';
import { RegistrationWorkerModule } from './registration/registration-worker.module';

/**
 * WorkerModule — scale tự do (instances: N).
 * Chỉ consume RabbitMQ, stateless, idempotent.
 * Cron jobs được tách sang SchedulerModule (apps/scheduler).
 */
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    RegistrationWorkerModule,
  ],
  controllers: [WorkerController],
  providers: [WorkerService],
})
export class WorkerModule {}
