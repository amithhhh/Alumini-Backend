import { User } from '../models/User.js';
import { ExternalIdentity } from '../models/ExternalIdentity.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { PROFILE_FIELDS } from '../constants.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { pick } from '../utils/strings.js';
import { logger } from '../utils/logger.js';
import { hashPassword, verifyPassword, burnPasswordCheck } from './password.service.js';
import { generateResetToken, hashToken } from './token.service.js';
import { verifyGoogleIdToken } from './google.service.js';
import { sendPasswordResetEmail } from './mail.service.js';
import { createNotification } from './notification.service.js';

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
const isDuplicateKey = (e) => e?.code === 11000;

/** "full" = normal access; "status-only" = may only see own status/notifications (pending/rejected). */
export const accessLevel = (user) => (user.role === 'admin' || user.approvalStatus === 'approved' ? 'full' : 'status-only');

function assertCanLogin(user) {
  if (user.accountStatus !== 'active') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Please contact the administrators.');
  }
}

async function touchLogin(user) {
  user.lastLoginAt = new Date();
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: user.lastLoginAt } });
}

export async function registerAlumni(input) {
  let google;
  if (input.googleIdToken) {
    google = await verifyGoogleIdToken(input.googleIdToken);
    if (google.email !== input.email) {
      throw new AppError(400, 'GOOGLE_EMAIL_MISMATCH', 'The registration email must match your verified Google email');
    }
    if (await ExternalIdentity.exists({ provider: 'google', subject: google.sub })) {
      throw new AppError(409, 'GOOGLE_ALREADY_LINKED', 'This Google account is already linked to a portal account');
    }
  }

  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  let user;
  try {
    user = await User.create({
      ...pick(input, PROFILE_FIELDS),
      email: input.email,
      passwordHash,
      // Server-controlled: nothing from the client can influence these.
      role: 'alumni',
      approvalStatus: 'pending',
      accountStatus: 'active',
      registeredAt: new Date(),
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists. Try signing in or resetting your password.');
    throw e;
  }

  if (google) {
    try {
      await ExternalIdentity.create({ userId: user._id, provider: 'google', subject: google.sub, email: google.email, emailVerified: true, name: google.name });
    } catch (e) {
      await User.deleteOne({ _id: user._id });
      if (isDuplicateKey(e)) throw new AppError(409, 'GOOGLE_ALREADY_LINKED', 'This Google account is already linked to a portal account');
      throw e;
    }
  }

  await createNotification(user._id, {
    type: 'account',
    title: 'Registration received',
    message: 'Thanks for registering. An administrator will review your details shortly.',
  }).catch((e) => logger.warn('welcome notification failed', { error: e.message }));
  return user;
}

export async function loginWithPassword({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash +tokenVersion');
  if (!user || !user.passwordHash) {
    await burnPasswordCheck(password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(user.passwordHash, password))) throw invalidCredentials();
  assertCanLogin(user);
  await touchLogin(user);
  return user;
}

export async function loginWithGoogle(idToken) {
  const g = await verifyGoogleIdToken(idToken);
  const identity = await ExternalIdentity.findOne({ provider: 'google', subject: g.sub });

  if (!identity) {
    // Never auto-link by email: that would let anyone controlling a matching Google address take over
    // an existing account (or skip approval). Linking needs an authenticated session + password.
    const existing = await User.exists({ email: g.email });
    if (existing) {
      throw new AppError(409, 'ACCOUNT_LINK_REQUIRED',
        'An account with this email already exists. Sign in with your password, then link Google from your account settings.');
    }
    throw new AppError(404, 'REGISTRATION_REQUIRED', 'No alumni account found for this Google account. Please register first.', {
      email: g.email, name: g.name,
    });
  }

  const user = await User.findById(identity.userId).select('+tokenVersion');
  if (!user) throw new AppError(404, 'REGISTRATION_REQUIRED', 'No alumni account found for this Google account. Please register first.');
  assertCanLogin(user);
  identity.lastLoginAt = new Date();
  await identity.save();
  await touchLogin(user);
  return user;
}

export async function linkGoogle(user, { idToken, currentPassword }) {
  const withHash = await User.findById(user._id).select('+passwordHash');
  if (!withHash?.passwordHash || !(await verifyPassword(withHash.passwordHash, currentPassword))) {
    throw new AppError(403, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
  }
  const g = await verifyGoogleIdToken(idToken);
  try {
    await ExternalIdentity.create({ userId: user._id, provider: 'google', subject: g.sub, email: g.email, emailVerified: true, name: g.name });
  } catch (e) {
    if (isDuplicateKey(e)) throw new AppError(409, 'GOOGLE_ALREADY_LINKED', 'This Google account (or this user) already has a Google link');
    throw e;
  }
}

export async function linkedProviders(userId) {
  return (await ExternalIdentity.find({ userId }).select('provider').lean()).map((i) => i.provider);
}

/** Always resolves; callers return the same generic response whether or not the email exists. */
export async function requestPasswordReset(email) {
  const user = await User.findOne({ email });
  if (!user || user.accountStatus !== 'active') return;
  await PasswordResetToken.deleteMany({ userId: user._id, usedAt: { $exists: false } }); // only the newest link works
  const { raw, hash } = generateResetToken();
  await PasswordResetToken.create({ userId: user._id, tokenHash: hash, expiresAt: new Date(Date.now() + env.RESET_TOKEN_TTL_MINUTES * 60 * 1000) });
  const url = new URL(env.PASSWORD_RESET_URL);
  url.searchParams.set('token', raw);
  // Not awaited: response time must not reveal whether the account exists.
  sendPasswordResetEmail({ to: user.email, name: user.fullName, resetUrl: url.toString() })
    .catch((e) => logger.error('password reset email failed', { error: e.message }));
}

export async function resetPassword({ token, password }) {
  // Atomic claim => single use even under concurrent requests.
  const record = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: hashToken(token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  if (!record) throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'This reset link is invalid or has expired');
  const passwordHash = await hashPassword(password);
  // $inc tokenVersion revokes every existing session for this user.
  await User.updateOne({ _id: record.userId }, { $set: { passwordHash }, $inc: { tokenVersion: 1 } });
  await PasswordResetToken.updateMany({ userId: record.userId, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash +tokenVersion');
  if (user.passwordHash) {
    if (!currentPassword || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    }
    if (currentPassword === newPassword) throw new AppError(400, 'PASSWORD_UNCHANGED', 'New password must differ from the current one');
  }
  user.passwordHash = await hashPassword(newPassword);
  user.tokenVersion += 1; // signs out every other session
  await user.save();
  return user;
}
