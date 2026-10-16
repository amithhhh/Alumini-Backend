import { User } from '../../src/models/User.js';
import { hashPassword } from '../../src/services/password.service.js';

export const PASSWORD = 'Str0ngPassw0rd!';

export const validRegistration = (overrides = {}) => ({
  fullName: 'Asha Menon',
  email: 'asha.menon@example.com',
  password: PASSWORD,
  phoneCountryCode: '+91',
  phoneNumber: '9847012345',
  category: 'indian',
  academicYearStart: 2018,
  academicYearEnd: 2020,
  program: 'MCA',
  workingStatus: 'Employed',
  companyName: 'Acme Technologies',
  companyWebsite: 'https://acme.example.com',
  linkedinUrl: 'https://www.linkedin.com/in/asha-menon',
  ...overrides,
});

let n = 0;
export async function createAlumnus(overrides = {}) {
  n += 1;
  const { password = PASSWORD, ...rest } = overrides;
  return User.create({
    fullName: `Alumnus ${n}`,
    email: `alumnus${n}@example.com`,
    passwordHash: await hashPassword(password),
    phoneCountryCode: '+91', phoneNumber: '9847012345',
    category: 'indian', academicYearStart: 2018, academicYearEnd: 2020,
    program: 'MCA', workingStatus: 'Employed', companyName: 'Acme',
    role: 'alumni', approvalStatus: 'approved',
    ...rest,
  });
}

export async function createAdmin(overrides = {}) {
  return User.create({
    fullName: 'Portal Admin', email: 'admin@example.com', passwordHash: await hashPassword(PASSWORD),
    role: 'admin', approvalStatus: 'approved', accountStatus: 'active', ...overrides,
  });
}
