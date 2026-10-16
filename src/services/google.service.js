import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { normalizeEmail } from '../utils/strings.js';

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
let client;

export const isGoogleConfigured = () => Boolean(env.GOOGLE_CLIENT_ID);

/**
 * Verifies a Google ID token (works for both Sign-In With Google and One Tap — both yield the same JWT).
 * google-auth-library checks signature (Google's rotating public keys), audience and expiry; we then
 * explicitly re-assert issuer, audience, `sub` and `email_verified`.
 */
export async function verifyGoogleIdToken(idToken) {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured on this server');
  }
  client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google credential could not be verified');
  }
  if (!payload || !payload.sub || !ISSUERS.includes(payload.iss) || payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google credential could not be verified');
  }
  if (!payload.exp || payload.exp * 1000 <= Date.now()) {
    throw new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Google credential has expired');
  }
  if (!payload.email || payload.email_verified !== true) {
    throw new AppError(401, 'GOOGLE_EMAIL_UNVERIFIED', 'Your Google account email is not verified');
  }
  return { sub: payload.sub, email: normalizeEmail(payload.email), emailVerified: true, name: payload.name };
}
