import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests opt in explicitly so they are not throttled.
    skip: () => env.isTest && !process.env.ENABLE_RATE_LIMIT_IN_TEST,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
  });

const MIN = 60 * 1000;
export const apiLimiter = make(15 * MIN, 600, 'Too many requests, please try again later');
export const authLimiter = make(15 * MIN, 20, 'Too many attempts, please try again later');
export const forgotPasswordLimiter = make(60 * MIN, 5, 'Too many password reset requests, please try again later');
export const resetPasswordLimiter = make(15 * MIN, 10, 'Too many attempts, please try again later');
