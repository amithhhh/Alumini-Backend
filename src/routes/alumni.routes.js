import { Router } from 'express';
import * as c from '../controllers/alumni.controller.js';
import { authenticate, requireApprovedAlumni } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { updateProfileSchema } from '../validators/common.js';
import { notificationListSchema, notificationIdParams, emptyBody } from '../validators/alumni.validators.js';

const r = Router();
r.use(authenticate);

// Available to any signed-in, non-suspended alumnus so pending/rejected users can see where they stand.
r.get('/status', c.getStatus);
r.get('/notifications', validate({ query: notificationListSchema }), c.listNotifications);
r.patch('/notifications/read-all', validate({ body: emptyBody }), c.markAllNotificationsRead);
r.patch('/notifications/:id/read', validate({ params: notificationIdParams, body: emptyBody }), c.markNotificationRead);

// Approved alumni only.
r.get('/profile', requireApprovedAlumni, c.getProfile);
r.patch('/profile', requireApprovedAlumni, validate({ body: updateProfileSchema }), c.updateProfile);
export default r;
