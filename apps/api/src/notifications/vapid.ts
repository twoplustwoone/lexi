import { p256 } from '@noble/curves/p256';

import { base64UrlDecode, base64UrlEncode } from '../utils/base64';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function createVapidJwt(audience: string, subject: string, keys: VapidKeys): string {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = p256
    .sign(new TextEncoder().encode(signingInput), base64UrlDecode(keys.privateKey), {
      prehash: true,
      lowS: true,
    })
    .toCompactRawBytes();
  const signatureB64 = base64UrlEncode(signature);

  return `${signingInput}.${signatureB64}`;
}

export function getPublicKeyBytes(publicKey: string): Uint8Array {
  return base64UrlDecode(publicKey);
}
