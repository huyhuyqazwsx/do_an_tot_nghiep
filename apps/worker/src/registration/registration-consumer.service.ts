import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  connect,
  type AmqpConnectionManager,
  type ChannelWrapper,
} from 'amqp-connection-manager';
import type { Channel } from 'amqplib';
import {
  RegistrationQueueEvent,
  type RegistrationBatchJobPayload,
} from '@app/shared';
import { CreateBatchHandler } from './create-batch.handler';
import { CancelBatchHandler } from './cancel-batch.handler';

@Injectable()
export class RegistrationConsumerService implements OnModuleInit {
  private readonly logger = new Logger(RegistrationConsumerService.name);
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  constructor(
    private readonly createBatchHandler: CreateBatchHandler,
    private readonly cancelBatchHandler: CancelBatchHandler,
  ) {}

  async onModuleInit() {
    const rabbitmqUrl =
      process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
    const queue = process.env.RABBITMQ_QUEUE ?? 'do_an_queue';

    this.connection = connect([rabbitmqUrl], {
      heartbeatIntervalInSeconds: 5,
      reconnectTimeInSeconds: 5,
    });

    this.connection.on('connect', () =>
      this.logger.log('RabbitMQ consumer connected'),
    );
    this.connection.on('disconnect', ({ err }) =>
      this.logger.error(`RabbitMQ consumer disconnected: ${err.message}`),
    );

    this.channel = this.connection.createChannel({
      name: 'registration-consumer',
      json: false,
      setup: async (channel: Channel) => {
        await channel.assertQueue(queue, { durable: true });
        await channel.prefetch(10);
        await channel.consume(queue, (msg) => {
          void (async () => {
            if (!msg) return;

            let payload: RegistrationBatchJobPayload;
            try {
              payload = JSON.parse(
                msg.content.toString(),
              ) as RegistrationBatchJobPayload;
            } catch {
              this.logger.error('Failed to parse message — discarding');
              channel.ack(msg);
              return;
            }

            try {
              switch (payload.type) {
                case RegistrationQueueEvent.CREATE_BATCH_REQUESTED:
                  await this.createBatchHandler.handle(
                    payload.batchId,
                    payload.userId,
                    payload.semester,
                    payload.items,
                    payload.queuedAt,
                  );
                  break;

                case RegistrationQueueEvent.CANCEL_BATCH_REQUESTED:
                  await this.cancelBatchHandler.handle(
                    payload.batchId,
                    payload.userId,
                    payload.semester,
                    payload.items,
                    payload.queuedAt,
                  );
                  break;

                default:
                  this.logger.warn(
                    `Unknown event type: ${(payload as { type: string }).type}`,
                  );
              }

              channel.ack(msg);
            } catch (error) {
              this.logger.error(
                `Failed processing batchId=${payload.batchId}: ${(error as Error).message}`,
                (error as Error).stack,
              );
              // nack không requeue → vào DLQ nếu có, tránh infinite loop
              channel.nack(msg, false, false);
            }
          })();
        });
      },
    });

    await this.connection.connect({ timeout: 10000 });
    this.logger.log(`Consuming from queue: ${queue}`);
  }
}
