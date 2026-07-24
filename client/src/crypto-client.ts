import { arrayBufferToBase64, base64ToArrayBuffer, stringToBuffer } from '../../shared/encoding.js';
import type { PublicKeyBundle } from '../../shared/types.js';

export interface WrappedPrivateKeys {
  sign: string; // base64-encoded wrapped JWK
  encrypt: string;
  salt: string;
  iv: string;
}

const RSA_PUBLIC_EXPONENT = new Uint8Array([0x01, 0x00, 0x01]);
const RSA_MODULUS_LENGTH = 2048;
const AES_GCM_IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100_000;

export class CryptoClient {
  private signKeyPair!: CryptoKeyPair;
  private encryptKeyPair!: CryptoKeyPair;

  private constructor() {}

  static async create(): Promise<CryptoClient> {
    const client = new CryptoClient();
    [client.signKeyPair, client.encryptKeyPair] = await Promise.all([
      crypto.subtle.generateKey(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: RSA_MODULUS_LENGTH,
          publicExponent: RSA_PUBLIC_EXPONENT,
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
      ),
      crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: RSA_MODULUS_LENGTH,
          publicExponent: RSA_PUBLIC_EXPONENT,
          hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt'],
      ),
    ]);
    return client;
  }

  static async fromKeys(
    signKeyPair: CryptoKeyPair,
    encryptKeyPair: CryptoKeyPair,
  ): Promise<CryptoClient> {
    const client = new CryptoClient();
    client.signKeyPair = signKeyPair;
    client.encryptKeyPair = encryptKeyPair;
    return client;
  }

  getKeyPairs(): { signKeyPair: CryptoKeyPair; encryptKeyPair: CryptoKeyPair } {
    return {
      signKeyPair: this.signKeyPair,
      encryptKeyPair: this.encryptKeyPair,
    };
  }

  async getPublicKeys(): Promise<PublicKeyBundle> {
    const [signSpki, encryptSpki] = await Promise.all([
      crypto.subtle.exportKey('spki', this.signKeyPair.publicKey),
      crypto.subtle.exportKey('spki', this.encryptKeyPair.publicKey),
    ]);

    return {
      signPublicKey: arrayBufferToBase64(signSpki),
      encryptPublicKey: arrayBufferToBase64(encryptSpki),
    };
  }

  static async importSignPublicKey(base64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'spki',
      base64ToArrayBuffer(base64),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['verify'],
    );
  }

  static async importEncryptPublicKey(base64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'spki',
      base64ToArrayBuffer(base64),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt'],
    );
  }

  async signChallenge(data: ArrayBuffer | string): Promise<ArrayBuffer> {
    const buffer = typeof data === 'string' ? stringToBuffer(data) : data;
    return crypto.subtle.sign('RSASSA-PKCS1-v1_5', this.signKeyPair.privateKey, buffer);
  }

  async signChallengeBase64(data: ArrayBuffer | string): Promise<string> {
    const signature = await this.signChallenge(data);
    return arrayBufferToBase64(signature);
  }

  static async verifyChallenge(
    signature: ArrayBuffer,
    data: ArrayBuffer | string,
    publicKeyBase64: string,
  ): Promise<boolean> {
    const key = await CryptoClient.importSignPublicKey(publicKeyBase64);
    const buffer = typeof data === 'string' ? stringToBuffer(data) : data;
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, buffer);
  }

  static generateSharedSecret(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  async encryptSharedSecret(
    sharedSecret: ArrayBuffer,
    peerEncryptPublicKeyBase64: string,
  ): Promise<ArrayBuffer> {
    const key = await CryptoClient.importEncryptPublicKey(peerEncryptPublicKeyBase64);
    return crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, sharedSecret);
  }

  async decryptSharedSecret(encrypted: ArrayBuffer): Promise<ArrayBuffer> {
    return crypto.subtle.decrypt({ name: 'RSA-OAEP' }, this.encryptKeyPair.privateKey, encrypted);
  }

  static async importContentKey(raw: ArrayBuffer): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
  }

  static async encryptContent(
    plaintext: ArrayBuffer,
    key: CryptoKey,
  ): Promise<{ iv: string; ciphertext: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      plaintext,
    );
    return {
      iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
      ciphertext: arrayBufferToBase64(ciphertext),
    };
  }

  static async decryptContent(
    ivBase64: string,
    ciphertextBase64: string,
    key: CryptoKey,
  ): Promise<ArrayBuffer> {
    const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));
    const ciphertext = base64ToArrayBuffer(ciphertextBase64);
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext,
    );
  }

  async wrapPrivateKeys(password: string): Promise<WrappedPrivateKeys> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
    const wrappingKey = await CryptoClient.deriveWrappingKey(password, salt.buffer as ArrayBuffer, [
      'wrapKey',
    ]);

    const [signWrapped, encryptWrapped] = await Promise.all([
      crypto.subtle.wrapKey('jwk', this.signKeyPair.privateKey, wrappingKey, {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
      }),
      crypto.subtle.wrapKey('jwk', this.encryptKeyPair.privateKey, wrappingKey, {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
      }),
    ]);

    return {
      sign: arrayBufferToBase64(signWrapped),
      encrypt: arrayBufferToBase64(encryptWrapped),
      salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
      iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    };
  }

  static async unwrapPrivateKeys(
    wrapped: WrappedPrivateKeys,
    password: string,
  ): Promise<CryptoClient> {
    const salt = base64ToArrayBuffer(wrapped.salt);
    const iv = new Uint8Array(base64ToArrayBuffer(wrapped.iv));
    const wrappingKey = await CryptoClient.deriveWrappingKey(password, salt, ['unwrapKey']);

    const [signPrivateKey, encryptPrivateKey] = await Promise.all([
      crypto.subtle.unwrapKey(
        'jwk',
        base64ToArrayBuffer(wrapped.sign),
        wrappingKey,
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        true,
        ['sign'],
      ),
      crypto.subtle.unwrapKey(
        'jwk',
        base64ToArrayBuffer(wrapped.encrypt),
        wrappingKey,
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['decrypt'],
      ),
    ]);

    const signKeyPair: CryptoKeyPair = {
      publicKey: await CryptoClient.derivePublicKey(signPrivateKey, 'RSASSA-PKCS1-v1_5'),
      privateKey: signPrivateKey,
    };
    const encryptKeyPair: CryptoKeyPair = {
      publicKey: await CryptoClient.derivePublicKey(encryptPrivateKey, 'RSA-OAEP'),
      privateKey: encryptPrivateKey,
    };

    return CryptoClient.fromKeys(signKeyPair, encryptKeyPair);
  }

  private static async derivePublicKey(
    privateKey: CryptoKey,
    name: 'RSASSA-PKCS1-v1_5' | 'RSA-OAEP',
  ): Promise<CryptoKey> {
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);
    delete jwk.d;
    delete jwk.dp;
    delete jwk.dq;
    delete jwk.q;
    delete jwk.qi;
    jwk.key_ops = name === 'RSASSA-PKCS1-v1_5' ? ['verify'] : ['encrypt'];
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name, hash: 'SHA-256' },
      true,
      name === 'RSASSA-PKCS1-v1_5' ? ['verify'] : ['encrypt'],
    );
  }

  private static async deriveWrappingKey(
    password: string,
    salt: ArrayBuffer,
    usages: KeyUsage[],
  ): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      stringToBuffer(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      usages,
    );
  }
}
