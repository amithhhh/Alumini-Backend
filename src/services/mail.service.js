import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let transport;
function getTransport() {
  if (transport) return transport;
  if (env.SMTP_HOST) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.smtpSecure,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  } else {
    // No SMTP configured: never crash. Messages are rendered but not delivered.
    transport = nodemailer.createTransport({ jsonTransport: true });
    logger.warn('SMTP_HOST not set: emails are not delivered (development fallback)');
  }
  return transport;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const minutes = env.RESET_TOKEN_TTL_MINUTES;
  const info = await getTransport().sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: 'Reset your Alumni Portal password',
    text: `Hello ${name},\n\nUse the link below to choose a new password. It expires in ${minutes} minutes and can be used once.\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email; your password will not change.`,
    html: `<p>Hello ${esc(name)},</p><p>Use the link below to choose a new password. It expires in ${minutes} minutes and can be used once.</p><p><a href="${esc(resetUrl)}">Reset password</a></p><p>If you did not request this, you can ignore this email; your password will not change.</p>`,
  });
  if (!env.SMTP_HOST && !env.isProd && !env.isTest) logger.info('DEV email (not delivered)', { to, resetUrl });
  return info;
}
