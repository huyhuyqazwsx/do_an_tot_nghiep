import { Module } from '@nestjs/common';
import { RegistrationPrewarmCron } from './registration-prewarm.cron';
import { RegistrationPrewarmService } from './registration-prewarm.service';

@Module({
  providers: [RegistrationPrewarmService, RegistrationPrewarmCron],
})
export class PrewarmModule { }
