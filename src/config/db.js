import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  // Build indexes (notably the unique ones) before we accept traffic.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  logger.info('MongoDB connected', { db: mongoose.connection.name });
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
