import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDb, clearDb, closeTestDb } from './helpers/db.js';
import { createClient } from './helpers/client.js';
import { createAlumnus, createAdmin, PASSWORD } from './helpers/fixtures.js';
import { User } from '../src/models/User.js';
import { Notification } from '../src/models/Notification.js';
import { AdminActivityLog } from '../src/models/AdminActivityLog.js';
import mongoose from 'mongoose';

beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(clearDb);

async function adminClient() {
  const admin = await createAdmin();
  const c = await createClient();
  await c.login('admin@example.com', PASSWORD);
  return { admin, c };
}

describe('approval workflow', () => {
  it('approves a pending registration: state, who/when, notification, audit entry', async () => {
    const { admin, c } = await adminClient();
    const u = await createAlumnus({ approvalStatus: 'pending' });
    const res = await c.patch(`/api/admin/alumni/${u._id}/approve`).send({});
    expect(res.status).toBe(200);
    const fresh = await User.findById(u._id);
    expect(fresh.approvalStatus).toBe('approved');
    expect(String(fresh.approvedBy)).toBe(String(admin._id));
    expect(fresh.approvedAt).toBeInstanceOf(Date);
    const n = await Notification.findOne({ recipient: u._id, type: 'approval' });
    expect(n).toBeTruthy();
    const log = await AdminActivityLog.findOne({ action: 'alumni.approve' });
    expect(String(log.adminId)).toBe(String(admin._id));
    expect(String(log.resourceId)).toBe(String(u._id));
    expect(log.requestId).toBeTruthy();
  });

  it('approving twice is a 409 (atomic state check), and unknown ids are 404', async () => {
    const { c } = await adminClient();
    const u = await createAlumnus({ approvalStatus: 'pending' });
    expect((await c.patch(`/api/admin/alumni/${u._id}/approve`).send({})).status).toBe(200);
    const again = await c.patch(`/api/admin/alumni/${u._id}/approve`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect((await c.patch('/api/admin/alumni/507f1f77bcf86cd799439011/approve').send({})).status).toBe(404);
    expect((await c.patch('/api/admin/alumni/not-an-id/approve').send({})).status).toBe(400);
  });

  it('concurrent approvals only apply once', async (ctx) => {
    // Relies on MongoDB's single-document update atomicity. FerretDB (a stand-in used where no mongod can be
    // installed) does not provide it, so the test is skipped there instead of reporting a false failure.
    const info = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    if (info.ferretdbVersion) ctx.skip();
    const { c } = await adminClient();
    const u = await createAlumnus({ approvalStatus: 'pending' });
    const results = await Promise.all([1, 2, 3].map(() => c.patch(`/api/admin/alumni/${u._id}/approve`).send({})));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await Notification.countDocuments({ recipient: u._id, type: 'approval' })).toBe(1);
  });

  it('rejection requires a reason, records who/when, notifies, and is audited', async () => {
    const { admin, c } = await adminClient();
    const u = await createAlumnus({ approvalStatus: 'pending' });
    expect((await c.patch(`/api/admin/alumni/${u._id}/reject`).send({})).status).toBe(400);
    expect((await c.patch(`/api/admin/alumni/${u._id}/reject`).send({ reason: 'x' })).status).toBe(400);
    expect((await User.findById(u._id)).approvalStatus).toBe('pending');

    const res = await c.patch(`/api/admin/alumni/${u._id}/reject`).send({ reason: 'Could not verify enrolment' });
    expect(res.status).toBe(200);
    const fresh = await User.findById(u._id);
    expect(fresh).toMatchObject({ approvalStatus: 'rejected', rejectionReason: 'Could not verify enrolment' });
    expect(String(fresh.rejectedBy)).toBe(String(admin._id));
    expect((await Notification.findOne({ recipient: u._id, type: 'rejection' })).message).toContain('Could not verify enrolment');
    expect(await AdminActivityLog.countDocuments({ action: 'alumni.reject' })).toBe(1);
  });

  it('a rejected registration can be approved later and rejection fields are cleared', async () => {
    const { c } = await adminClient();
    const u = await createAlumnus({ approvalStatus: 'rejected', rejectionReason: 'Mistake' });
    expect((await c.patch(`/api/admin/alumni/${u._id}/approve`).send({})).status).toBe(200);
    const fresh = await User.findById(u._id);
    expect(fresh.approvalStatus).toBe('approved');
    expect(fresh.rejectionReason).toBeUndefined();
  });

  it('suspending revokes the live session immediately; reactivating restores login; both audited', async () => {
    const { c } = await adminClient();
    const u = await createAlumnus({ email: 'live@example.com' });
    const alum = await createClient();
    await alum.login('live@example.com', PASSWORD);
    expect((await alum.get('/api/alumni/profile')).status).toBe(200);

    expect((await c.patch(`/api/admin/alumni/${u._id}/status`).send({ accountStatus: 'suspended' })).status).toBe(400); // reason required
    expect((await c.patch(`/api/admin/alumni/${u._id}/status`).send({ accountStatus: 'suspended', reason: 'Policy violation' })).status).toBe(200);
    expect((await alum.get('/api/alumni/profile')).status).toBe(401); // session revoked (tokenVersion bumped)
    const blocked = await (await createClient()).login('live@example.com', PASSWORD);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await c.patch(`/api/admin/alumni/${u._id}/status`).send({ accountStatus: 'active' })).status).toBe(200);
    expect((await (await createClient()).login('live@example.com', PASSWORD)).status).toBe(200);
    expect(await AdminActivityLog.countDocuments({ action: 'alumni.status_change' })).toBe(2);
  });

  it('admin can edit an alumnus profile (audited with field names only)', async () => {
    const { c } = await adminClient();
    const u = await createAlumnus();
    const res = await c.patch(`/api/admin/alumni/${u._id}`).send({ fullName: 'Corrected Name' });
    expect(res.status).toBe(200);
    const log = await AdminActivityLog.findOne({ action: 'alumni.profile_update' });
    expect(log.details).toEqual({ changedFields: ['fullName'] });
  });
});

