import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { CSRF_COOKIE, CSRF_HEADER } from '../constants.js';
import { isValidCsrfToken } from '../services/token.service.js';
import { AppError } from '../utils/AppError.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const eq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Double-submit CSRF defence for every state-changing request:
 *  1. Origin (when the browser sends one) must be an allowed frontend origin.
 *  2. X-CSRF-Token header must equal the csrf_token cookie AND carry a valid server HMAC
 *     (so an attacker who can plant a cookie still cannot forge a token).
 * Combined with SameSite cookies and a restricted CORS policy.
 */
export function csrfProtection(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !env.allowedOrigins.includes(origin.replace(/\/$/, ''))) {
    return next(new AppError(403, 'CSRF_ORIGIN', 'Origin not allowed'));
  }
  const header = req.get(CSRF_HEADER);
  const cookie = req.cookies?.[CSRF_COOKIE];
  if (!header || !cookie || !eq(header, cookie) || !isValidCsrfToken(header)) {
    return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'));
  }
  return next();
}
