import { z } from 'zod';
import {
  PROGRAMS, WORKING_STATUSES, CATEGORIES, APPROVAL_STATUSES, ACCOUNT_STATUSES, NOTIFICATION_TYPES,
} from '../constants.js';
import { objectId } from './common.js';

const numeric = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);
const year = z.preprocess(numeric, z.number().int().min(1970).max(2100));
const emptyToUndef = (s) => z.preprocess((v) => (v === '' ? undefined : v), s.optional());

export const SORT_FIELDS = ['registeredAt', 'fullName', 'email', 'academicYearStart', 'academicYearEnd', 'program', 'approvalStatus', 'category', 'workingStatus'];

/** Filters shared by the alumni listing and the exports. */
export const filterShape = {
  search: emptyToUndef(z.string().trim().max(100)),
  academicYearStart: emptyToUndef(year),
  academicYearEnd: emptyToUndef(year),
  program: emptyToUndef(z.enum(PROGRAMS)),
  category: emptyToUndef(z.enum(CATEGORIES)),
  workingStatus: emptyToUndef(z.enum(WORKING_STATUSES)),
  approvalStatus: emptyToUndef(z.enum(APPROVAL_STATUSES)),
  accountStatus: emptyToUndef(z.enum(ACCOUNT_STATUSES)),
  sortBy: z.enum(SORT_FIELDS).default('registeredAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
};

export const listQuerySchema = z
  .object({
    ...filterShape,
    page: z.preprocess(numeric, z.number().int().min(1).max(100000).default(1)),
    limit: z.preprocess(numeric, z.number().int().min(1).max(100).default(20)),
  })
  .strict();

export const PRESETS = ['filtered', 'all', 'approved', 'pending', 'rejected', 'indian', 'nri'];
export const exportQuerySchema = z
  .object({ ...filterShape, preset: z.enum(PRESETS).default('filtered') })
  .strict();

export const rejectSchema = z.object({ reason: z.string().trim().min(5, 'A rejection reason of at least 5 characters is required').max(1000) }).strict();
export const statusSchema = z
  .object({ accountStatus: z.enum(ACCOUNT_STATUSES), reason: z.string().trim().min(3).max(1000).optional() })
  .strict()
  .refine((d) => d.accountStatus !== 'suspended' || d.reason, { path: ['reason'], message: 'A reason is required when suspending an account' });

export const statsQuerySchema = z.object({ months: z.preprocess(numeric, z.number().int().min(1).max(36).default(12)) }).strict();

export const sendNotificationSchema = z.discriminatedUnion('audience', [
  z.object({
    audience: z.literal('user'),
    userId: objectId,
    type: z.enum(NOTIFICATION_TYPES).default('account'),
    title: z.string().trim().min(1).max(150),
    message: z.string().trim().min(1).max(2000),
  }).strict(),
  z.object({
    audience: z.literal('all_approved'),
    filters: z.object({
      program: z.enum(PROGRAMS).optional(),
      category: z.enum(CATEGORIES).optional(),
      workingStatus: z.enum(WORKING_STATUSES).optional(),
      academicYearEnd: year.optional(),
    }).strict().optional(),
    type: z.literal('announcement').default('announcement'),
    title: z.string().trim().min(1).max(150),
    message: z.string().trim().min(1).max(2000),
  }).strict(),
]);

export const logsQuerySchema = z
  .object({
    page: z.preprocess(numeric, z.number().int().min(1).max(100000).default(1)),
    limit: z.preprocess(numeric, z.number().int().min(1).max(100).default(25)),
    action: emptyToUndef(z.string().trim().max(60)),
    adminId: emptyToUndef(objectId),
    resourceType: emptyToUndef(z.string().trim().max(40)),
    resourceId: emptyToUndef(z.string().trim().max(60)),
    from: emptyToUndef(z.coerce.date()),
    to: emptyToUndef(z.coerce.date()),
  })
  .strict();
