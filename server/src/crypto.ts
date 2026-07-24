import { webcrypto } from 'node:crypto';
import { base64ToArrayBuffer, stringToBuffer } from '../../shared/encoding.js';

export async function importSignPublicKey(base64: string): Promise<CryptoKey> {
  return webcrypto.subtle.importKey(
    'spki',
    base64ToArrayBuffer(base64),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify'],
  );
}

export async function verifySignature(
  publicKeyBase64: string,
  signatureBase64: string,
  data: string,
): Promise<boolean> {
  const key = await importSignPublicKey(publicKeyBase64);
  const signature = base64ToArrayBuffer(signatureBase64);
  return webcrypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    signature,
    stringToBuffer(data),
  );
}
