import { Module } from '@nestjs/common';
import { RegistrationSessionsController } from './registration-sessions.controller';
import { RegistrationSessionsService } from './registration-sessions.service';

@Module({
  controllers: [RegistrationSessionsController],
  providers: [RegistrationSessionsService],
  exports: [RegistrationSessionsService],
})
export class RegistrationSessionsModule {}
