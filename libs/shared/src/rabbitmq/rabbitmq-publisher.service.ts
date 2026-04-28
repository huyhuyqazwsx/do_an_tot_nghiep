import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  connect,
  type AmqpConnectionManager,
  type ChannelWrapper,
} from 'amqp-connection-manager';
import { randomUUID } from 'crypto';
import { RabbitmqPublishOptions } from './types/rabbitmq-publish-options.type';
import { RabbitmqPublishResult } from './types/rabbitmq-publish-result.type';
import type { Channel } from 'amqplib';

@Injectable()
export class RabbitmqPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqPublisherService.name);
  private readonly assertedQueues = new Set<string>();
  private connection?: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  async onModuleInit() {
    const urls = [this.rabbitmqUrl];
    const queue = this.defaultQueue;

    this.connection = connect(urls, {
      heartbeatIntervalInSeconds: 5,
      reconnectTimeInSeconds: 5,
    });

    this.connection.on('connect', ({ url }) => {
      this.logger.log(
        `RabbitMQ connected -> ${typeof url === 'string' ? url : JSON.stringify(url)} | queue: ${queue}`,
      );
    });

    this.connection.on('connectFailed', ({ err }) => {
      this.logger.error(`RabbitMQ connect failed: ${err.message}`, err.stack);
    });

    this.connection.on('disconnect', ({ err }) => {
      this.logger.error(`RabbitMQ disconnected: ${err.message}`, err.stack);
    });

    this.connection.on('blocked', ({ reason }) => {
      this.logger.warn(`RabbitMQ connection blocked: ${reason}`);
    });

    this.connection.on('unblocked', () => {
      this.logger.log('RabbitMQ connection unblocked');
    });

    this.channel = this.connection.createChannel({
      name: 'api-publisher',
      confirm: true,
      json: false,
      publishTimeout: this.publishTimeoutMs,
      setup: async (channel: Channel) => {
        await channel.assertQueue(queue, { durable: true });
      },
    });
    this.assertedQueues.add(queue);

    this.channel.on('connect', () => {
      this.logger.log('RabbitMQ confirm channel ready');
    });

    this.channel.on('error', (err) => {
      this.logger.error(`RabbitMQ channel error: ${err.message}`, err.stack);
    });

    this.channel.on('close', () => {
      this.logger.warn('RabbitMQ confirm channel closed');
    });

    await this.connection.connect({ timeout: this.connectTimeoutMs });
  }

  async onModuleDestroy() {
    await this.channel?.close();
    await this.connection?.close();
  }

  async publishToQueue<T>(
    payload: T,
    options: RabbitmqPublishOptions = {},
  ): Promise<RabbitmqPublishResult> {
    if (!this.channel) {
      throw new Error('RabbitMQ publisher channel is not initialized');
    }

    const queue = options.queue ?? this.defaultQueue;
    const messageId = options.messageId ?? randomUUID();
    const content = Buffer.from(JSON.stringify(payload));
    const publishOptions = {
      contentType: 'application/json',
      headers: { messageId },
      messageId,
      persistent: true,
      timestamp: Math.floor(Date.now() / 1000),
      timeout: options.timeoutMs ?? this.publishTimeoutMs,
    } as Parameters<ChannelWrapper['sendToQueue']>[2];

    await this.ensureQueue(queue);
    await this.channel.sendToQueue(queue, content, publishOptions);

    return {
      queue,
      messageId,
      confirmedAt: new Date().toISOString(),
    };
  }

  private get rabbitmqUrl() {
    return process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
  }

  private get defaultQueue() {
    return process.env.RABBITMQ_QUEUE ?? 'do_an_queue';
  }

  private get connectTimeoutMs() {
    return Number(process.env.RABBITMQ_CONNECT_TIMEOUT_MS) || 5000;
  }

  private get publishTimeoutMs() {
    return Number(process.env.RABBITMQ_PUBLISH_TIMEOUT_MS) || 5000;
  }

  private async ensureQueue(queue: string) {
    if (this.assertedQueues.has(queue)) {
      return;
    }

    if (!this.channel) {
      throw new Error('RabbitMQ publisher channel is not initialized');
    }

    await this.channel.addSetup(async (channel: Channel) => {
      await channel.assertQueue(queue, { durable: true });
    });

    this.assertedQueues.add(queue);
  }
}
