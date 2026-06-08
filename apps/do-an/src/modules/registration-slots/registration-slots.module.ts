import { Module } from '@nestjs/common';
import { RegistrationSlotsController } from './registration-slots.controller';
import { RegistrationSlotsService } from './registration-slots.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [RegistrationSlotsController],
  providers: [RegistrationSlotsService],
  exports: [RegistrationSlotsService],
})
export class RegistrationSlotsModule {}
