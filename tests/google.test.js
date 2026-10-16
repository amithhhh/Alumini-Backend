import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { connectTestDb, clearDb, closeTestDb } from './helpers/db.js';
import { createAlumnus, validRegistration, PASSWORD } from './helpers/fixtures.js';

// --- Part 1: the verification service against a mocked google-auth-library -------------------------------
const verifyIdToken = vi.fn();
vi.mock('google-auth-library', () => ({ OAuth2Client: class { verifyIdToken(...a) { return verifyIdToken(...a); } } }));

const { verifyGoogleIdToken } = await import('../src/services/google.service.js');
const aud = process.env.GOOGLE_CLIENT_ID;
const good = () => ({ sub: '1234567890', iss: 'https://accounts.google.com', aud, exp: Math.floor(Date.now() / 1000) + 600, email: 'Asha.Menon@Example.com', email_verified: true, name: 'Asha' });
const ticket = (payload) => ({ getPayload: () => payload });

describe('Google ID token verification', () => {
  it('accepts a valid token and normalises the claims', async () => {
    verifyIdToken.mockResolvedValueOnce(ticket(good()));
    const r = await verifyGoogleIdToken('x'.repeat(30));
    expect(r).toMatchObject({ sub: '1234567890', email: 'asha.menon@example.com', emailVerified: true });
    expect(verifyIdToken).toHaveBeenLastCalledWith({ idToken: 'x'.repeat(30), audience: aud });
  });

  it.each([
    ['library rejects (bad signature/expired/audience)', () => { verifyIdToken.mockRejectedValueOnce(new Error('Invalid token signature')); }, 'INVALID_GOOGLE_TOKEN'],
    ['wrong issuer', () => verifyIdToken.mockResolvedValueOnce(ticket({ ...good(), iss: 'https://evil.example.com' })), 'INVALID_GOOGLE_TOKEN'],
    ['wrong audience', () => verifyIdToken.mockResolvedValueOnce(ticket({ ...good(), aud: 'someone-else' })), 'INVALID_GOOGLE_TOKEN'],
    ['expired', () => verifyIdToken.mockResolvedValueOnce(ticket({ ...good(), exp: Math.floor(Date.now() / 1000) - 5 })), 'INVALID_GOOGLE_TOKEN'],
    ['missing sub', () => verifyIdToken.mockResolvedValueOnce(ticket({ ...good(), sub: undefined })), 'INVALID_GOOGLE_TOKEN'],
    ['unverified email', () => verifyIdToken.mockResolvedValueOnce(ticket({ ...good(), email_verified: false })), 'GOOGLE_EMAIL_UNVERIFIED'],
  ])('rejects: %s', async (_l, arrange, code) => {
    arrange();
    await expect(verifyGoogleIdToken('x'.repeat(30))).rejects.toMatchObject({ code });
  });
});

// --- Part 2: login/link/register flows (verification itself is stubbed per-request) ---------------------
const { createClient } = await import('./helpers/client.js');
const { ExternalIdentity } = await import('../src/models/ExternalIdentity.js');
const { User } = await import('../src/models/User.js');

beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => { await clearDb(); verifyIdToken.mockReset(); });

const asGoogle = (over = {}) => verifyIdToken.mockResolvedValue(ticket({ ...good(), ...over }));
const TOKEN = 'g'.repeat(40);

