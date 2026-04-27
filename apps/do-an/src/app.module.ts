import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  PrismaModule,
  RedisModule,
  RabbitmqModule,
  MailModule,
} from '@app/shared';
import { AuthModule } from './auth/auth.module';
import { CoursesModule } from './courses/courses.module';
import { ClassSectionsModule } from './class-sections/class-sections.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    RabbitmqModule,
    MailModule,
    AuthModule,
    CoursesModule,
    ClassSectionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
