export const PROGRAMS = ['MSc Computer Science', 'MCA', 'PGDDSA — Data Science', 'PGDCS — Cyber Security'];
export const WORKING_STATUSES = ['Employed', 'Self-employed', 'Unemployed', 'Higher Studies'];
export const COMPANY_REQUIRED_STATUSES = ['Employed', 'Self-employed'];
export const CATEGORIES = ['indian', 'nri'];
export const ROLES = ['alumni', 'admin'];
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];
export const ACCOUNT_STATUSES = ['active', 'suspended'];
export const NOTIFICATION_TYPES = ['approval', 'rejection', 'account', 'announcement'];
export const NOTIFICATION_AUDIENCES = ['user', 'all_approved'];

/** The ONLY user fields a client may ever write (registration + profile updates). */
export const PROFILE_FIELDS = [
  'fullName', 'phoneCountryCode', 'phoneNumber', 'category', 'academicYearStart', 'academicYearEnd',
  'program', 'workingStatus', 'companyName', 'companyWebsite', 'linkedinUrl',
];

export const AUDIT_ACTIONS = {
  ALUMNI_APPROVE: 'alumni.approve',
  ALUMNI_REJECT: 'alumni.reject',
  ALUMNI_STATUS_CHANGE: 'alumni.status_change',
  ALUMNI_PROFILE_UPDATE: 'alumni.profile_update',
  NOTIFICATION_SEND: 'notification.send',
  EXPORT_CSV: 'export.csv',
  EXPORT_EXCEL: 'export.excel',
  ADMIN_BOOTSTRAP: 'admin.bootstrap',
  ADMIN_SETTINGS_UPDATE: 'admin.settings_update', // reserved: no settings endpoint exists yet
};

export const SESSION_COOKIE = 'alumni_session';
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';
