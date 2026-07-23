import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { CryptoClient, type WrappedPrivateKeys } from './crypto-client.js';

const DB_NAME = 'distributed-clipboard';
const STORE_NAME = 'identity';
const DB_VERSION = 1;

export interface Identity {
  machineName: string;
  userName: string;
  hasPassword: boolean;
  signKeyPair?: CryptoKeyPair;
  encryptKeyPair?: CryptoKeyPair;
  wrappedKeys?: WrappedPrivateKeys;
  createdAt: string;
}

interface IdentityDB extends DBSchema {
  identity: {
    key: string;
    value: Identity;
  };
}

async function openIdentityDB(): Promise<IDBPDatabase<IdentityDB>> {
  return openDB<IdentityDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
}

const IDENTITY_KEY = 'local-identity';

export async function loadIdentity(): Promise<Identity | undefined> {
  const db = await openIdentityDB();
  try {
    return await db.get(STORE_NAME, IDENTITY_KEY);
  } finally {
    db.close();
  }
}

export async function saveIdentity(identity: Identity): Promise<void> {
  const db = await openIdentityDB();
  try {
    await db.put(STORE_NAME, identity, IDENTITY_KEY);
  } finally {
    db.close();
  }
}

export async function deleteIdentity(): Promise<void> {
  const db = await openIdentityDB();
  try {
    await db.delete(STORE_NAME, IDENTITY_KEY);
  } finally {
    db.close();
  }
}

export async function createIdentity(
  machineName: string,
  userName: string,
  password?: string,
): Promise<{ identity: Identity; client: CryptoClient }> {
  const client = await CryptoClient.create();

  const base: Omit<Identity, 'signKeyPair' | 'encryptKeyPair' | 'wrappedKeys'> = {
    machineName: machineName.trim(),
    userName: userName.trim(),
    hasPassword: Boolean(password && password.length > 0),
    createdAt: new Date().toISOString(),
  };

  let identity: Identity;
  if (password) {
    const wrappedKeys = await client.wrapPrivateKeys(password);
    identity = { ...base, wrappedKeys };
  } else {
    const { signKeyPair, encryptKeyPair } = client.getKeyPairs();
    identity = { ...base, signKeyPair, encryptKeyPair };
  }

  await saveIdentity(identity);
  return { identity, client };
}

export async function unlockIdentity(identity: Identity, password: string): Promise<CryptoClient> {
  if (!identity.hasPassword || !identity.wrappedKeys) {
    throw new Error('Identity is not password protected');
  }

  return CryptoClient.unwrapPrivateKeys(identity.wrappedKeys, password);
}

export async function restoreUnprotectedIdentity(identity: Identity): Promise<CryptoClient> {
  if (identity.hasPassword) {
    throw new Error('Identity is password protected');
  }

  if (!identity.signKeyPair || !identity.encryptKeyPair) {
    throw new Error('Stored identity is missing key pairs');
  }

  return CryptoClient.fromKeys(identity.signKeyPair, identity.encryptKeyPair);
}
