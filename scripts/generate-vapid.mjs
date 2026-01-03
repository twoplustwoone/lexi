import { p256 } from '@noble/curves/p256';

function base64UrlEncode(data) {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const privateKey = p256.utils.randomPrivateKey();
const publicKey = p256.getPublicKey(privateKey, false);

console.log('VAPID_PUBLIC_KEY=', base64UrlEncode(publicKey));
console.log('VAPID_PRIVATE_KEY=', base64UrlEncode(privateKey));
