import 'dotenv/config';
import { z } from 'zod';

// Treat empty strings (e.g. "GOOGLE_CLIENT_ID=") as "not set".
const emptyToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = (schema) => z.preprocess(emptyToUndefined, schema.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_URL: z.preprocess(emptyToUndefined, z.string().default('http://localhost:5173')),
  TRUST_PROXY: z.preprocess(emptyToUndefined, z.string().default('0')),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(24 * 30).default(12)),
  COOKIE_SAMESITE: z.preprocess(emptyToUndefined, z.enum(['lax', 'strict', 'none']).default('lax')),
  COOKIE_DOMAIN: opt(z.string()),
  GOOGLE_CLIENT_ID: opt(z.string()),
  SMTP_HOST: opt(z.string()),
  SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().default(587)),
  SMTP_SECURE: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).default('false')),
  SMTP_USER: opt(z.string()),
  SMTP_PASS: opt(z.string()),
  EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().default('Alumni Portal <no-reply@localhost>')),
  PASSWORD_RESET_URL: z.preprocess(emptyToUndefined, z.string().url().default('http://localhost:5173/reset-password')),
  RESET_TOKEN_TTL_MINUTES: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(24 * 60).default(30)),
  EXPORT_MAX_ROWS: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(50000)),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${lines}\nSee server/.env.example`);
}

const raw = parsed.data;
if (raw.JWT_SECRET === raw.COOKIE_SECRET) {
  throw new Error('JWT_SECRET and COOKIE_SECRET must be different values');
}

const parseTrustProxy = (v) => {
  if (/^\d+$/.test(v)) return Number(v) === 0 ? false : Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v; // e.g. "loopback"
};

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  trustProxy: parseTrustProxy(raw.TRUST_PROXY),
  allowedOrigins: raw.CLIENT_URL.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  smtpSecure: raw.SMTP_SECURE === 'true',
  cookieSecure: raw.NODE_ENV === 'production' || raw.COOKIE_SAMESITE === 'none',
};
