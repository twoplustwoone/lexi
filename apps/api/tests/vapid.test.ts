import { describe, expect, it } from 'vitest';

import { base64UrlDecode } from '../src/utils/base64';
import { createVapidJwt, getPublicKeyBytes } from '../src/notifications/vapid';

describe('createVapidJwt', () => {
  // Test VAPID keypair generated with @noble/curves
  // These are test keys - do NOT use in production
  const testKeys = {
    publicKey:
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtntVsYjexsXPB5l-Dk7U8EIU4N6YzXIcYQ9wB3-gn0mUV8GJ0',
    privateKey: 'UaQOVZOBl9-t7HnC-6MsBDJMO3eFoRfNBDfmEHUxXOA',
  };

  it('creates a valid JWT structure with three parts', () => {
    const jwt = createVapidJwt('https://fcm.googleapis.com', 'mailto:test@example.com', testKeys);

    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBeTruthy(); // header
    expect(parts[1]).toBeTruthy(); // payload
    expect(parts[2]).toBeTruthy(); // signature
  });

  it('has correct header with typ and alg', () => {
    const jwt = createVapidJwt('https://fcm.googleapis.com', 'mailto:test@example.com', testKeys);

    const parts = jwt.split('.');
    const headerJson = new TextDecoder().decode(base64UrlDecode(parts[0]));
    const header = JSON.parse(headerJson);

    expect(header.typ).toBe('JWT');
    expect(header.alg).toBe('ES256');
  });

  it('has correct payload with aud, sub, and exp', () => {
    const jwt = createVapidJwt('https://fcm.googleapis.com', 'mailto:test@example.com', testKeys);

    const parts = jwt.split('.');
    const payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]));
    const payload = JSON.parse(payloadJson);

    expect(payload.aud).toBe('https://fcm.googleapis.com');
    expect(payload.sub).toBe('mailto:test@example.com');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 12 * 60 * 60 + 1);
  });

  it('handles different push service audiences', () => {
    const audiences = [
      'https://fcm.googleapis.com',
      'https://updates.push.services.mozilla.com',
      'https://wns.windows.com',
      'https://web.push.apple.com',
    ];

    for (const aud of audiences) {
      const jwt = createVapidJwt(aud, 'mailto:test@example.com', testKeys);
      const parts = jwt.split('.');
      const payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]));
      const payload = JSON.parse(payloadJson);

      expect(payload.aud).toBe(aud);
    }
  });

  it('produces a signature that is 64 bytes when decoded', () => {
    const jwt = createVapidJwt('https://fcm.googleapis.com', 'mailto:test@example.com', testKeys);

    const parts = jwt.split('.');
    const signature = base64UrlDecode(parts[2]);

    // ES256 signatures are 64 bytes (32 bytes r + 32 bytes s)
    expect(signature.length).toBe(64);
  });

  it('produces different JWTs for different audiences', () => {
    const jwt1 = createVapidJwt('https://fcm.googleapis.com', 'mailto:test@example.com', testKeys);
    const jwt2 = createVapidJwt(
      'https://updates.push.services.mozilla.com',
      'mailto:test@example.com',
      testKeys
    );

    expect(jwt1).not.toBe(jwt2);
  });

  it('produces different JWTs for different subjects', () => {
    const jwt1 = createVapidJwt('https://fcm.googleapis.com', 'mailto:user1@example.com', testKeys);
    const jwt2 = createVapidJwt('https://fcm.googleapis.com', 'mailto:user2@example.com', testKeys);

    expect(jwt1).not.toBe(jwt2);
  });
});

describe('getPublicKeyBytes', () => {
  const testPublicKey =
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtntVsYjexsXPB5l-Dk7U8EIU4N6YzXIcYQ9wB3-gn0mUV8GJ0';

  it('decodes public key to 65 bytes', () => {
    const bytes = getPublicKeyBytes(testPublicKey);
    expect(bytes.length).toBe(65);
  });

  it('decoded key starts with 0x04 (uncompressed point)', () => {
    const bytes = getPublicKeyBytes(testPublicKey);
    expect(bytes[0]).toBe(0x04);
  });
});
