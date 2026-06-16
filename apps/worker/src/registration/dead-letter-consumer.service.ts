import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import {
  connect,
  type AmqpConnectionManager,
  type ChannelWrapper,
} from 'amqp-connection-manager';
import type { Channel } from 'amqplib';
import { PrismaService, REDIS_CLIENT, type RegistrationBatchJobPayload } from '@app/shared';
import {
  RegistrationBatchItemStatus,
  RegistrationBatchStatus,
} from '@prisma/client';
import type Redis from 'ioredis';

const LAST_ERROR_HEADER = 'x-registration-last-error';

@Injectable()
export class DeadLetterConsumerService implements OnModuleInit {
  private readonly logger = new Logger(DeadLetterConsumerService.name);
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onModuleInit() {
    // Chỉ bật DLQ consumer khi có env ENABLE_DLQ_CONSUMER=true
    // Tránh 12 instance worker đều mở connection vào DLQ
    if (process.env.ENABLE_DLQ_CONSUMER !== 'true') {
      this.logger.log('DLQ consumer disabled (set ENABLE_DLQ_CONSUMER=true to enable)');
      return;
    }

    const rabbitmqUrl =
      process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
    const queue = process.env.RABBITMQ_QUEUE ?? 'do_an_queue';
    const deadLetterQueue =
      process.env.RABBITMQ_DEAD_LETTER_QUEUE ?? `${queue}.dead`;

    this.connection = connect([rabbitmqUrl], {
      heartbeatIntervalInSeconds: 5,
      reconnectTimeInSeconds: 5,
    });

    this.connection.on('connect', () =>
      this.logger.log('Dead-letter consumer connected'),
    );

    this.channel = this.connection.createChannel({
      name: 'dead-letter-consumer',
      json: false,
      setup: async (channel: Channel) => {
        await channel.assertQueue(deadLetterQueue, { durable: true });
        await channel.prefetch(5);
        await channel.consume(deadLetterQueue, (msg) => {
          void (async () => {
            if (!msg) return;

            let payload: RegistrationBatchJobPayload;
            try {
              payload = JSON.parse(
                msg.content.toString(),
              ) as RegistrationBatchJobPayload;
            } catch {
              this.logger.error('DLQ: Failed to parse message — discarding');
              channel.ack(msg);
              return;
            }

            const errorReason =
              msg.properties.headers?.[LAST_ERROR_HEADER] ??
              'Lỗi hệ thống sau nhiều lần thử lại';

            try {
              await this.markBatchFailed(payload.batchId, String(errorReason));
              this.logger.warn(
                `DLQ: Marked batchId=${payload.batchId} as COMPLETED with all items FAILED`,
              );
            } catch (err) {
              this.logger.error(
                `DLQ: Failed to update DB for batchId=${payload.batchId}: ${(err as Error).message}`,
              );
            }

            channel.ack(msg);
          })();
        });
      },
    });

    await this.connection.connect({ timeout: 10000 });
    this.logger.log(`Consuming dead-letter queue: ${deadLetterQueue}`);
  }

  /**
   * Đánh dấu batch = COMPLETED, tất cả items PENDING → FAILED
   */
  private async markBatchFailed(batchId: string, errorReason: string) {
    await this.prisma.$transaction([
      // Đánh tất cả items đang PENDING thành FAILED
      this.prisma.registrationBatchItem.updateMany({
        where: {
          batchId,
          status: RegistrationBatchItemStatus.PENDING,
        },
        data: {
          status: RegistrationBatchItemStatus.FAILED,
          failureReason: errorReason,
        },
      }),
      // Đánh batch = COMPLETED (đã xử lý xong, dù kết quả là fail)
      this.prisma.registrationBatch.update({
        where: { id: batchId },
        data: {
          status: RegistrationBatchStatus.COMPLETED,
          processedAt: new Date(),
        },
      }),
    ]);
  }
}
