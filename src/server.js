import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import './models/index.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDb();
  const server = createApp().listen(env.PORT, () => logger.info(`API listening on :${env.PORT}`, { env: env.NODE_ENV }));

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => { await disconnectDb(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  logger.error('Failed to start', { error: e.message });
  console.error(e);
  process.exit(1);
});
