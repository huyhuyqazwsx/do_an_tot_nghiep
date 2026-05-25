import { Module } from '@nestjs/common';
import { RegistrationSessionsController } from './registration-sessions.controller';
import { RegistrationSessionsService } from './registration-sessions.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [RegistrationSessionsController],
  providers: [RegistrationSessionsService],
  exports: [RegistrationSessionsService],
})
export class RegistrationSessionsModule {}
