import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  PrismaModule,
  RedisModule,
  RabbitmqModule,
} from '@app/shared';
import { AuthModule } from './modules/auth/auth.module';
import { CoursesModule } from './modules/courses/courses.module';
import { ClassSectionsModule } from './modules/class-sections/class-sections.module';
import { ApiLoggerMiddleware } from './common/middlewares/api-logger.middleware';
import { UsersModule } from './modules/users/users.module';
import { RegistrationsModule } from './modules/registrations/registrations.module';
import { GradesModule } from './modules/grades/grades.module';
import { RegistrationSlotsModule } from './modules/registration-slots/registration-slots.module';
import { SettingsModule } from './modules/settings/settings.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    RabbitmqModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    ClassSectionsModule,
    RegistrationsModule,
    GradesModule,
    RegistrationSlotsModule,
    SettingsModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ApiLoggerMiddleware).forRoutes('*');
  }
}
