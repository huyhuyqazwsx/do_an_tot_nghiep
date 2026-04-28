import { Global, Module } from '@nestjs/common';
import { RabbitmqPublisherService } from './rabbitmq-publisher.service';

@Global()
@Module({
  providers: [RabbitmqPublisherService],
  exports: [RabbitmqPublisherService],
})
export class RabbitmqModule {}
