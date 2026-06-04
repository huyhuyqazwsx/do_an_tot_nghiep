import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { REDIS_CLIENT } from '@app/shared';
import Redis from 'ioredis';

/** Redis key prefix cho request counter theo giây */
export const RPS_KEY_PREFIX = 'rps:';
/** Window 5 phút để tổng hợp tổng request */
export const RPS_WINDOW_SECONDS = 5 * 60;
/** TTL đủ dài để bucket không bị xóa trước khi hết window 5 phút */
const RPS_TTL_SECONDS = RPS_WINDOW_SECONDS + 1;

@Injectable()
export class ApiLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ApiLoggerMiddleware.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) { }

  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    const method = req.method;
    const path = req.originalUrl ?? req.url;

    const bucket = `${RPS_KEY_PREFIX}${Math.floor(startedAt / 1000)}`;
    this.redis
      .multi()
      .incr(bucket)
      .expire(bucket, RPS_TTL_SECONDS)
      .exec()
      .catch(() => {
      });

    let logged = false;
    const logRequest = () => {
      if (logged) {
        return;
      }

      logged = true;

      const durationMs = Date.now() - startedAt;
      this.logger.log(`${method} ${path} ${res.statusCode} - ${durationMs}ms`);
    };

    res.once('finish', logRequest);
    res.once('close', logRequest);

    next();
  }
}
