import { Router } from 'express';
import * as c from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, forgotPasswordLimiter, resetPasswordLimiter } from '../middleware/rateLimit.js';
import { registerSchema } from '../validators/common.js';
import {
  loginSchema, googleSchema, googleLinkSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema,
} from '../validators/auth.validators.js';

const r = Router();
r.get('/csrf', c.csrf);
r.post('/register', authLimiter, validate({ body: registerSchema }), c.register);
r.post('/login', authLimiter, validate({ body: loginSchema }), c.login);
r.post('/logout', c.logout);
r.get('/me', authenticate, c.me);
r.post('/google', authLimiter, validate({ body: googleSchema }), c.google);
r.post('/google/link', authLimiter, authenticate, validate({ body: googleLinkSchema }), c.linkGoogle);
r.post('/forgot-password', forgotPasswordLimiter, validate({ body: forgotPasswordSchema }), c.forgotPassword);
r.post('/reset-password', resetPasswordLimiter, validate({ body: resetPasswordSchema }), c.resetPassword);
r.post('/change-password', authenticate, validate({ body: changePasswordSchema }), c.changePassword);
export default r;
