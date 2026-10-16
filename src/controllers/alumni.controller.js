import { asyncHandler } from '../utils/asyncHandler.js';
import { applyProfileUpdate } from '../services/alumni.service.js';
import * as notifications from '../services/notification.service.js';

export const getProfile = (req, res) => res.json({ data: { user: req.user } });

export const updateProfile = asyncHandler(async (req, res) => {
  await applyProfileUpdate(req.user, req.body); // acts on req.user only: no id parameter exists to tamper with
  res.json({ data: { user: req.user } });
});

export const getStatus = (req, res) => {
  const u = req.user;
  res.json({
    data: {
      role: u.role,
      approvalStatus: u.approvalStatus,
      accountStatus: u.accountStatus,
      rejectionReason: u.approvalStatus === 'rejected' ? u.rejectionReason : undefined,
      registeredAt: u.registeredAt,
      approvedAt: u.approvedAt,
      rejectedAt: u.rejectedAt,
    },
  });
};

export const listNotifications = asyncHandler(async (req, res) => {
  const { items, total, unreadCount } = await notifications.listForUser(req.user._id, req.query);
  const { page, limit } = req.query;
  res.json({ data: items, meta: { page, limit, total, totalPages: Math.ceil(total / limit), unreadCount } });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  res.json({ data: await notifications.markRead(req.user._id, req.params.id) });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  res.json({ data: { updated: await notifications.markAllRead(req.user._id) } });
});
