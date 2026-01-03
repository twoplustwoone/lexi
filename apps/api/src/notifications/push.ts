import { createVapidJwt } from './vapid';

export async function sendWebPushNotification(params: {
  endpoint: string;
  publicKey: string;
  privateKey: string;
  subject: string;
}): Promise<Response> {
  const url = new URL(params.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = createVapidJwt(audience, params.subject, {
    publicKey: params.publicKey,
    privateKey: params.privateKey,
  });

  return fetch(params.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Authorization: `vapid t=${jwt}, k=${params.publicKey}`,
      'Crypto-Key': `p256ecdsa=${params.publicKey}`,
      'Content-Length': '0',
    },
  });
}
