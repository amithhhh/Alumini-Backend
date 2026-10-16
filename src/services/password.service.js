import argon2 from 'argon2';

const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => argon2.hash(plain, OPTS);

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

let dummyHash;
/** Spend the same time as a real verification so unknown emails can't be detected by response timing. */
export async function burnPasswordCheck(plain) {
  dummyHash ??= await hashPassword('timing-equaliser-not-a-real-password-1');
  await verifyPassword(dummyHash, plain);
}
