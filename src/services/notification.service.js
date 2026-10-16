import mongoose from 'mongoose';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

export const createNotification = (recipient, { type, title, message, createdBy }) =>
  Notification.create({ recipient, audience: 'user', type, title, message, createdBy });

/** Fan an announcement out to approved, active alumni (optionally narrowed by filters). */
export async function broadcastAnnouncement({ title, message, filters = {}, createdBy }) {
  const query = { role: 'alumni', approvalStatus: 'approved', accountStatus: 'active', ...filters };
  const broadcastId = new mongoose.Types.ObjectId();
  let batch = [];
  let count = 0;
  const flush = async () => {
    if (!batch.length) return;
    await Notification.insertMany(batch, { ordered: false });
    count += batch.length;
    batch = [];
  };
  for await (const u of User.find(query).select('_id').lean().cursor()) {
    batch.push({ recipient: u._id, audience: 'all_approved', broadcastId, type: 'announcement', title, message, createdBy });
    if (batch.length >= 1000) await flush();
  }
  await flush();
  return { broadcastId, recipients: count };
}

export async function listForUser(userId, { page, limit, unread }) {
  const filter = { recipient: userId, ...(unread === 'true' ? { isRead: false } : {}) };
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: userId, isRead: false }),
  ]);
  return { items, total, unreadCount };
}

export async function markRead(userId, id) {
  // The recipient is part of the filter: another user's id looks exactly like a missing one (404).
  const n = await Notification.findOneAndUpdate(
    { _id: id, recipient: userId },
    { $set: { isRead: true }, $currentDate: { readAt: true } },
    { new: true },
  );
  if (!n) throw new AppError(404, 'NOT_FOUND', 'Notification not found');
  return n;
}

export async function markAllRead(userId) {
  const r = await Notification.updateMany({ recipient: userId, isRead: false }, { $set: { isRead: true }, $currentDate: { readAt: true } });
  return r.modifiedCount;
}
