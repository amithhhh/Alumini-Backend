import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { SESSION_COOKIE } from '../constants.js';
import { verifySession } from '../services/token.service.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

/**
 * Authenticates the request from the HTTP-only session cookie and re-loads the user from MongoDB on
 * EVERY request. Role, approvalStatus and accountStatus are therefore always current: an approval
 * rejection, suspension or password change takes effect immediately (tokenVersion revocation).
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw unauthenticated();
  let payload;
  try {
    payload = verifySession(token);
  } catch {
    throw unauthenticated();
  }
  if (!mongoose.isValidObjectId(payload.sub)) throw unauthenticated();
  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || user.tokenVersion !== payload.tv) throw unauthenticated();
  if (user.accountStatus !== 'active') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Please contact the administrators.');
  }
  req.user = user;
  next();
});

export function requireAdmin(req, _res, next) {
  const u = req.user;
  if (!u || u.role !== 'admin' || u.accountStatus !== 'active') {
    return next(new AppError(403, 'FORBIDDEN', 'Administrator access required'));
  }
  return next();
}

export function requireApprovedAlumni(req, _res, next) {
  const u = req.user;
  if (!u || u.role !== 'alumni') return next(new AppError(403, 'FORBIDDEN', 'Alumni access required'));
  if (u.approvalStatus === 'pending') {
    return next(new AppError(403, 'ACCOUNT_PENDING', 'Your registration is awaiting administrator approval', { approvalStatus: 'pending' }));
  }
  if (u.approvalStatus === 'rejected') {
    return next(new AppError(403, 'ACCOUNT_REJECTED', 'Your registration was not approved', { approvalStatus: 'rejected' }));
  }
  return next();
}
