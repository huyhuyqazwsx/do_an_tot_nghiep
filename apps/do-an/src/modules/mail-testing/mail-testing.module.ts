import { Module } from '@nestjs/common';
import { MailTestingController } from './mail-testing.controller';
import { MailTestingService } from './mail-testing.service';

@Module({
  controllers: [MailTestingController],
  providers: [MailTestingService],
})
export class MailTestingModule {}
