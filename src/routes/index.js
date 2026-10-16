import { Router } from 'express';
import mongoose from 'mongoose';
import authRoutes from './auth.routes.js';
import alumniRoutes from './alumni.routes.js';
import adminRoutes from './admin.routes.js';
import { PROGRAMS, WORKING_STATUSES, CATEGORIES } from '../constants.js';
import { isGoogleConfigured } from '../services/google.service.js';

const r = Router();
r.get('/health', (_req, res) => res.json({ data: { status: 'ok', db: mongoose.connection.readyState === 1 ? 'up' : 'down' } }));
r.get('/meta/options', (_req, res) =>
  res.json({ data: { programs: PROGRAMS, workingStatuses: WORKING_STATUSES, categories: CATEGORIES, googleEnabled: isGoogleConfigured() } }));
r.use('/auth', authRoutes);
r.use('/alumni', alumniRoutes);
r.use('/admin', adminRoutes);
export default r;
