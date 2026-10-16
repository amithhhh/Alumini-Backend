import { env } from '../config/env.js';
import { SESSION_COOKIE, CSRF_COOKIE } from '../constants.js';

const base = () => ({
  secure: env.cookieSecure,
  sameSite: env.COOKIE_SAMESITE,
  path: '/',
  ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
});

export const setSessionCookie = (res, token) =>
  res.cookie(SESSION_COOKIE, token, { ...base(), httpOnly: true, maxAge: env.SESSION_TTL_HOURS * 3600 * 1000 });

export const clearSessionCookie = (res) => res.clearCookie(SESSION_COOKIE, { ...base(), httpOnly: true });

// The CSRF cookie is intentionally readable by JS (double-submit pattern); it carries no authority by itself.
export const setCsrfCookie = (res, token) =>
  res.cookie(CSRF_COOKIE, token, { ...base(), httpOnly: false, maxAge: 7 * 24 * 3600 * 1000 });
