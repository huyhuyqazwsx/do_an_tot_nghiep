import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

export const RABBITMQ_CLIENT = 'RABBITMQ_CLIENT';

@Global()
@Module({
  imports: [
    ClientsModule.register([
      {
        name: RABBITMQ_CLIENT,
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
          queue: process.env.RABBITMQ_QUEUE ?? 'do_an_queue',
          queueOptions: {
            durable: true,
          },
          noAck: false,       // manual ACK: message chỉ xóa khỏi queue sau khi xử lý xong
          prefetchCount: 1,   // mỗi instance chỉ nhận 1 message tại một thời điểm
        },
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class RabbitmqModule implements OnModuleInit {
  onModuleInit() {
    console.log(
      `RabbitMQ connected → ${process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'} | queue: ${process.env.RABBITMQ_QUEUE ?? 'do_an_queue'}`,
    );
  }
}
