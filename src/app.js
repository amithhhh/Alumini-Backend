import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { requestId } from './middleware/requestId.js';
import { noSqlGuard } from './middleware/noSqlGuard.js';
import { csrfProtection } from './middleware/csrf.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  app.set('query parser', 'simple'); // flat query strings only: no ?a[$ne]=x nested objects

  app.use(requestId);
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => logger.info('request', { id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }));
    next();
  });
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || env.allowedOrigins.includes(origin.replace(/\/$/, ''))),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', apiLimiter);
  app.use('/api', noSqlGuard);
  app.use('/api', csrfProtection);
  app.use('/api', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
