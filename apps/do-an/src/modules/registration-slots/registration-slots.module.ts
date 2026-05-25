import { Module } from '@nestjs/common';
import { RegistrationSlotsController } from './registration-slots.controller';
import { RegistrationSlotsService } from './registration-slots.service';

@Module({
  controllers: [RegistrationSlotsController],
  providers: [RegistrationSlotsService],
})
export class RegistrationSlotsModule {}
