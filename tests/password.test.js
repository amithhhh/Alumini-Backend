import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { connectTestDb, clearDb, closeTestDb } from './helpers/db.js';
import { createAlumnus, PASSWORD } from './helpers/fixtures.js';

const sent = [];
vi.mock('../src/services/mail.service.js', () => ({
  sendPasswordResetEmail: vi.fn(async (m) => { sent.push(m); }),
}));

const { createClient } = await import('./helpers/client.js');
const { PasswordResetToken } = await import('../src/models/PasswordResetToken.js');
const { User } = await import('../src/models/User.js');
const { hashToken } = await import('../src/services/token.service.js');

beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => { await clearDb(); sent.length = 0; });

const tokenFrom = (m) => new URL(m.resetUrl).searchParams.get('token');

describe('password reset', () => {
  it('returns the same generic response for known and unknown emails; only sends mail for known', async () => {
    await createAlumnus({ email: 'known@example.com' });
    const c = await createClient();
    const a = await c.post('/api/auth/forgot-password').send({ email: 'known@example.com' });
    const b = await c.post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('known@example.com');
  });

  it('stores only a SHA-256 hash of the token, with a short expiry', async () => {
    await createAlumnus({ email: 'known@example.com' });
    const c = await createClient();
    await c.post('/api/auth/forgot-password').send({ email: 'known@example.com' });
    const raw = tokenFrom(sent[0]);
    expect(raw).toMatch(/^[a-f0-9]{64}$/);
    const rec = await PasswordResetToken.findOne();
    expect(rec.tokenHash).toBe(hashToken(raw));
    expect(rec.tokenHash).not.toBe(raw);
    const ttlMin = (rec.expiresAt - Date.now()) / 60000;
    expect(ttlMin).toBeGreaterThan(1);
    expect(ttlMin).toBeLessThanOrEqual(31);
  });

  it('resets the password once, signs out existing sessions, and rejects reuse', async () => {
    await createAlumnus({ email: 'known@example.com' });
    const session = await createClient();
    await session.login('known@example.com', PASSWORD);
    expect((await session.get('/api/auth/me')).status).toBe(200);

    const c = await createClient();
    await c.post('/api/auth/forgot-password').send({ email: 'known@example.com' });
    const token = tokenFrom(sent[0]);
    const ok = await c.post('/api/auth/reset-password').send({ token, password: 'BrandNewPassw0rd' });
    expect(ok.status).toBe(200);

    expect((await session.get('/api/auth/me')).status).toBe(401); // old session revoked
    expect((await (await createClient()).login('known@example.com', PASSWORD)).status).toBe(401);
    expect((await (await createClient()).login('known@example.com', 'BrandNewPassw0rd')).status).toBe(200);

    const reuse = await c.post('/api/auth/reset-password').send({ token, password: 'AnotherPassw0rd1' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
  });

  it('rejects an expired token', async () => {
    const u = await createAlumnus({ email: 'known@example.com' });
    const raw = 'a'.repeat(64);
    await PasswordResetToken.create({ userId: u._id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() - 1000) });
    const c = await createClient();
    const res = await c.post('/api/auth/reset-password').send({ token: raw, password: 'BrandNewPassw0rd' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    expect((await (await createClient()).login('known@example.com', PASSWORD)).status).toBe(200); // unchanged
  });

  it('rejects a token that was never issued, and a weak new password', async () => {
    const c = await createClient();
    expect((await c.post('/api/auth/reset-password').send({ token: 'b'.repeat(64), password: 'BrandNewPassw0rd' })).status).toBe(400);
    expect((await c.post('/api/auth/reset-password').send({ token: 'b'.repeat(64), password: 'short' })).status).toBe(400);
  });

  it('a newer reset request invalidates the older link', async () => {
    await createAlumnus({ email: 'known@example.com' });
    const c = await createClient();
    await c.post('/api/auth/forgot-password').send({ email: 'known@example.com' });
    await c.post('/api/auth/forgot-password').send({ email: 'known@example.com' });
    const [first, second] = sent.map(tokenFrom);
    expect((await c.post('/api/auth/reset-password').send({ token: first, password: 'BrandNewPassw0rd' })).status).toBe(400);
    expect((await c.post('/api/auth/reset-password').send({ token: second, password: 'BrandNewPassw0rd' })).status).toBe(200);
  });

  it('change-password requires the current password and revokes other sessions', async () => {
    await createAlumnus({ email: 'known@example.com' });
    const a = await createClient();
    const b = await createClient();
    await a.login('known@example.com', PASSWORD);
    await b.login('known@example.com', PASSWORD);
    expect((await a.post('/api/auth/change-password').send({ currentPassword: 'nope-nope-1', newPassword: 'BrandNewPassw0rd' })).status).toBe(400);
    expect((await a.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'BrandNewPassw0rd' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200); // current session re-issued
    expect((await b.get('/api/auth/me')).status).toBe(401); // other device signed out
    const u = await User.findOne({ email: 'known@example.com' }).select('+passwordHash');
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
  });
});
