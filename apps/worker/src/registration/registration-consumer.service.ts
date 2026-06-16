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

const RETRY_COUNT_HEADER = 'x-registration-retry-count';
const FIRST_QUEUED_AT_HEADER = 'x-registration-first-queued-at';
const LAST_ERROR_HEADER = 'x-registration-last-error';
const FAILED_AT_HEADER = 'x-registration-failed-at';
const DEFAULT_MAX_RETRIES = 6;

@Injectable()
export class RegistrationConsumerService implements OnModuleInit {
  private readonly logger = new Logger(RegistrationConsumerService.name);
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  constructor(
    private readonly createBatchHandler: CreateBatchHandler,
    private readonly cancelBatchHandler: CancelBatchHandler,
  ) { }

  async onModuleInit() {
    const rabbitmqUrl =
      process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
    const queue = process.env.RABBITMQ_QUEUE ?? 'do_an_queue';
    const deadLetterQueue =
      process.env.RABBITMQ_DEAD_LETTER_QUEUE ?? `${queue}.dead`;
    const maxRetries =
      Number(process.env.RABBITMQ_REGISTRATION_MAX_RETRIES) ||
      DEFAULT_MAX_RETRIES;

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
        await channel.assertQueue(deadLetterQueue, { durable: true });
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
              await this.publishDeadLetter(
                channel,
                deadLetterQueue,
                msg,
                new Error('Invalid JSON payload'),
              );
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
              await this.handleProcessingFailure(
                channel,
                queue,
                deadLetterQueue,
                msg,
                payload,
                error as Error,
                maxRetries,
              );
            }
          })();
        });
      },
    });

    await this.connection.connect({ timeout: 10000 });
    this.logger.log(
      `Consuming from queue: ${queue} | retry=${maxRetries} | dead-letter=${deadLetterQueue}`,
    );
  }

  private async handleProcessingFailure(
    channel: Channel,
    queue: string,
    deadLetterQueue: string,
    msg: Parameters<Channel['ack']>[0],
    payload: RegistrationBatchJobPayload,
    error: Error,
    maxRetries: number,
  ) {
    const retryCount = this.getRetryCount(msg);
    if (retryCount < maxRetries) {
      const nextRetryCount = retryCount + 1;
      await this.publishRetry(channel, queue, msg, error, nextRetryCount);
      channel.ack(msg);
      this.logger.warn(
        `Retry queued batchId=${payload.batchId}, attempt=${nextRetryCount}/${maxRetries}`,
      );
      return;
    }

    await this.publishDeadLetter(channel, deadLetterQueue, msg, error);
    channel.ack(msg);
    this.logger.error(
      `Moved batchId=${payload.batchId} to dead-letter after ${maxRetries} retries`,
    );
  }

  private getRetryCount(msg: Parameters<Channel['ack']>[0]) {
    const value = msg.properties.headers?.[RETRY_COUNT_HEADER];
    const retryCount =
      typeof value === 'number' ? value : Number.parseInt(String(value ?? 0), 10);

    return Number.isFinite(retryCount) && retryCount > 0 ? retryCount : 0;
  }

  private async publishRetry(
    channel: Channel,
    queue: string,
    msg: Parameters<Channel['ack']>[0],
    error: Error,
    retryCount: number,
  ) {
    await this.sendToQueue(channel, queue, msg, {
      [RETRY_COUNT_HEADER]: retryCount,
      [FIRST_QUEUED_AT_HEADER]:
        msg.properties.headers?.[FIRST_QUEUED_AT_HEADER] ??
        new Date().toISOString(),
      [LAST_ERROR_HEADER]: error.message,
    });
  }

  private async publishDeadLetter(
    channel: Channel,
    deadLetterQueue: string,
    msg: Parameters<Channel['ack']>[0],
    error: Error,
  ) {
    await this.sendToQueue(channel, deadLetterQueue, msg, {
      [RETRY_COUNT_HEADER]: this.getRetryCount(msg),
      [FAILED_AT_HEADER]: new Date().toISOString(),
      [LAST_ERROR_HEADER]: error.message,
    });
  }

  private async sendToQueue(
    channel: Channel,
    queue: string,
    msg: Parameters<Channel['ack']>[0],
    headers: Record<string, string | number>,
  ) {
    const sent = channel.sendToQueue(queue, msg.content, {
      contentType: msg.properties.contentType ?? 'application/json',
      contentEncoding: msg.properties.contentEncoding,
      correlationId: msg.properties.correlationId,
      deliveryMode: msg.properties.deliveryMode,
      expiration: msg.properties.expiration,
      headers: {
        ...(msg.properties.headers ?? {}),
        ...headers,
      },
      messageId: msg.properties.messageId,
      persistent: true,
      priority: msg.properties.priority,
      replyTo: msg.properties.replyTo,
      timestamp: Math.floor(Date.now() / 1000),
      type: msg.properties.type,
      userId: msg.properties.userId,
    });

    if (!sent) {
      await new Promise((resolve) => channel.once('drain', resolve));
    }
  }
}
