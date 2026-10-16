import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDb, clearDb, closeTestDb } from './helpers/db.js';
import { createClient } from './helpers/client.js';
import { createAlumnus, PASSWORD } from './helpers/fixtures.js';
import { User } from '../src/models/User.js';
import { Notification } from '../src/models/Notification.js';
import { createNotification } from '../src/services/notification.service.js';

beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(clearDb);

async function signedIn(over = {}) {
  const user = await createAlumnus(over);
  const c = await createClient();
  await c.login(user.email, PASSWORD);
  return { user, c };
}

describe('profile ownership & mass-assignment protection', () => {
  it('updates only the caller\'s own profile', async () => {
    const { user, c } = await signedIn({ fullName: 'Me' });
    const other = await createAlumnus({ fullName: 'Someone Else' });
    const res = await c.patch('/api/alumni/profile').send({ fullName: 'My New Name', phoneCountryCode: '+44', phoneNumber: '7911123456' });
    expect(res.status).toBe(200);
    expect((await User.findById(user._id)).fullName).toBe('My New Name');
    expect((await User.findById(other._id)).fullName).toBe('Someone Else');
    // there is no id in the route, so a body "id"/"_id"/"email" is simply refused
    for (const bad of [{ _id: String(other._id) }, { id: String(other._id) }, { email: 'hijack@example.com' }, { userId: String(other._id) }]) {
      expect((await c.patch('/api/alumni/profile').send(bad)).status).toBe(400);
    }
    expect((await User.findById(other._id)).fullName).toBe('Someone Else');
  });

  it('cannot change role, approval status, audit fields, account status or permissions', async () => {
    const { user, c } = await signedIn();
    const forbidden = [
      { role: 'admin' }, { approvalStatus: 'approved' }, { accountStatus: 'active' }, { rejectionReason: 'x' },
      { approvedBy: '507f1f77bcf86cd799439011' }, { approvedAt: new Date().toISOString() }, { rejectedBy: '507f1f77bcf86cd799439011' },
      { passwordHash: 'x' }, { tokenVersion: 99 }, { isAdmin: true }, { permissions: ['all'] },
      { fullName: 'Sneaky', role: 'admin' }, // mixed with a legal field: whole request refused
    ];
    for (const body of forbidden) expect((await c.patch('/api/alumni/profile').send(body)).status).toBe(400);
    const fresh = await User.findById(user._id).select('+tokenVersion');
    expect(fresh).toMatchObject({ role: 'alumni', approvalStatus: 'approved', fullName: user.fullName, tokenVersion: 0 });
  });

  it('validates profile updates (company rule, URLs, phone pair, years) and supports clearing', async () => {
    const { c } = await signedIn({ workingStatus: 'Employed', companyName: 'Acme' });
    expect((await c.patch('/api/alumni/profile').send({ companyName: '' })).status).toBe(400); // employed needs a company
    expect((await c.patch('/api/alumni/profile').send({ workingStatus: 'Unemployed', companyName: null })).status).toBe(200);
    expect((await c.patch('/api/alumni/profile').send({ linkedinUrl: 'https://example.com/x' })).status).toBe(400);
    expect((await c.patch('/api/alumni/profile').send({ phoneNumber: '9847012345' })).status).toBe(400); // must pair with country code
    expect((await c.patch('/api/alumni/profile').send({ academicYearStart: 2021, academicYearEnd: 2019 })).status).toBe(400);
    expect((await c.patch('/api/alumni/profile').send({ workingStatus: 'Employed' })).status).toBe(400); // now has no company
    expect((await c.patch('/api/alumni/profile').send({ workingStatus: 'Employed', companyName: 'NewCo', linkedinUrl: 'linkedin.com/in/me' })).status).toBe(200);
    expect((await c.patch('/api/alumni/profile').send({})).status).toBe(400);
  });

  it('status endpoint reports own status', async () => {
    const { c } = await signedIn();
    expect((await c.get('/api/alumni/status')).body.data).toMatchObject({ role: 'alumni', approvalStatus: 'approved', accountStatus: 'active' });
  });
});

describe('notifications', () => {
  it('lists only own notifications, with unread counts and filters', async () => {
    const { user, c } = await signedIn();
    const other = await createAlumnus();
    await createNotification(user._id, { type: 'account', title: 'Mine 1', message: 'm' });
    await createNotification(user._id, { type: 'announcement', title: 'Mine 2', message: 'm' });
    await createNotification(other._id, { type: 'account', title: 'Theirs', message: 'secret' });
    const res = await c.get('/api/alumni/notifications');
    expect(res.status).toBe(200);
    expect(res.body.data.map((n) => n.title).sort()).toEqual(['Mine 1', 'Mine 2']);
    expect(res.body.meta).toMatchObject({ total: 2, unreadCount: 2 });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|recipient/);
    expect((await c.get('/api/alumni/notifications?unread=true&limit=1')).body.data).toHaveLength(1);
  });

  it('mark-as-read works for own notifications and is a 404 for someone else\'s', async () => {
    const { user, c } = await signedIn();
    const other = await createAlumnus();
    const mine = await createNotification(user._id, { type: 'account', title: 'Mine', message: 'm' });
    const theirs = await createNotification(other._id, { type: 'account', title: 'Theirs', message: 'm' });

    const res = await c.patch(`/api/alumni/notifications/${mine._id}/read`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isRead: true });
    expect(res.body.data.readAt).toBeTruthy();

    expect((await c.patch(`/api/alumni/notifications/${theirs._id}/read`).send({})).status).toBe(404);
    expect((await Notification.findById(theirs._id)).isRead).toBe(false);
  });

  it('mark-all-read only touches the caller\'s notifications', async () => {
    const { user, c } = await signedIn();
    const other = await createAlumnus();
    await createNotification(user._id, { type: 'account', title: 'a', message: 'm' });
    await createNotification(user._id, { type: 'account', title: 'b', message: 'm' });
    await createNotification(other._id, { type: 'account', title: 'c', message: 'm' });
    const res = await c.patch('/api/alumni/notifications/read-all').send({});
    expect(res.body.data.updated).toBe(2);
    expect(await Notification.countDocuments({ recipient: user._id, isRead: false })).toBe(0);
    expect(await Notification.countDocuments({ recipient: other._id, isRead: false })).toBe(1);
  });

  it('pending users can still read their own account messages', async () => {
    const { user, c } = await signedIn({ approvalStatus: 'pending' });
    await createNotification(user._id, { type: 'account', title: 'Welcome', message: 'm' });
    expect((await c.get('/api/alumni/notifications')).body.data).toHaveLength(1);
  });
});
