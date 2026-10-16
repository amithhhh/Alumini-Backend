import { AdminActivityLog } from '../models/AdminActivityLog.js';

const SECRET_KEY = /pass(word)?|token|secret|hash|cookie|authorization|credential/i;

/** Recursively drops anything that looks like a secret and truncates long strings. */
export function sanitizeDetails(value, depth = 0) {
  if (value === null || value === undefined || depth > 5) return undefined;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeDetails(v, depth + 1));
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([k]) => !SECRET_KEY.test(k)).map(([k, v]) => [k, sanitizeDetails(v, depth + 1)]),
    );
  }
  return typeof value === 'string' ? value.slice(0, 500) : value;
}

export async function logAdminAction(req, { action, resourceType, resourceId, details }) {
  return AdminActivityLog.create({
    adminId: req.user._id,
    action,
    resourceType,
    resourceId: resourceId ? String(resourceId) : undefined,
    details: sanitizeDetails(details),
    requestId: req.id,
  });
}
