import { z } from 'zod';
import { emailSchema, passwordSchema } from './common.js';

const idToken = z.string().min(20).max(4096);

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
export const googleSchema = z.object({ idToken }).strict();
export const googleLinkSchema = z.object({ idToken, currentPassword: z.string().min(1).max(128) }).strict();
export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();
export const resetPasswordSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid token'), password: passwordSchema })
  .strict();
export const changePasswordSchema = z
  .object({ currentPassword: z.string().max(128).optional(), newPassword: passwordSchema })
  .strict();
