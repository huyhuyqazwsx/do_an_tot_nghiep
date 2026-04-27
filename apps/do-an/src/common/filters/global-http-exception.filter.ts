import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

type ErrorDetails = Record<string, unknown> | unknown[] | undefined;

interface StandardErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string | string[];
  error: string;
  details?: ErrorDetails;
}

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const timestamp = new Date().toISOString();
    const path = request.url;

    if (exception instanceof HttpException) {
      response
        .status(exception.getStatus())
        .json(this.toStandardErrorResponse(exception, path, timestamp));
      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${path}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      timestamp,
      path,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
  }

  private toStandardErrorResponse(
    exception: HttpException,
    path: string,
    timestamp: string,
  ): StandardErrorResponse {
    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'string') {
      return {
        statusCode: exception.getStatus(),
        timestamp,
        path,
        message: exceptionResponse,
        error: exception.name,
      };
    }

    const responseObject = exceptionResponse as Record<string, unknown>;
    const rawMessage = responseObject.message;
    const details = this.extractDetails(responseObject);

    return {
      statusCode: this.toNumber(
        responseObject.statusCode,
        exception.getStatus(),
      ),
      timestamp,
      path,
      message: Array.isArray(rawMessage)
        ? rawMessage.map((value) => String(value))
        : typeof rawMessage === 'string'
          ? rawMessage
          : exception.message,
      error:
        typeof responseObject.error === 'string'
          ? responseObject.error
          : exception.name,
      ...(details ? { details } : {}),
    };
  }

  private extractDetails(
    responseObject: Record<string, unknown>,
  ): ErrorDetails {
    const details: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(responseObject)) {
      if (key === 'statusCode' || key === 'message' || key === 'error') {
        continue;
      }

      details[key] = value;
    }

    return Object.keys(details).length > 0 ? details : undefined;
  }

  private toNumber(value: unknown, fallback: number) {
    return typeof value === 'number' ? value : fallback;
  }
}
