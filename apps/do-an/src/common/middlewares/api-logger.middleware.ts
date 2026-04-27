import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class ApiLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ApiLoggerMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    const method = req.method;
    const path = req.originalUrl ?? req.url;

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