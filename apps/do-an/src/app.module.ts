import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule, RedisModule, RabbitmqModule } from '@app/shared';

@Module({
  imports: [PrismaModule, RedisModule, RabbitmqModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
