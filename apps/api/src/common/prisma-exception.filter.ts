import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { Response } from 'express';

/** Turns common database errors into clean HTTP responses. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | string | undefined) ?? 'field';
        return res.status(HttpStatus.CONFLICT).json({
          statusCode: 409,
          error: 'Conflict',
          message: `A record with this ${Array.isArray(target) ? target.filter((t) => t !== 'tenantId').join(', ') : target} already exists`,
        });
      }
      case 'P2025':
        return res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, error: 'Not Found', message: 'Record not found' });
      case 'P2003':
        return res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, error: 'Bad Request', message: 'Referenced record does not exist' });
      default:
        return res.status(500).json({ statusCode: 500, error: 'Internal Server Error', message: 'Database error' });
    }
  }
}
