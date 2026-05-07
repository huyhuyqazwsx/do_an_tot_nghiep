import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  PrismaModule,
  RedisModule,
  RabbitmqModule,
  MailModule,
} from '@app/shared';
import { AuthModule } from './modules/auth/auth.module';
import { CoursesModule } from './modules/courses/courses.module';
import { ClassSectionsModule } from './modules/class-sections/class-sections.module';
import { ApiLoggerMiddleware } from './common/middlewares/api-logger.middleware';
import { UsersModule } from './modules/users/users.module';
import { RegistrationsModule } from './modules/registrations/registrations.module';
import { RegistrationSessionsModule } from './modules/registration-sessions/registration-sessions.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    RabbitmqModule,
    MailModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    ClassSectionsModule,
    RegistrationSessionsModule,
    RegistrationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ApiLoggerMiddleware).forRoutes('*');
  }
}
