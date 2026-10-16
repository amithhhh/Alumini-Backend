const silent = process.env.NODE_ENV === 'test';
const write = (level, msg, meta) => {
  if (silent) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...meta });
  (level === 'error' ? console.error : console.log)(line);
};
export const logger = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