describe('listing, search, filters', () => {
  async function seed() {
    await createAlumnus({ fullName: 'Anita Nair', email: 'anita@example.com', program: 'MCA', category: 'indian', academicYearStart: 2016, academicYearEnd: 2018, workingStatus: 'Employed', approvalStatus: 'approved' });
    await createAlumnus({ fullName: 'Bilal Khan', email: 'bilal@gulf.example.com', program: 'MSc Computer Science', category: 'nri', academicYearStart: 2018, academicYearEnd: 2020, workingStatus: 'Higher Studies', companyName: undefined, approvalStatus: 'pending' });
    await createAlumnus({ fullName: 'Chitra Rao', email: 'chitra@example.com', program: 'PGDCS — Cyber Security', category: 'nri', academicYearStart: 2019, academicYearEnd: 2020, workingStatus: 'Unemployed', companyName: undefined, approvalStatus: 'rejected' });
  }

  it('paginates, sorts, searches and filters', async () => {
    const { c } = await adminClient();
    await seed();
    const all = await c.get('/api/admin/alumni?limit=2&page=1&sortBy=fullName&sortOrder=asc');
    expect(all.body.meta).toMatchObject({ total: 3, totalPages: 2, page: 1, limit: 2 });
    expect(all.body.data.map((u) => u.fullName)).toEqual(['Anita Nair', 'Bilal Khan']);
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash/);

    const q = async (qs) => (await c.get(`/api/admin/alumni?${qs}`)).body.data.map((u) => u.fullName).sort();
    expect(await q('search=bilal')).toEqual(['Bilal Khan']);
    expect(await q('search=EXAMPLE.com')).toHaveLength(3);
    expect(await q('category=nri')).toEqual(['Bilal Khan', 'Chitra Rao']);
    expect(await q('approvalStatus=pending')).toEqual(['Bilal Khan']);
    expect(await q('academicYearEnd=2020')).toEqual(['Bilal Khan', 'Chitra Rao']);
    expect(await q('academicYearStart=2016')).toEqual(['Anita Nair']);
    expect(await q(`program=${encodeURIComponent('PGDCS — Cyber Security')}`)).toEqual(['Chitra Rao']);
    expect(await q('workingStatus=Employed')).toEqual(['Anita Nair']);
    expect(await q('category=nri&approvalStatus=rejected')).toEqual(['Chitra Rao']);
  });

  it('treats search as literal text (regex metacharacters are escaped) and rejects bad queries', async () => {
    const { c } = await adminClient();
    await seed();
    expect((await c.get('/api/admin/alumni?search=.*')).body.data).toHaveLength(0);
    expect((await c.get('/api/admin/alumni?sortBy=passwordHash')).status).toBe(400);
    expect((await c.get('/api/admin/alumni?limit=1000')).status).toBe(400);
    expect((await c.get('/api/admin/alumni?category[$ne]=x')).status).toBe(400);
  });

  it('does not list admins and returns detail by id', async () => {
    const { c } = await adminClient();
    const u = await createAlumnus();
    const list = await c.get('/api/admin/alumni');
    expect(list.body.data.every((x) => x.role === 'alumni')).toBe(true);
    expect((await c.get(`/api/admin/alumni/${u._id}`)).body.data.user.email).toBe(u.email);
  });
});

