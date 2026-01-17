import { base64UrlDecode } from '../utils/base64';
import { createVapidJwt } from './vapid';

const textEncoder = new TextEncoder();
const RECORD_SIZE = 4096;
const TAG_LENGTH = 16;

export interface WebPushPayload {
  title: string;
  body?: string;
  url?: string;
}

interface SubscriptionKeys {
  p256dh: string;
  auth: string;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

function buildInfo(label: string): Uint8Array {
  return textEncoder.encode(`Content-Encoding: ${label}\0`);
}

function buildWebPushInfo(clientPublicKey: Uint8Array, serverPublicKey: Uint8Array): Uint8Array {
  const info = textEncoder.encode('WebPush: info\0');
  return concatBytes(info, clientPublicKey, serverPublicKey);
}

function uint32be(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value);
  return new Uint8Array(buffer);
}

function buildPayloadHeader(salt: Uint8Array, recordSize: number, keyId: Uint8Array): Uint8Array {
  if (keyId.length > 255) {
    throw new Error('Key identifier too large for payload header');
  }
  const keyIdLength = new Uint8Array([keyId.length]);
  return concatBytes(salt, uint32be(recordSize), keyIdLength, keyId);
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(ikm), 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info),
    },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

async function encryptPayload(
  payload: Uint8Array,
  keys: SubscriptionKeys
): Promise<{ body: Uint8Array }> {
  if (payload.length + 1 + TAG_LENGTH > RECORD_SIZE) {
    throw new Error('Push payload too large for single record');
  }

  const clientPublicKey = base64UrlDecode(keys.p256dh);
  const authSecret = base64UrlDecode(keys.auth);
  const clientKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(clientPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const serverPublicKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeys.publicKey)
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256)
  );

  const ikm = await hkdf(
    sharedSecret,
    authSecret,
    buildWebPushInfo(clientPublicKey, serverPublicKey),
    32
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, buildInfo('aes128gcm'), 16);
  const nonce = await hkdf(ikm, salt, buildInfo('nonce'), 12);

  const cekKey = await crypto.subtle.importKey('raw', toArrayBuffer(cek), 'AES-GCM', false, [
    'encrypt',
  ]);
  const padding = new Uint8Array([2]);
  const plaintext = concatBytes(payload, padding);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
      cekKey,
      toArrayBuffer(plaintext)
    )
  );

  const header = buildPayloadHeader(salt, RECORD_SIZE, serverPublicKey);
  return { body: concatBytes(header, ciphertext) };
}

export async function sendWebPushNotification(params: {
  endpoint: string;
  publicKey: string;
  privateKey: string;
  subject: string;
  payload?: WebPushPayload;
  subscriptionKeys?: SubscriptionKeys;
}): Promise<Response> {
  const url = new URL(params.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = createVapidJwt(audience, params.subject, {
    publicKey: params.publicKey,
    privateKey: params.privateKey,
  });

  const headers: Record<string, string> = {
    TTL: '86400',
  };
  let body: Uint8Array | undefined;

  if (params.payload) {
    if (!params.subscriptionKeys) {
      throw new Error('Subscription keys are required for push payloads');
    }
    const payloadBytes = textEncoder.encode(JSON.stringify(params.payload));
    const encrypted = await encryptPayload(payloadBytes, params.subscriptionKeys);

    headers['Content-Encoding'] = 'aes128gcm';
    headers['Content-Type'] = 'application/octet-stream';
    body = encrypted.body;
    headers.Authorization = `vapid t=${jwt}, k=${params.publicKey}`;
    headers['Content-Length'] = String(body.byteLength);
  } else {
    headers.Authorization = `WebPush ${jwt}`;
    headers['Crypto-Key'] = `p256ecdsa=${params.publicKey}`;
    headers['Content-Length'] = '0';
  }

  return fetch(params.endpoint, {
    method: 'POST',
    headers,
    body: body ? toArrayBuffer(body) : undefined,
  });
}
