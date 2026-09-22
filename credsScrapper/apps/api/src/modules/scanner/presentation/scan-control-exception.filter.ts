import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ScanControlError } from '../domain/errors/scan-control.error';

@Catch(ScanControlError)
export class ScanControlExceptionFilter implements ExceptionFilter<ScanControlError> {
  catch(error: ScanControlError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(
        error.code === 'scan_stopping'
          ? HttpStatus.CONFLICT
          : HttpStatus.SERVICE_UNAVAILABLE,
      )
      .json({ code: error.code, message: error.message });
  }
}
