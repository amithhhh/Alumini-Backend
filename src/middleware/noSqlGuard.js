import { AppError } from '../utils/AppError.js';

// Rejects Mongo operator injection ({"$ne": ...}, "a.b" paths) in any user-controlled input.
// Zod schemas additionally enforce primitive types, so this is defence in depth.
function hasBadKey(value, depth = 0) {
  if (depth > 10) return true;
  if (Array.isArray(value)) return value.some((v) => hasBadKey(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => k.startsWith('$') || k.includes('.') || hasBadKey(v, depth + 1));
  }
  return false;
}

export function noSqlGuard(req, _res, next) {
  if (hasBadKey(req.body) || hasBadKey(req.query) || hasBadKey(req.params)) {
    return next(new AppError(400, 'INVALID_INPUT', 'Request contains disallowed characters in field names'));
  }
  return next();
}
