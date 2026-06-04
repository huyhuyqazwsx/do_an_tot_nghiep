import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SHA256_PREFIX = 'sha256';
const SALT_BYTES = 16;

export function hashPassword(password: string) {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  return `${SHA256_PREFIX}:${salt}:${hashSha256(password, salt)}`;
}

export function verifyPassword(password: string, storedHash: string) {
  if (!storedHash.startsWith(`${SHA256_PREFIX}:`)) {
    return false;
  }

  return verifySha256Password(password, storedHash);
}

function hashSha256(password: string, salt: string) {
  return createHash('sha256')
    .update(salt)
    .update(':')
    .update(password)
    .digest('hex');
}

function verifySha256Password(password: string, storedHash: string) {
  const [, salt, expectedHash] = storedHash.split(':');

  if (!salt || !expectedHash || !isHex(expectedHash) || !isHex(salt)) {
    return false;
  }

  const actualHash = hashSha256(password, salt);
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

function isHex(value: string) {
  return /^[0-9a-f]+$/i.test(value);
}
