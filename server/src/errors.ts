import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } });
  } else if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  } else if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
  } else {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  }
};