describe('Google login flow', () => {
  it('unknown Google user -> 404 REGISTRATION_REQUIRED, no session', async () => {
    asGoogle();
    const c = await createClient();
    const res = await c.post('/api/auth/google').send({ idToken: TOKEN });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REGISTRATION_REQUIRED');
    expect(res.headers['set-cookie']?.join(';') ?? '').not.toMatch(/alumni_session/);
  });

  it('does NOT auto-merge into an existing account that merely has the same email', async () => {
    await createAlumnus({ email: 'asha.menon@example.com' });
    asGoogle();
    const c = await createClient();
    const res = await c.post('/api/auth/google').send({ idToken: TOKEN });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACCOUNT_LINK_REQUIRED');
    expect(await ExternalIdentity.countDocuments()).toBe(0);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('secure linking: needs an authenticated session + current password, then Google login works', async () => {
    await createAlumnus({ email: 'asha.menon@example.com' });
    asGoogle();
    const c = await createClient();
    expect((await c.post('/api/auth/google/link').send({ idToken: TOKEN, currentPassword: PASSWORD })).status).toBe(401); // not signed in
    await c.login('asha.menon@example.com', PASSWORD);
    expect((await c.post('/api/auth/google/link').send({ idToken: TOKEN, currentPassword: 'WrongPassw0rd1' })).status).toBe(403);
    expect((await c.post('/api/auth/google/link').send({ idToken: TOKEN, currentPassword: PASSWORD })).status).toBe(200);
    const identity = await ExternalIdentity.findOne();
    expect(identity).toMatchObject({ provider: 'google', subject: '1234567890' });

    const fresh = await createClient();
    const res = await fresh.post('/api/auth/google').send({ idToken: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.data.access).toBe('full');
    expect(res.headers['set-cookie'].join(';')).toMatch(/alumni_session=.*HttpOnly/i);
  });

  it('one Google subject cannot be linked to two accounts', async () => {
    await createAlumnus({ email: 'one@example.com' });
    await createAlumnus({ email: 'two@example.com' });
    asGoogle();
    const a = await createClient();
    await a.login('one@example.com', PASSWORD);
    expect((await a.post('/api/auth/google/link').send({ idToken: TOKEN, currentPassword: PASSWORD })).status).toBe(200);
    const b = await createClient();
    await b.login('two@example.com', PASSWORD);
    const res = await b.post('/api/auth/google/link').send({ idToken: TOKEN, currentPassword: PASSWORD });
    expect(res.status).toBe(409);
  });

  it('pending and rejected Google users get a status-only session, never protected access', async () => {
    for (const approvalStatus of ['pending', 'rejected']) {
      await clearDb();
      const u = await createAlumnus({ email: 'asha.menon@example.com', approvalStatus });
      await ExternalIdentity.create({ userId: u._id, provider: 'google', subject: '1234567890' });
      asGoogle();
      const c = await createClient();
      const res = await c.post('/api/auth/google').send({ idToken: TOKEN });
      expect(res.status).toBe(200);
      expect(res.body.data.access).toBe('status-only');
      const profile = await c.get('/api/alumni/profile');
      expect(profile.status).toBe(403);
      expect(profile.body.error.code).toBe(approvalStatus === 'pending' ? 'ACCOUNT_PENDING' : 'ACCOUNT_REJECTED');
    }
  });

  it('identity is matched by Google sub, not email (changed Google email still logs in)', async () => {
    const u = await createAlumnus({ email: 'asha.menon@example.com' });
    await ExternalIdentity.create({ userId: u._id, provider: 'google', subject: '1234567890' });
    asGoogle({ email: 'brand.new.address@example.com' });
    const res = await (await createClient()).post('/api/auth/google').send({ idToken: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('asha.menon@example.com');
  });

  it('invalid Google credential -> 401', async () => {
    verifyIdToken.mockRejectedValue(new Error('bad'));
    const res = await (await createClient()).post('/api/auth/google').send({ idToken: TOKEN });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_GOOGLE_TOKEN');
  });

  it('registration via Google: pending, password optional, identity stored, email must match token', async () => {
    asGoogle();
    const c = await createClient();
    const body = validRegistration({ email: 'asha.menon@example.com', googleIdToken: TOKEN });
    delete body.password;
    const mismatch = await c.post('/api/auth/register').send({ ...body, email: 'other@example.com' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('GOOGLE_EMAIL_MISMATCH');
    const ok = await c.post('/api/auth/register').send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.data.user.approvalStatus).toBe('pending');
    const stored = await User.findOne({ email: 'asha.menon@example.com' }).select('+passwordHash');
    expect(stored.passwordHash).toBeUndefined();
    expect(await ExternalIdentity.countDocuments({ subject: '1234567890' })).toBe(1);
    // and they still cannot get protected access through Google login
    const login = await c.post('/api/auth/google').send({ idToken: TOKEN });
    expect(login.body.data.access).toBe('status-only');
    expect((await c.get('/api/alumni/profile')).status).toBe(403);
  });
});
