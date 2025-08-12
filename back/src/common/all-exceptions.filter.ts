import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/** Normalized error response shape consumed by the frontend. */
interface ErrorBody {
  statusCode: number;
  code: string;
  params?: Record<string, string | number>;
}

/**
 * Turns every exception into a coded JSON body { statusCode, code, params }
 * so the frontend can translate it. CodedException carries its own code;
 * built-in exceptions fall back to a status-based code.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        const { code, params } = response as {
          code: string;
          params?: Record<string, string | number>;
        };
        return { statusCode, code, params };
      }
      return { statusCode, code: 'errors.http', params: this.httpParams(statusCode, response) };
    }
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, code: 'errors.internal' };
  }

  private httpParams(statusCode: number, response: unknown): Record<string, string | number> {
    let detail = '';
    if (typeof response === 'object' && response !== null && 'message' in response) {
      const message = (response as { message: unknown }).message;
      detail = Array.isArray(message) ? message.join(', ') : String(message);
    }
    return { status: statusCode, detail };
  }
}
