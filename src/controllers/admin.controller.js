import { asyncHandler } from '../utils/asyncHandler.js';
import { AUDIT_ACTIONS } from '../constants.js';
import { AdminActivityLog } from '../models/AdminActivityLog.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { logAdminAction } from '../services/audit.service.js';
import * as alumni from '../services/alumni.service.js';
import { getDashboardStats } from '../services/stats.service.js';
import * as notifications from '../services/notification.service.js';
import * as exporter from '../services/export.service.js';

/** Audit write AFTER a committed state change must not turn a successful action into a 500; failures are logged loudly. */
const auditAfterChange = (req, entry) =>
  logAdminAction(req, entry).catch((e) => logger.error('AUDIT WRITE FAILED', { requestId: req.id, action: entry.action, error: e.message }));

export const stats = asyncHandler(async (req, res) => {
  res.json({ data: await getDashboardStats(req.query) });
});

export const listAlumni = asyncHandler(async (req, res) => {
  const { items, total, page, limit, totalPages } = await alumni.listAlumni(req.query);
  res.json({ data: items, meta: { page, limit, total, totalPages } });
});

export const getAlumni = asyncHandler(async (req, res) => {
  const { user, linkedProviders } = await alumni.getAlumni(req.params.id);
  res.json({ data: { user, linkedProviders } });
});

export const approve = asyncHandler(async (req, res) => {
  const user = await alumni.approveAlumni(req.params.id, req.user);
  await auditAfterChange(req, { action: AUDIT_ACTIONS.ALUMNI_APPROVE, resourceType: 'alumni', resourceId: user._id, details: { email: user.email } });
  res.json({ data: { user } });
});

export const reject = asyncHandler(async (req, res) => {
  const user = await alumni.rejectAlumni(req.params.id, req.user, req.body.reason);
  await auditAfterChange(req, { action: AUDIT_ACTIONS.ALUMNI_REJECT, resourceType: 'alumni', resourceId: user._id, details: { email: user.email, reason: req.body.reason } });
  res.json({ data: { user } });
});

export const setStatus = asyncHandler(async (req, res) => {
  const user = await alumni.setAccountStatus(req.params.id, req.user, req.body);
  await auditAfterChange(req, { action: AUDIT_ACTIONS.ALUMNI_STATUS_CHANGE, resourceType: 'alumni', resourceId: user._id, details: { accountStatus: user.accountStatus, reason: req.body.reason } });
  res.json({ data: { user } });
});

export const updateAlumniProfile = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'alumni' });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Alumni record not found');
  const changed = await alumni.applyProfileUpdate(user, req.body);
  await auditAfterChange(req, { action: AUDIT_ACTIONS.ALUMNI_PROFILE_UPDATE, resourceType: 'alumni', resourceId: user._id, details: { changedFields: changed } });
  res.json({ data: { user } });
});

export const sendNotification = asyncHandler(async (req, res) => {
  const { audience, title, message, type } = req.body;
  let result;
  if (audience === 'user') {
    const target = await User.findOne({ _id: req.body.userId, role: 'alumni' }).select('_id');
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Alumni record not found');
    await notifications.createNotification(target._id, { type, title, message, createdBy: req.user._id });
    result = { recipients: 1 };
  } else {
    result = await notifications.broadcastAnnouncement({ title, message, filters: req.body.filters, createdBy: req.user._id });
  }
  await auditAfterChange(req, {
    action: AUDIT_ACTIONS.NOTIFICATION_SEND, resourceType: 'notification', resourceId: result.broadcastId,
    details: { audience, type, title, recipients: result.recipients, filters: req.body.filters, userId: req.body.userId },
  });
  res.status(201).json({ data: { audience, recipients: result.recipients } });
});

export const activityLogs = asyncHandler(async (req, res) => {
  const { page, limit, action, adminId, resourceType, resourceId, from, to } = req.query;
  const filter = {
    ...(action ? { action } : {}), ...(adminId ? { adminId } : {}),
    ...(resourceType ? { resourceType } : {}), ...(resourceId ? { resourceId } : {}),
    ...(from || to ? { timestamp: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    AdminActivityLog.find(filter).sort({ timestamp: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('adminId', 'fullName email').lean(),
    AdminActivityLog.countDocuments(filter),
  ]);
  res.json({ data: items.map(({ _id, adminId, ...rest }) => ({ id: String(_id), admin: adminId, ...rest })), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

const exportHandler = (format) => asyncHandler(async (req, res) => {
  const job = await exporter.prepareExport(req.query);
  // Fail closed: if the audit entry can't be written, nothing is exported.
  await logAdminAction(req, {
    action: format === 'csv' ? AUDIT_ACTIONS.EXPORT_CSV : AUDIT_ACTIONS.EXPORT_EXCEL,
    resourceType: 'alumni_export',
    details: { preset: job.preset, filters: job.filters, rowCount: job.total },
  });
  const filename = exporter.exportFilename(job.preset, format === 'csv' ? 'csv' : 'xlsx');
  res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Export-Row-Count', String(job.total));
  await (format === 'csv' ? exporter.streamCsv(res, job) : exporter.streamExcel(res, job));
});

export const exportCsv = exportHandler('csv');
export const exportExcel = exportHandler('excel');
