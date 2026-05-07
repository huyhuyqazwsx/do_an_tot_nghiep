import { NestFactory } from '@nestjs/core';
import { SchedulerModule } from './scheduler.module';

async function bootstrap() {
  const app = await NestFactory.create(SchedulerModule);
  // Scheduler không expose HTTP, dùng port 3002 chỉ để health check nếu cần
  await app.init();
  // Không listen — chỉ chạy cron jobs, không nhận request
}
void bootstrap();
