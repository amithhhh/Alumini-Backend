/**
 * Neutralise spreadsheet formula injection (OWASP "CSV Injection").
 * Any text cell beginning with = + - @ TAB or CR is prefixed with a single quote so
 * Excel/Sheets/LibreOffice treat it as text. International phone prefixes ("+91") are
 * the one safe exception because they consist solely of "+" and digits.
 */
const DANGEROUS_START = /^[=+\-@\t\r]/;
const PLAIN_PHONE = /^\+\d{1,15}$/;

export function sanitizeCell(value, { allowPhone = false } = {}) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value;
  const s = String(value);
  if (allowPhone && PLAIN_PHONE.test(s)) return s;
  return DANGEROUS_START.test(s) ? `'${s}` : s;
}
