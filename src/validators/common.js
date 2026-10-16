import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { PROGRAMS, WORKING_STATUSES, CATEGORIES, COMPANY_REQUIRED_STATUSES } from '../constants.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const idParams = z.object({ id: objectId }).strict();

export const emailSchema = z.string({ required_error: 'Email is required' }).trim().toLowerCase().max(254).email('Invalid email address');

export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number');

const emptyToUndef = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());
const emptyToNull = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable().optional());

const urlField = (label, hostOk) =>
  z.string().trim().max(300).transform((raw, ctx) => {
    let u;
    try {
      u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      ctx.addIssue({ code: 'custom', message: `Invalid ${label}` });
      return z.NEVER;
    }
    const bad =
      !['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.hostname.includes('.') ||
      (hostOk && !hostOk(u.hostname.toLowerCase()));
    if (bad) {
      ctx.addIssue({ code: 'custom', message: `Invalid ${label}` });
      return z.NEVER;
    }
    return u.toString();
  });

const websiteUrl = urlField('website URL');
const linkedinUrl = urlField('LinkedIn URL', (h) => h === 'linkedin.com' || h.endsWith('.linkedin.com'));

const nameField = z.string({ required_error: 'Full name is required' }).trim().min(2, 'Full name is too short').max(100);
const companyField = z.string().trim().min(1).max(150);

export const phoneCountryCodeSchema = z
  .string({ required_error: 'Phone country code is required' })
  .trim()
  .regex(/^\+?\d{1,4}$/, 'Invalid country calling code')
  .transform((v) => (v.startsWith('+') ? v : `+${v}`));

export const phoneNumberSchema = z
  .string({ required_error: 'Phone number is required' })
  .trim()
  .transform((v) => v.replace(/[\s\-().]/g, ''))
  .pipe(z.string().regex(/^\d{4,14}$/, 'Phone number must contain 4-14 digits'));

const numeric = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v);
const currentYear = () => new Date().getFullYear();
const yearField = (label) =>
  z.preprocess(numeric, z.number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a year` })
    .int(`${label} must be a whole year`).min(1970, `${label} is too early`).max(currentYear() + 1, `${label} is too far in the future`));

export function academicYearIssue(start, end) {
  if (end <= start) return 'academicYearEnd must be after academicYearStart';
  if (end - start > 6) return 'Academic period cannot exceed 6 years';
  return null;
}

export function phoneIssue(countryCode, number) {
  const p = parsePhoneNumberFromString(`${countryCode}${number}`);
  return p && p.isValid() ? null : 'Invalid phone number for the given country code';
}

const requireCompany = (d, ctx) => {
  if (COMPANY_REQUIRED_STATUSES.includes(d.workingStatus) && !d.companyName) {
    ctx.addIssue({ code: 'custom', path: ['companyName'], message: `Company name is required for ${d.workingStatus} alumni` });
  }
};

const enumField = (values, label) =>
  z.enum(values, { errorMap: () => ({ message: `${label} must be one of: ${values.join(', ')}` }) });

const fields = {
  fullName: nameField,
  phoneCountryCode: phoneCountryCodeSchema,
  phoneNumber: phoneNumberSchema,
  category: enumField(CATEGORIES, 'category'),
  academicYearStart: yearField('academicYearStart'),
  academicYearEnd: yearField('academicYearEnd'),
  program: enumField(PROGRAMS, 'program'),
  workingStatus: enumField(WORKING_STATUSES, 'workingStatus'),
};

export const registerSchema = z
  .object({
    ...fields,
    email: emailSchema,
    password: passwordSchema.optional(),
    googleIdToken: z.string().min(20).max(4096).optional(),
    companyName: emptyToUndef(companyField),
    companyWebsite: emptyToUndef(websiteUrl),
    linkedinUrl: emptyToUndef(linkedinUrl),
  })
  .strict() // unknown keys such as role / approvalStatus are rejected outright
  .superRefine((d, ctx) => {
    if (!d.password && !d.googleIdToken) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password is required' });
    }
    if (d.password && d.password.toLowerCase().includes(d.email.split('@')[0]) && d.email.split('@')[0].length >= 4) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'Password must not contain your email name' });
    }
    const y = academicYearIssue(d.academicYearStart, d.academicYearEnd);
    if (y) ctx.addIssue({ code: 'custom', path: ['academicYearEnd'], message: y });
    const p = phoneIssue(d.phoneCountryCode, d.phoneNumber);
    if (p) ctx.addIssue({ code: 'custom', path: ['phoneNumber'], message: p });
    requireCompany(d, ctx);
  });

/** PATCH profile: every field optional; null/"" clears the optional company fields. */
export const updateProfileSchema = z
  .object({
    fullName: fields.fullName.optional(),
    phoneCountryCode: fields.phoneCountryCode.optional(),
    phoneNumber: fields.phoneNumber.optional(),
    category: fields.category.optional(),
    academicYearStart: fields.academicYearStart.optional(),
    academicYearEnd: fields.academicYearEnd.optional(),
    program: fields.program.optional(),
    workingStatus: fields.workingStatus.optional(),
    companyName: emptyToNull(companyField),
    companyWebsite: emptyToNull(websiteUrl),
    linkedinUrl: emptyToNull(linkedinUrl),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (Object.keys(d).length === 0) ctx.addIssue({ code: 'custom', message: 'No updatable fields supplied' });
    if ((d.phoneCountryCode === undefined) !== (d.phoneNumber === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['phoneNumber'], message: 'phoneCountryCode and phoneNumber must be updated together' });
    } else if (d.phoneNumber) {
      const p = phoneIssue(d.phoneCountryCode, d.phoneNumber);
      if (p) ctx.addIssue({ code: 'custom', path: ['phoneNumber'], message: p });
    }
    if ((d.academicYearStart === undefined) !== (d.academicYearEnd === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['academicYearEnd'], message: 'academicYearStart and academicYearEnd must be updated together' });
    } else if (d.academicYearStart !== undefined) {
      const y = academicYearIssue(d.academicYearStart, d.academicYearEnd);
      if (y) ctx.addIssue({ code: 'custom', path: ['academicYearEnd'], message: y });
    }
    // The "company required" rule needs the stored record too; the service re-checks the merged result.
  });
