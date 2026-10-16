import { z } from 'zod';
import { objectId } from './common.js';

const numeric = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);

export const notificationListSchema = z
  .object({
    page: z.preprocess(numeric, z.number().int().min(1).max(100000).default(1)),
    limit: z.preprocess(numeric, z.number().int().min(1).max(100).default(20)),
    unread: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const notificationIdParams = z.object({ id: objectId }).strict();
export const emptyBody = z.object({}).strict();
