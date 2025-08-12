import { HttpException, HttpStatus } from '@nestjs/common';

/** HttpException carrying an i18n code and interpolation params. */
export class CodedException extends HttpException {
  constructor(code: string, status: HttpStatus, params?: Record<string, string | number>) {
    super({ code, params }, status);
  }
}
