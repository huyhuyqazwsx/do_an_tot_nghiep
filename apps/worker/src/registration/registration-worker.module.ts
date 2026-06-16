import { Module } from '@nestjs/common';
import { RegistrationConsumerService } from './registration-consumer.service';
import { DeadLetterConsumerService } from './dead-letter-consumer.service';
import { CreateBatchHandler } from './create-batch.handler';
import { CancelBatchHandler } from './cancel-batch.handler';
import { RegistrationHelperService } from './helpers/registration-helper.service';

@Module({
  providers: [
    RegistrationHelperService,
    CreateBatchHandler,
    CancelBatchHandler,
    RegistrationConsumerService,
    DeadLetterConsumerService,
  ],
})
export class RegistrationWorkerModule {}
