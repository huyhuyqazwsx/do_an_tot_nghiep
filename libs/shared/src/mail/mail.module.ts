import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailTemplateService } from './mail-template.service';

@Global()
@Module({
  providers: [MailTemplateService, MailService],
  exports: [MailTemplateService, MailService],
})
export class MailModule {}
