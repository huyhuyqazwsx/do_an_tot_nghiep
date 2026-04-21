import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule, RedisModule, RabbitmqModule, MailModule } from '@app/shared';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [PrismaModule, RedisModule, RabbitmqModule, MailModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
