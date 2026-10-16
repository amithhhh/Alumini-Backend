import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export function notFound(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err?.type === 'entity.parse.failed') {
    [status, code, message] = [400, 'INVALID_JSON', 'Request body is not valid JSON'];
  } else if (err?.type === 'entity.too.large') {
    [status, code, message] = [413, 'PAYLOAD_TOO_LARGE', 'Request body too large'];
  } else if (err?.code === 11000) {
    [status, code, message] = [409, 'DUPLICATE_RESOURCE', 'A record with these details already exists'];
  } else if (err?.name === 'ValidationError' && err.errors) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err?.name === 'CastError') {
    [status, code, message] = [400, 'INVALID_ID', 'Invalid identifier'];
  }

  if (status >= 500) {
    logger.error('Unhandled error', { requestId: req.id, path: req.path, method: req.method, error: err?.message, stack: err?.stack });
  }
  if (res.headersSent) return res.destroy(err);
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: req.id } });
}
