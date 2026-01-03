import { scrypt } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

import { base64UrlEncode } from './base64';

const PASSWORD_N = 16384;
const PASSWORD_R = 8;
const PASSWORD_P = 1;
const PASSWORD_LEN = 32;

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function hashPassword(password: string, salt?: Uint8Array): string {
  const saltBytes = salt ?? randomBytes(16);
  const hash = scrypt(password, saltBytes, {
    N: PASSWORD_N,
    r: PASSWORD_R,
    p: PASSWORD_P,
    dkLen: PASSWORD_LEN,
  });

  return [
    'scrypt',
    PASSWORD_N,
    PASSWORD_R,
    PASSWORD_P,
    base64UrlEncode(saltBytes),
    base64UrlEncode(hash),
  ].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt') {
    return false;
  }
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  const saltBytes = base64UrlDecodeSafe(saltB64);
  const hashBytes = base64UrlDecodeSafe(hashB64);
  if (!saltBytes || !hashBytes) {
    return false;
  }
  const computed = scrypt(password, saltBytes, { N, r: R, p: P, dkLen: hashBytes.length });
  return timingSafeEqual(computed, hashBytes);
}

export function hashToken(token: string, secret: string): string {
  const data = new TextEncoder().encode(`${token}.${secret}`);
  return bytesToHex(sha256(data));
}

export function hashCode(code: string, salt: string): string {
  const data = new TextEncoder().encode(`${code}.${salt}`);
  return bytesToHex(sha256(data));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function base64UrlDecodeSafe(input: string | undefined): Uint8Array | null {
  if (!input) {
    return null;
  }
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
