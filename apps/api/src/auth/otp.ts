import { DateTime } from 'luxon';

import { bytesToHex } from '@noble/hashes/utils';

import { hashCode, randomBytes } from '../utils/crypto';

export function generateNumericCode(length = 6): string {
  const bytes = randomBytes(length);
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += (bytes[i] % 10).toString();
  }
  return output;
}

export function createCodeHash(code: string): { hash: string; salt: string } {
  const saltBytes = randomBytes(8);
  const salt = bytesToHex(saltBytes);
  const hash = hashCode(code, salt);
  return { hash, salt };
}

export function buildExpiry(minutes = 10): string {
  return DateTime.utc().plus({ minutes }).toISO();
}
