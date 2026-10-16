import { User } from '../models/User.js';
import { ExternalIdentity } from '../models/ExternalIdentity.js';
import { COMPANY_REQUIRED_STATUSES, PROFILE_FIELDS } from '../constants.js';
import { AppError } from '../utils/AppError.js';
import { escapeRegex } from '../utils/strings.js';
import { academicYearIssue } from '../validators/common.js';
import { createNotification } from './notification.service.js';

/** Single source of truth for alumni filtering; used by the listing AND the exports. */
export function buildAlumniFilter(f = {}) {
  const q = { role: 'alumni' };
  if (f.approvalStatus) q.approvalStatus = f.approvalStatus;
  if (f.accountStatus) q.accountStatus = f.accountStatus;
  if (f.program) q.program = f.program;
  if (f.category) q.category = f.category;
  if (f.workingStatus) q.workingStatus = f.workingStatus;
  if (f.academicYearStart) q.academicYearStart = f.academicYearStart;
  if (f.academicYearEnd) q.academicYearEnd = f.academicYearEnd;
  if (f.search) {
    const rx = new RegExp(escapeRegex(f.search), 'i'); // escaped: user input is never a regex
    q.$or = [{ fullName: rx }, { email: rx }];
  }
  return q;
}

export const buildSort = ({ sortBy = 'registeredAt', sortOrder = 'desc' } = {}) => ({
  [sortBy]: sortOrder === 'asc' ? 1 : -1,
  _id: 1, // deterministic pagination
});

export async function listAlumni(query) {
  const filter = buildAlumniFilter(query);
  const { page, limit } = query;
  const [items, total] = await Promise.all([
    User.find(filter).sort(buildSort(query)).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getAlumni(id) {
  const user = await User.findOne({ _id: id, role: 'alumni' })
    .populate('approvedBy rejectedBy statusChangedBy', 'fullName email');
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Alumni record not found');
  const providers = (await ExternalIdentity.find({ userId: id }).select('provider').lean()).map((i) => i.provider);
  return { user, linkedProviders: providers };
}

async function notFoundOrInvalid(id, message) {
  const exists = await User.exists({ _id: id, role: 'alumni' });
  return exists ? new AppError(409, 'INVALID_STATE', message) : new AppError(404, 'NOT_FOUND', 'Alumni record not found');
}

/**
 * Atomic state transition: the expected current state is part of the update filter, so of any number of
 * concurrent requests exactly one matches (matchedCount === 1). Works on any MongoDB-compatible server.
 */
async function transition(filter, update, id, invalidMessage) {
  const r = await User.updateOne(filter, update);
  if (r.matchedCount !== 1) throw await notFoundOrInvalid(id, invalidMessage);
  return User.findById(id);
}

/** Atomic: the state check and the update are one findOneAndUpdate, so double-clicks/races can't double-apply. */
export async function approveAlumni(id, admin) {
  const user = await transition(
    { _id: id, role: 'alumni', approvalStatus: { $in: ['pending', 'rejected'] } },
    {
      $set: { approvalStatus: 'approved', approvedAt: new Date(), approvedBy: admin._id },
      $unset: { rejectionReason: '', rejectedAt: '', rejectedBy: '' },
    },
    id, 'Only pending or rejected registrations can be approved',
  );
  await createNotification(user._id, {
    type: 'approval', title: 'Registration approved',
    message: 'Your alumni registration has been approved. Welcome to the portal!', createdBy: admin._id,
  });
  return user;
}

export async function rejectAlumni(id, admin, reason) {
  const user = await transition(
    { _id: id, role: 'alumni', approvalStatus: 'pending' },
    {
      $set: { approvalStatus: 'rejected', rejectedAt: new Date(), rejectedBy: admin._id, rejectionReason: reason },
      $unset: { approvedAt: '', approvedBy: '' },
    },
    id, 'Only pending registrations can be rejected (suspend approved accounts instead)',
  );
  await createNotification(user._id, {
    type: 'rejection', title: 'Registration not approved',
    message: `Your alumni registration was not approved. Reason: ${reason}`, createdBy: admin._id,
  });
  return user;
}

export async function setAccountStatus(id, admin, { accountStatus, reason }) {
  const suspend = accountStatus === 'suspended';
  const user = await transition(
    { _id: id, role: 'alumni', accountStatus: { $ne: accountStatus } },
    {
      $set: { accountStatus, statusChangedAt: new Date(), statusChangedBy: admin._id, ...(reason ? { statusReason: reason } : {}) },
      ...(suspend ? { $inc: { tokenVersion: 1 } } : {}), // kill live sessions immediately
    },
    id, `Account is already ${accountStatus}`,
  );
  await createNotification(user._id, {
    type: 'account',
    title: suspend ? 'Account suspended' : 'Account reactivated',
    message: suspend ? `Your account has been suspended. ${reason ?? ''}`.trim() : 'Your account has been reactivated.',
    createdBy: admin._id,
  });
  return user;
}

/** Shared by self-service and admin edits. `patch` has already passed the strict zod schema. */
export async function applyProfileUpdate(user, patch) {
  const changed = [];
  for (const key of PROFILE_FIELDS) { // allow-list again: protects against mass assignment
    if (patch[key] === undefined) continue;
    user.set(key, patch[key] === null ? undefined : patch[key]);
    changed.push(key);
  }
  if (COMPANY_REQUIRED_STATUSES.includes(user.workingStatus) && !user.companyName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', [
      { in: 'body', path: 'companyName', message: `Company name is required for ${user.workingStatus} alumni` },
    ]);
  }
  const yearIssue = academicYearIssue(user.academicYearStart, user.academicYearEnd);
  if (yearIssue) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', [{ in: 'body', path: 'academicYearEnd', message: yearIssue }]);
  }
  await user.save();
  return changed;
}
