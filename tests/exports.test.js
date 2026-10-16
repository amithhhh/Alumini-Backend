import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { connectTestDb, clearDb, closeTestDb } from './helpers/db.js';
import { createClient } from './helpers/client.js';
import { createAlumnus, createAdmin, PASSWORD } from './helpers/fixtures.js';
import { AdminActivityLog } from '../src/models/AdminActivityLog.js';
import { sanitizeCell } from '../src/utils/spreadsheet.js';

beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(clearDb);

const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

async function adminClient() {
  const admin = await createAdmin();
  const c = await createClient();
  await c.login('admin@example.com', PASSWORD);
  return { admin, c };
}
async function seed() {
  await createAlumnus({ fullName: 'Anita Nair', email: 'anita@example.com', category: 'indian', approvalStatus: 'approved', program: 'PGDDSA — Data Science' });
  await createAlumnus({ fullName: 'Bilal Khan', email: 'bilal@example.com', category: 'nri', approvalStatus: 'pending' });
  await createAlumnus({ fullName: '=HYPERLINK("http://evil.example","click")', email: 'evil@example.com', category: 'nri', approvalStatus: 'approved', companyName: '@SUM(A1:A9)' });
}

describe('sanitizeCell', () => {
  it('neutralises formula starters but keeps phone prefixes and non-strings', () => {
    expect(sanitizeCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(sanitizeCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCell('@SUM(1)')).toBe("'@SUM(1)");
    expect(sanitizeCell('\tfoo')).toBe("'\tfoo");
    expect(sanitizeCell('normal')).toBe('normal');
    expect(sanitizeCell('+91', { allowPhone: true })).toBe('+91');
    expect(sanitizeCell('+1+1', { allowPhone: true })).toBe("'+1+1");
    expect(sanitizeCell(2020)).toBe(2020);
    expect(sanitizeCell(null)).toBe('');
  });
});

describe('CSV export', () => {
  it('requires an administrator', async () => {
    const anon = await createClient();
    expect((await anon.get('/api/admin/exports/csv')).status).toBe(401);
    const a = await createAlumnus({ email: 'plain@example.com' });
    const c = await createClient();
    await c.login(a.email, PASSWORD);
    expect((await c.get('/api/admin/exports/csv')).status).toBe(403);
    expect((await c.get('/api/admin/exports/excel')).status).toBe(403);
  });

  it('exports permitted fields only, with download headers, injection protection and an audit entry', async () => {
    const { admin, c } = await adminClient();
    await seed();
    const res = await c.get('/api/admin/exports/csv?preset=all');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="alumni-all-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers['cache-control']).toBe('no-store');
    const text = res.text;
    const lines = text.replace(/^\ufeff/, '').trim().split('\n');
    expect(lines).toHaveLength(4); // header + 3
    expect(lines[0]).toContain('Full Name');
    expect(text).not.toMatch(/passwordHash|argon2|tokenVersion|reset|session/i);
    expect(text).toContain("\"'=HYPERLINK(");            // formula neutralised
    expect(text).toContain("'@SUM(A1:A9)");
    expect(text).toContain('+91');                          // phone prefix preserved
    expect(text).toContain('PGDDSA — Data Science');        // UTF-8 preserved

    const log = await AdminActivityLog.findOne({ action: 'export.csv' });
    expect(String(log.adminId)).toBe(String(admin._id));
    expect(log.details).toMatchObject({ preset: 'all', rowCount: 3 });
  });

  it('presets and listing filters apply identically to the export', async () => {
    const { c } = await adminClient();
    await seed();
    const rows = async (qs) => (await c.get(`/api/admin/exports/csv?${qs}`)).text.replace(/^\ufeff/, '').trim().split('\n').length - 1;
    expect(await rows('preset=approved')).toBe(2);
    expect(await rows('preset=pending')).toBe(1);
    expect(await rows('preset=rejected')).toBe(0);
    expect(await rows('preset=indian')).toBe(1);
    expect(await rows('preset=nri')).toBe(2);
    expect(await rows('preset=filtered&category=nri&approvalStatus=approved')).toBe(1);
    expect(await rows('search=anita')).toBe(1);
    const conflict = await c.get('/api/admin/exports/csv?preset=indian&category=nri');
    expect(conflict.status).toBe(400);
    expect(conflict.body.error.code).toBe('CONFLICTING_FILTER');
    expect((await c.get('/api/admin/exports/csv?preset=bogus')).status).toBe(400);
  });
});

describe('Excel export', () => {
  it('produces a valid .xlsx with the same data, safe cells, headers and audit entry', async () => {
    const { c } = await adminClient();
    await seed();
    const res = await c.agent.get('/api/admin/exports/excel?preset=approved').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/alumni-approved-\d{4}-\d{2}-\d{2}\.xlsx/);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.getWorksheet('Alumni');
    expect(ws.rowCount).toBe(3); // header + 2 approved
    const headers = ws.getRow(1).values.slice(1);
    expect(headers).toContain('Full Name');
    expect(headers.join(' ')).not.toMatch(/password|hash|token/i);
    const names = [2, 3].map((r) => String(ws.getRow(r).getCell(1).value));
    expect(names).toContain('Anita Nair');
    expect(names.some((n) => n.startsWith("'=HYPERLINK"))).toBe(true);
    for (const r of [2, 3]) expect(typeof ws.getRow(r).getCell(1).value).toBe('string'); // never a formula object

    expect(await AdminActivityLog.countDocuments({ action: 'export.excel' })).toBe(1);
  });
});
