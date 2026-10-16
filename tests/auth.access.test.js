import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDb, clearDb, closeTestDb } from './helpers/db.js';
import { createClient } from './helpers/client.js';
import { createAlumnus, createAdmin, PASSWORD } from './helpers/fixtures.js';
import { User } from '../src/models/User.js';

beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(clearDb);

describe('login & access control', () => {
  it('returns a generic error for wrong password and unknown email alike', async () => {
    await createAlumnus({ email: 'known@example.com' });
    const c = await createClient();
    const a = await c.login('known@example.com', 'WrongPassw0rd!');
    const b = await c.login('unknown@example.com', 'WrongPassw0rd!');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('approved alumnus: gets an HTTP-only session cookie and can access the profile', async () => {
    await createAlumnus({ email: 'ok@example.com' });
    const c = await createClient();
    const res = await c.login('ok@example.com', PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data.access).toBe('full');
    const cookie = res.headers['set-cookie'].find((x) => x.startsWith('alumni_session='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);

    const profile = await c.get('/api/alumni/profile');
    expect(profile.status).toBe(200);
    expect(profile.body.data.user.email).toBe('ok@example.com');
    expect((await c.get('/api/auth/me')).body.data.user.email).toBe('ok@example.com');
  });

  it('pending alumnus: status-only session, protected alumni endpoints denied', async () => {
    await createAlumnus({ email: 'p@example.com', approvalStatus: 'pending' });
    const c = await createClient();
    const login = await c.login('p@example.com', PASSWORD);
    expect(login.status).toBe(200);
    expect(login.body.data.access).toBe('status-only');
    const profile = await c.get('/api/alumni/profile');
    expect(profile.status).toBe(403);
    expect(profile.body.error.code).toBe('ACCOUNT_PENDING');
    expect((await c.patch('/api/alumni/profile').send({ fullName: 'New Name' })).status).toBe(403);
    expect((await c.get('/api/alumni/status')).body.data.approvalStatus).toBe('pending');
  });

  it('rejected alumnus: protected endpoints denied, reason visible via status', async () => {
    await createAlumnus({ email: 'r@example.com', approvalStatus: 'rejected', rejectionReason: 'Not a graduate' });
    const c = await createClient();
    await c.login('r@example.com', PASSWORD);
    const profile = await c.get('/api/alumni/profile');
    expect(profile.status).toBe(403);
    expect(profile.body.error.code).toBe('ACCOUNT_REJECTED');
    expect((await c.get('/api/alumni/status')).body.data.rejectionReason).toBe('Not a graduate');
  });

  it('revokes access immediately when an approved user is later rejected in the DB', async () => {
    const u = await createAlumnus({ email: 'live@example.com' });
    const c = await createClient();
    await c.login('live@example.com', PASSWORD);
    expect((await c.get('/api/alumni/profile')).status).toBe(200);
    await User.updateOne({ _id: u._id }, { approvalStatus: 'rejected' });
    expect((await c.get('/api/alumni/profile')).status).toBe(403);
  });

  it('suspended accounts cannot log in, and existing sessions die', async () => {
    const u = await createAlumnus({ email: 's@example.com' });
    const c = await createClient();
    await c.login('s@example.com', PASSWORD);
    await User.updateOne({ _id: u._id }, { accountStatus: 'suspended' });
    expect((await c.get('/api/auth/me')).status).toBe(403);
    const again = await (await createClient()).login('s@example.com', PASSWORD);
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('requires authentication, and logout clears the session', async () => {
    const c = await createClient();
    expect((await c.get('/api/auth/me')).status).toBe(401);
    await createAlumnus({ email: 'l@example.com' });
    await c.login('l@example.com', PASSWORD);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('protects admin endpoints: anonymous 401, alumni 403 (even if approved), admin 200', async () => {
    await createAlumnus({ email: 'a@example.com' });
    await createAdmin();
    const anon = await createClient();
    expect((await anon.get('/api/admin/alumni')).status).toBe(401);

    const alum = await createClient();
    await alum.login('a@example.com', PASSWORD);
    for (const path of ['/api/admin/alumni', '/api/admin/dashboard/stats', '/api/admin/activity-logs', '/api/admin/exports/csv']) {
      expect((await alum.get(path)).status).toBe(403);
    }
    expect((await alum.post('/api/admin/notifications').send({})).status).toBe(403);

    const admin = await createClient();
    await admin.login('admin@example.com', PASSWORD);
    expect((await admin.get('/api/admin/alumni')).status).toBe(200);
  });

  it('a forged token with role=admin is useless (role is read from the DB)', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const u = await createAlumnus({ email: 'f@example.com' });
    const forged = jwt.sign({ tv: 0, role: 'admin' }, 'wrong-secret-wrong-secret-wrong-secret!!', { subject: String(u._id), issuer: 'alumni-portal' });
    const c = await createClient();
    const res = await c.agent.get('/api/admin/alumni').set('Cookie', `alumni_session=${forged}`);
    expect(res.status).toBe(401);
  });
});