describe('dashboard statistics (computed from MongoDB)', () => {
  it('returns real aggregates', async () => {
    const { c } = await adminClient();
    await createAlumnus({ approvalStatus: 'approved', category: 'indian', program: 'MCA', workingStatus: 'Employed' });
    await createAlumnus({ approvalStatus: 'approved', category: 'nri', program: 'MCA', workingStatus: 'Employed' });
    await createAlumnus({ approvalStatus: 'pending', category: 'nri', program: 'MSc Computer Science', workingStatus: 'Unemployed', companyName: undefined });
    await createAlumnus({ approvalStatus: 'rejected', category: 'indian', program: 'PGDDSA — Data Science', workingStatus: 'Higher Studies', companyName: undefined });
    const { body } = await c.get('/api/admin/dashboard/stats?months=3');
    expect(body.data.totals).toEqual({ registrations: 4, pending: 1, approved: 2, rejected: 1, indian: 2, nri: 2 });
    expect(body.data.byProgram.find((p) => p.program === 'MCA').count).toBe(2);
    expect(body.data.byWorkingStatus.find((w) => w.workingStatus === 'Employed').count).toBe(2);
    expect(body.data.byAcademicYear).toEqual([{ academicYearStart: 2018, academicYearEnd: 2020, label: '2018-2020', count: 4 }]);
    expect(body.data.registrationsOverTime).toHaveLength(3);
    expect(body.data.registrationsOverTime.reduce((s, r) => s + r.count, 0)).toBe(4);
  });
});

describe('admin notifications & activity log', () => {
  it('sends an announcement only to approved, active alumni (optionally filtered) and audits it', async () => {
    const { c } = await adminClient();
    const a = await createAlumnus({ program: 'MCA' });
    const b = await createAlumnus({ program: 'MSc Computer Science' });
    const pending = await createAlumnus({ approvalStatus: 'pending' });
    const suspended = await createAlumnus({ accountStatus: 'suspended' });
    const res = await c.post('/api/admin/notifications').send({ audience: 'all_approved', title: 'Reunion', message: 'Save the date' });
    expect(res.status).toBe(201);
    expect(res.body.data.recipients).toBe(2);
    for (const u of [a, b]) expect(await Notification.countDocuments({ recipient: u._id, type: 'announcement' })).toBe(1);
    for (const u of [pending, suspended]) expect(await Notification.countDocuments({ recipient: u._id, type: 'announcement' })).toBe(0);

    const filtered = await c.post('/api/admin/notifications').send({ audience: 'all_approved', filters: { program: 'MCA' }, title: 'MCA meetup', message: 'Hello MCA' });
    expect(filtered.body.data.recipients).toBe(1);
    expect(await AdminActivityLog.countDocuments({ action: 'notification.send' })).toBe(2);
  });

  it('sends an account-specific message to one user and validates input', async () => {
    const { c } = await adminClient();
    const u = await createAlumnus();
    expect((await c.post('/api/admin/notifications').send({ audience: 'user', userId: String(u._id), title: 'Hi', message: 'Please update your profile' })).status).toBe(201);
    expect((await Notification.findOne({ recipient: u._id })).type).toBe('account');
    expect((await c.post('/api/admin/notifications').send({ audience: 'user', title: 'Hi', message: 'x' })).status).toBe(400);
    expect((await c.post('/api/admin/notifications').send({ audience: 'everyone', title: 'Hi', message: 'x' })).status).toBe(400);
  });

  it('activity log is readable by admins, never contains secrets, and is append-only', async () => {
    const { c } = await adminClient();
    const u = await createAlumnus({ approvalStatus: 'pending' });
    await c.patch(`/api/admin/alumni/${u._id}/reject`).send({ reason: 'No record found for this person' });
    const res = await c.get('/api/admin/activity-logs?action=alumni.reject');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].admin.email).toBe('admin@example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

    await expect(AdminActivityLog.updateOne({}, { action: 'tampered' })).rejects.toThrow(/append-only/);
    await expect(AdminActivityLog.deleteMany({})).rejects.toThrow(/append-only/);
    const doc = await AdminActivityLog.findOne();
    doc.action = 'tampered';
    await expect(doc.save()).rejects.toThrow(/append-only/);
    expect((await c.patch('/api/admin/activity-logs').send({})).status).toBe(404); // no mutation endpoints exist
  });

  it('audit details strip secret-looking keys', async () => {
    const { sanitizeDetails } = await import('../src/services/audit.service.js');
    expect(sanitizeDetails({ ok: 1, password: 'x', resetToken: 'y', nested: { passwordHash: 'z', keep: 'v' } })).toEqual({ ok: 1, nested: { keep: 'v' } });
  });
});
