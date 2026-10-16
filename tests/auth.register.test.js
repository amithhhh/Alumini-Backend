import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDb, clearDb, closeTestDb } from './helpers/db.js';
import { createClient } from './helpers/client.js';
import { validRegistration } from './helpers/fixtures.js';
import { User } from '../src/models/User.js';
import { hashPassword, verifyPassword } from '../src/services/password.service.js';

beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(clearDb);

describe('POST /api/auth/register', () => {
  it('registers an alumnus as pending with a safe response', async () => {
    const c = await createClient();
    const res = await c.post('/api/auth/register').send(validRegistration({ email: '  Asha.Menon@Example.com ' }));
    expect(res.status).toBe(201);
    const { user } = res.body.data;
    expect(user).toMatchObject({ email: 'asha.menon@example.com', role: 'alumni', approvalStatus: 'pending', phoneCountryCode: '+91' });
    expect(user.registeredAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$argon2|tokenVersion/);
    expect(res.headers['set-cookie']?.join(';') ?? '').not.toMatch(/alumni_session/); // registration never logs in
  });

  it('hashes the password with Argon2id before storage', async () => {
    const c = await createClient();
    await c.post('/api/auth/register').send(validRegistration());
    const stored = await User.findOne({ email: 'asha.menon@example.com' }).select('+passwordHash');
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain('Str0ngPassw0rd');
    expect(await verifyPassword(stored.passwordHash, 'Str0ngPassw0rd!')).toBe(true);
    expect(await verifyPassword(stored.passwordHash, 'wrong')).toBe(false);
    expect(await hashPassword('x1234567890')).not.toBe(await hashPassword('x1234567890')); // salted
  });

  it('rejects duplicate registrations gracefully (409) and keeps one record', async () => {
    const c = await createClient();
    expect((await c.post('/api/auth/register').send(validRegistration())).status).toBe(201);
    const dup = await c.post('/api/auth/register').send(validRegistration({ email: 'ASHA.MENON@example.com' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(await User.countDocuments({ email: 'asha.menon@example.com' })).toBe(1);
  });

  it('enforces email uniqueness with a MongoDB unique index', async () => {
    const indexes = await User.collection.indexes();
    expect(indexes.some((i) => i.unique && i.key.email === 1)).toBe(true);
  });

  it.each([
    ['bad email', { email: 'nope' }],
    ['short password', { password: 'abc1' }],
    ['password without number', { password: 'onlyletterspassword' }],
    ['invalid phone', { phoneNumber: '123' }],
    ['phone invalid for country', { phoneCountryCode: '+1', phoneNumber: '1234567890' }],
    ['bad category', { category: 'martian' }],
    ['bad program', { program: 'BSc Underwater Basket Weaving' }],
    ['bad working status', { workingStatus: 'Astronaut' }],
    ['end year before start', { academicYearStart: 2020, academicYearEnd: 2018 }],
    ['non-linkedin LinkedIn URL', { linkedinUrl: 'https://evil.example.com/in/x' }],
    ['javascript: website', { companyWebsite: 'javascript://alert(1)' }],
    ['employed without company', { workingStatus: 'Employed', companyName: '' }],
    ['self-employed without company', { workingStatus: 'Self-employed', companyName: undefined }],
  ])('rejects invalid data: %s', async (_label, patch) => {
    const c = await createClient();
    const res = await c.post('/api/auth/register').send(validRegistration(patch));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await User.countDocuments()).toBe(0);
  });

  it('does not require a company for unemployed alumni', async () => {
    const c = await createClient();
    const res = await c.post('/api/auth/register').send(validRegistration({ workingStatus: 'Unemployed', companyName: '', companyWebsite: '', linkedinUrl: '' }));
    expect(res.status).toBe(201);
  });

  it('never lets clients choose role, approval status or other server-controlled fields', async () => {
    const c = await createClient();
    for (const extra of [{ role: 'admin' }, { approvalStatus: 'approved' }, { accountStatus: 'active' }, { approvedBy: '507f1f77bcf86cd799439011' }]) {
      const res = await c.post('/api/auth/register').send(validRegistration(extra));
      expect(res.status).toBe(400);
    }
    expect(await User.countDocuments()).toBe(0);
  });

  it('blocks NoSQL operator injection', async () => {
    const c = await createClient();
    const res = await c.post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });

  it('requires a CSRF token on state-changing requests', async () => {
    const request = (await import('supertest')).default;
    const { app } = await import('./helpers/client.js');
    const res = await request(app).post('/api/auth/register').send(validRegistration());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });
});
