/**
 * One-time administrator bootstrap.  Run on the server:   npm run create-admin
 *
 * Protections:
 *  - Only reachable by someone with shell access AND the production secrets/DB URI (no HTTP route exists).
 *  - Refuses to run if ANY administrator already exists (one-time by design).
 *  - Password is read from a hidden prompt (never from argv / shell history). For CI you may instead set
 *    ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_NAME / ADMIN_BOOTSTRAP_PASSWORD.
 *  - Writes an audit-log entry.
 */
import readline from 'node:readline';
import { connectDb, disconnectDb } from '../config/db.js';
import { User, AdminActivityLog } from '../models/index.js';
import { hashPassword } from '../services/password.service.js';
import { emailSchema, passwordSchema } from '../validators/common.js';
import { AUDIT_ACTIONS } from '../constants.js';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
    if (hidden) rl._writeToOutput = () => rl.output.write('*');
  });
}

async function main() {
  await connectDb();
  try {
    if (await User.exists({ role: 'admin' })) {
      console.error('An administrator already exists. Bootstrap is one-time only; use the normal password-reset flow instead.');
      process.exitCode = 1;
      return;
    }

    const name = (process.env.ADMIN_BOOTSTRAP_NAME || (await ask('Admin full name: '))).trim();
    const emailRaw = process.env.ADMIN_BOOTSTRAP_EMAIL || (await ask('Admin email: '));
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || (await ask('Admin password (hidden): ', { hidden: true }));

    const email = emailSchema.safeParse(emailRaw);
    if (!email.success) throw new Error('Invalid email address');
    if (name.length < 2) throw new Error('Name is too short');
    const pw = passwordSchema.safeParse(password);
    if (!pw.success || password.length < 12) throw new Error('Admin password must be 12-128 characters and contain a letter and a number');
    if (await User.exists({ email: email.data })) throw new Error('A user with this email already exists');

    const admin = await User.create({
      fullName: name,
      email: email.data,
      passwordHash: await hashPassword(password),
      role: 'admin',
      approvalStatus: 'approved',
      accountStatus: 'active',
      approvedAt: new Date(),
    });
    await AdminActivityLog.create({
      adminId: admin._id, action: AUDIT_ACTIONS.ADMIN_BOOTSTRAP, resourceType: 'admin', resourceId: String(admin._id),
      details: { email: admin.email, via: 'cli' },
    });
    console.log(`Administrator created: ${admin.email}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

main();
