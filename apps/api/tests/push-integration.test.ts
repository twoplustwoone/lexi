import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sendWebPushNotification } from '../src/notifications/push';
import { createMockPushServer, MockPushServer } from './helpers/mock-push-server';

describe('Push Integration', () => {
  let mockServer: MockPushServer;

  // Test VAPID keypair - do NOT use in production
  const testKeys = {
    publicKey:
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtntVsYjexsXPB5l-Dk7U8EIU4N6YzXIcYQ9wB3-gn0mUV8GJ0',
    privateKey: 'UaQOVZOBl9-t7HnC-6MsBDJMO3eFoRfNBDfmEHUxXOA',
  };

  beforeAll(async () => {
    mockServer = createMockPushServer({ port: 9998 });
    await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  it('sends request to the correct endpoint', async () => {
    mockServer.clearRequests();
    mockServer.setResponse(201);

    const endpoint = mockServer.getEndpoint('/push/subscription-123');

    await sendWebPushNotification({
      endpoint,
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    const request = mockServer.getLastRequest();
    expect(request).toBeDefined();
    expect(request?.url).toBe('/push/subscription-123');
    expect(request?.method).toBe('POST');
  });

  it('includes TTL header', async () => {
    mockServer.clearRequests();
    mockServer.setResponse(201);

    await sendWebPushNotification({
      endpoint: mockServer.getEndpoint(),
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    const request = mockServer.getLastRequest();
    expect(request?.headers.ttl).toBe('86400');
  });

  it('includes Authorization header with VAPID token', async () => {
    mockServer.clearRequests();
    mockServer.setResponse(201);

    await sendWebPushNotification({
      endpoint: mockServer.getEndpoint(),
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    const request = mockServer.getLastRequest();
    const auth = request?.headers.authorization as string;

    expect(auth).toBeDefined();
    expect(auth).toMatch(/^WebPush\s+\S+$/);

    const jwt = auth.replace(/^WebPush\s+/, '');
    expect(jwt.split('.')).toHaveLength(3);
  });

  it('includes Crypto-Key header', async () => {
    mockServer.clearRequests();
    mockServer.setResponse(201);

    await sendWebPushNotification({
      endpoint: mockServer.getEndpoint(),
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    const request = mockServer.getLastRequest();
    const cryptoKey = request?.headers['crypto-key'] as string;

    expect(cryptoKey).toBeDefined();
    expect(cryptoKey).toContain('p256ecdsa=');
    expect(cryptoKey).toContain(testKeys.publicKey);
  });

  it('sends with Content-Length 0 (no payload)', async () => {
    mockServer.clearRequests();
    mockServer.setResponse(201);

    await sendWebPushNotification({
      endpoint: mockServer.getEndpoint(),
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    const request = mockServer.getLastRequest();
    expect(request?.headers['content-length']).toBe('0');
    expect(request?.body).toBe('');
  });

  it('returns response with correct status', async () => {
    mockServer.setResponse(201);

    const response = await sendWebPushNotification({
      endpoint: mockServer.getEndpoint(),
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    expect(response.status).toBe(201);
    expect(response.ok).toBe(true);
  });

  it('returns 404 response when server returns 404', async () => {
    mockServer.setResponse(404, 'Not Found');

    const response = await sendWebPushNotification({
      endpoint: mockServer.getEndpoint(),
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
  });

  it('returns 410 response when server returns 410', async () => {
    mockServer.setResponse(410, 'Gone');

    const response = await sendWebPushNotification({
      endpoint: mockServer.getEndpoint(),
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    expect(response.status).toBe(410);
    expect(response.ok).toBe(false);
  });

  it('handles server error responses', async () => {
    mockServer.setResponse(500, 'Internal Server Error');

    const response = await sendWebPushNotification({
      endpoint: mockServer.getEndpoint(),
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    expect(response.status).toBe(500);
    expect(response.ok).toBe(false);
  });

  it('generates valid JWT in Authorization header', async () => {
    mockServer.clearRequests();
    mockServer.setResponse(201);

    await sendWebPushNotification({
      endpoint: mockServer.getEndpoint(),
      publicKey: testKeys.publicKey,
      privateKey: testKeys.privateKey,
      subject: 'mailto:test@example.com',
    });

    const request = mockServer.getLastRequest();
    const auth = request?.headers.authorization as string;

    const jwt = auth.replace(/^WebPush\s+/, '');
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    // Decode and verify header
    const headerBase64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    const headerJson = atob(headerBase64.padEnd(Math.ceil(headerBase64.length / 4) * 4, '='));
    const header = JSON.parse(headerJson);

    expect(header.typ).toBe('JWT');
    expect(header.alg).toBe('ES256');

    // Decode and verify payload
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payloadJson = atob(payloadBase64.padEnd(Math.ceil(payloadBase64.length / 4) * 4, '='));
    const payload = JSON.parse(payloadJson);

    expect(payload.aud).toBe('http://localhost:9998');
    expect(payload.sub).toBe('mailto:test@example.com');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
