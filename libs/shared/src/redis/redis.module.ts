import { Global, Logger, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';
const logger = new Logger('RedisModule');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis => {
        const client = new Redis({
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT) || 6379,
          password: process.env.REDIS_PASSWORD || undefined,
          lazyConnect: false,
        });

        client.on('connect', () => logger.log('Redis connected'));
        client.on('ready', () => logger.log('Redis ready'));
        client.on('reconnecting', (delay?: number) => {
          logger.warn(`Redis reconnecting in ${delay ?? 0}ms`);
        });
        client.on('close', () => logger.warn('Redis connection closed'));
        client.on('end', () => logger.error('Redis connection ended'));
        client.on('error', (err) => {
          logger.error(`Redis error: ${err.message}`, err.stack);
        });

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
