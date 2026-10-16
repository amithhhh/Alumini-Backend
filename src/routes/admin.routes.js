import { Router } from 'express';
import * as c from '../controllers/admin.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParams, updateProfileSchema } from '../validators/common.js';
import {
  listQuerySchema, exportQuerySchema, rejectSchema, statusSchema, statsQuerySchema, sendNotificationSchema, logsQuerySchema,
} from '../validators/admin.validators.js';
import { emptyBody } from '../validators/alumni.validators.js';

const r = Router();
r.use(authenticate, requireAdmin); // every admin route: valid session + admin role + active account, checked against the DB

r.get('/dashboard/stats', validate({ query: statsQuerySchema }), c.stats);
r.get('/alumni', validate({ query: listQuerySchema }), c.listAlumni);
r.get('/alumni/:id', validate({ params: idParams }), c.getAlumni);
r.patch('/alumni/:id', validate({ params: idParams, body: updateProfileSchema }), c.updateAlumniProfile);
r.patch('/alumni/:id/approve', validate({ params: idParams, body: emptyBody }), c.approve);
r.patch('/alumni/:id/reject', validate({ params: idParams, body: rejectSchema }), c.reject);
r.patch('/alumni/:id/status', validate({ params: idParams, body: statusSchema }), c.setStatus);
r.get('/exports/csv', validate({ query: exportQuerySchema }), c.exportCsv);
r.get('/exports/excel', validate({ query: exportQuerySchema }), c.exportExcel);
r.post('/notifications', validate({ body: sendNotificationSchema }), c.sendNotification);
r.get('/activity-logs', validate({ query: logsQuerySchema }), c.activityLogs);
export default r;
