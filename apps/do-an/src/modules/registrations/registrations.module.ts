import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';
import { RegistrationBatchValidatorService } from './helpers/registration-batch-validator.service';

@Module({
  controllers: [RegistrationsController],
  providers: [RegistrationsService, RegistrationBatchValidatorService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
