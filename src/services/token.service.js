import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'alumni-portal';

export function signSession(user) {
  return jwt.sign({ tv: user.tokenVersion ?? 0 }, env.JWT_SECRET, {
    algorithm: 'HS256', issuer: ISSUER, subject: String(user._id), expiresIn: `${Math.round(env.SESSION_TTL_HOURS * 3600)}s`,
  });
}

export const verifySession = (token) => jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: ISSUER });

const hmac = (v) => createHmac('sha256', env.COOKIE_SECRET).update(v).digest('base64url');

export function generateCsrfToken() {
  const rand = randomBytes(32).toString('base64url');
  return `${rand}.${hmac(rand)}`;
}

export function isValidCsrfToken(token) {
  if (typeof token !== 'string') return false;
  const [rand, sig, extra] = token.split('.');
  if (!rand || !sig || extra !== undefined) return false;
  const expected = Buffer.from(hmac(rand));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const hashToken = (raw) => createHash('sha256').update(raw).digest('hex');

export function generateResetToken() {
  const raw = randomBytes(32).toString('hex'); // 256 bits, 64 hex chars
  return { raw, hash: hashToken(raw) };
}
