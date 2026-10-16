import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { stringify } from 'csv-stringify';
import ExcelJS from 'exceljs';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { sanitizeCell } from '../utils/spreadsheet.js';
import { buildAlumniFilter, buildSort } from './alumni.service.js';

// Explicit allow-list of exported fields. Hashes, tokens, session data and internal ids are never selectable.
export const EXPORT_COLUMNS = [
  { key: 'fullName', header: 'Full Name', width: 28 },
  { key: 'email', header: 'Email', width: 32 },
  { key: 'phoneCountryCode', header: 'Phone Country Code', width: 12, phone: true },
  { key: 'phoneNumber', header: 'Phone Number', width: 16 },
  { key: 'category', header: 'Category', width: 10 },
  { key: 'academicYearStart', header: 'Academic Year Start', width: 12 },
  { key: 'academicYearEnd', header: 'Academic Year End', width: 12 },
  { key: 'program', header: 'Program', width: 26 },
  { key: 'workingStatus', header: 'Working Status', width: 16 },
  { key: 'companyName', header: 'Company', width: 26 },
  { key: 'companyWebsite', header: 'Company Website', width: 30 },
  { key: 'linkedinUrl', header: 'LinkedIn', width: 34 },
  { key: 'approvalStatus', header: 'Approval Status', width: 14 },
  { key: 'accountStatus', header: 'Account Status', width: 14 },
  { key: 'rejectionReason', header: 'Rejection Reason', width: 30 },
  { key: 'registeredAt', header: 'Registered At', width: 22, date: true },
  { key: 'approvedAt', header: 'Approved At', width: 22, date: true },
  { key: 'rejectedAt', header: 'Rejected At', width: 22, date: true },
  { key: 'lastLoginAt', header: 'Last Login At', width: 22, date: true },
];
const PROJECTION = Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.key, 1]));

const PRESET_FILTERS = {
  all: {}, filtered: {},
  approved: { approvalStatus: 'approved' }, pending: { approvalStatus: 'pending' }, rejected: { approvalStatus: 'rejected' },
  indian: { category: 'indian' }, nri: { category: 'nri' },
};

/** Merges a preset into the validated filters; a preset that contradicts an explicit filter is a client error. */
export function resolveExportFilters({ preset = 'filtered', ...filters }) {
  const merged = { ...filters };
  for (const [k, v] of Object.entries(PRESET_FILTERS[preset] ?? {})) {
    if (merged[k] && merged[k] !== v) {
      throw new AppError(400, 'CONFLICTING_FILTER', `preset "${preset}" conflicts with ${k}=${merged[k]}`);
    }
    merged[k] = v;
  }
  return merged;
}

export async function prepareExport(query) {
  const filters = resolveExportFilters(query);
  const mongoFilter = buildAlumniFilter(filters);
  const total = await User.countDocuments(mongoFilter);
  if (total > env.EXPORT_MAX_ROWS) {
    throw new AppError(413, 'EXPORT_TOO_LARGE', `Export would contain ${total} rows (limit ${env.EXPORT_MAX_ROWS}). Narrow the filters.`);
  }
  const cursor = () => User.find(mongoFilter, PROJECTION).sort(buildSort(query)).lean().cursor();
  return { filters, total, cursor, preset: query.preset ?? 'filtered' };
}

const toRow = (doc, { forCsv }) =>
  Object.fromEntries(EXPORT_COLUMNS.map((c) => {
    const v = doc[c.key];
    if (c.date) return [c.key, v ? (forCsv ? new Date(v).toISOString() : new Date(v)) : ''];
    return [c.key, sanitizeCell(v, { allowPhone: c.phone })];
  }));

export const exportFilename = (preset, ext) => `alumni-${preset}-${new Date().toISOString().slice(0, 10)}.${ext}`;

export async function streamCsv(res, { cursor }) {
  async function* rows() {
    for await (const doc of cursor()) yield toRow(doc, { forCsv: true });
  }
  res.write('\ufeff'); // BOM so Excel opens UTF-8 (e.g. "—" in program names) correctly
  await pipeline(
    Readable.from(rows()),
    stringify({ header: true, columns: EXPORT_COLUMNS.map((c) => ({ key: c.key, header: c.header })) }),
    res,
  );
}

export async function streamExcel(res, { cursor }) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  wb.creator = 'Alumni Portal';
  const ws = wb.addWorksheet('Alumni', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width, ...(c.date ? { style: { numFmt: 'yyyy-mm-dd hh:mm' } } : {}) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).commit();
  for await (const doc of cursor()) ws.addRow(toRow(doc, { forCsv: false })).commit();
  await ws.commit();
  await wb.commit();
}
