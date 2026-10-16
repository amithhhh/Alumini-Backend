import { asyncHandler } from '../utils/asyncHandler.js';
import { CSRF_COOKIE } from '../constants.js';
import { setSessionCookie, clearSessionCookie, setCsrfCookie } from '../utils/cookies.js';
import { signSession, generateCsrfToken, isValidCsrfToken } from '../services/token.service.js';
import * as auth from '../services/auth.service.js';

const startSession = (res, user) => setSessionCookie(res, signSession(user));
const sessionBody = (user) => ({ user, access: auth.accessLevel(user) });

export const csrf = (req, res) => {
  const existing = req.cookies?.[CSRF_COOKIE];
  const token = isValidCsrfToken(existing) ? existing : generateCsrfToken();
  setCsrfCookie(res, token);
  res.json({ data: { csrfToken: token } });
};

export const register = asyncHandler(async (req, res) => {
  const user = await auth.registerAlumni(req.body);
  res.status(201).json({
    data: { user, message: 'Registration received. You will be able to access the portal once an administrator approves your account.' },
  });
});

export const login = asyncHandler(async (req, res) => {
  const user = await auth.loginWithPassword(req.body);
  startSession(res, user);
  res.json({ data: sessionBody(user) });
});

export const google = asyncHandler(async (req, res) => {
  const user = await auth.loginWithGoogle(req.body.idToken);
  startSession(res, user);
  res.json({ data: sessionBody(user) });
});

export const linkGoogle = asyncHandler(async (req, res) => {
  await auth.linkGoogle(req.user, req.body);
  res.json({ data: { linkedProviders: await auth.linkedProviders(req.user._id) } });
});

export const logout = (_req, res) => {
  clearSessionCookie(res);
  res.json({ data: { message: 'Signed out' } });
};

export const me = asyncHandler(async (req, res) => {
  res.json({ data: { ...sessionBody(req.user), linkedProviders: await auth.linkedProviders(req.user._id) } });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await auth.requestPasswordReset(req.body.email);
  res.json({ data: { message: 'If an account exists for that email, a password reset link has been sent.' } });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await auth.resetPassword(req.body);
  res.json({ data: { message: 'Password updated. Please sign in with your new password.' } });
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await auth.changePassword(req.user._id, req.body);
  startSession(res, user); // old sessions are revoked; keep this one signed in
  res.json({ data: { message: 'Password changed. Other devices have been signed out.' } });
});
