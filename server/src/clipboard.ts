import fs from 'fs/promises';
import path from 'path';
import { createHash, randomInt } from 'crypto';
import { findProjectRoot } from './paths.js';
import { loadEnglishWordlist } from './wordlist.js';
import {
  generateClipboardId,
  normalizeClipboardId,
  validateClipboardId,
  type RandomInt,
} from '../../shared/clipboard-id.js';
import type { ClipboardMeta, EncryptedClipboardPayload } from '../../shared/types.js';

const DATA_DIR_NAME = 'data';
const CONTENT_DIR_NAME = 'content';

export function getClipboardDir(id: string): string {
  const root = findProjectRoot();
  const normalized = normalizeClipboardId(id);
  return path.join(root, DATA_DIR_NAME, normalized);
}

export function getContentDir(id: string): string {
  return path.join(getClipboardDir(id), CONTENT_DIR_NAME);
}

export async function clipboardExists(id: string): Promise<boolean> {
  try {
    await fs.access(getClipboardDir(id));
    return true;
  } catch {
    return false;
  }
}

export async function generateUniqueClipboardId(wordlist: string[]): Promise<string> {
  const rng: RandomInt = (max) => randomInt(max);

  for (let attempt = 0; attempt < 100; attempt++) {
    const id = generateClipboardId(wordlist, rng);
    if (!(await clipboardExists(id))) {
      return id;
    }
  }

  throw new Error('Unable to generate a unique clipboard identifier');
}

export async function loadMeta(id: string): Promise<ClipboardMeta | null> {
  const metaPath = path.join(getClipboardDir(id), 'meta.json');
  try {
    const text = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(text) as ClipboardMeta;
    return normalizeMeta(meta);
  } catch (err) {
    if (isNoEntityError(err)) return null;
    throw err;
  }
}

function normalizeMeta(meta: ClipboardMeta): ClipboardMeta {
  return {
    ...meta,
    pendingRequests: meta.pendingRequests ?? [],
    ownerEncryptPublicKey: meta.ownerEncryptPublicKey ?? '',
    members: (meta.members ?? []).map((m) => ({
      ...m,
      encryptPublicKey: m.encryptPublicKey ?? '',
    })),
  };
}

export async function saveMeta(id: string, meta: ClipboardMeta): Promise<void> {
  const dir = getClipboardDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

export async function createClipboard(
  id: string,
  ownerPublicKey: string,
  ownerEncryptPublicKey: string,
  ownerName = 'Owner',
): Promise<ClipboardMeta> {
  const normalized = normalizeClipboardId(id);

  if (!(await validateClipboardId(normalized, await loadEnglishWordlist()))) {
    throw new Error('Invalid clipboard identifier');
  }

  if (await clipboardExists(normalized)) {
    throw new Error('Clipboard already exists');
  }

  const meta: ClipboardMeta = {
    id: normalized,
    ownerPublicKey,
    ownerEncryptPublicKey,
    members: [
      {
        publicKey: ownerPublicKey,
        encryptPublicKey: ownerEncryptPublicKey,
        name: ownerName,
        profile: 'owner',
        approval: { kind: 'indefinite', expiresAt: null },
      },
    ],
    pendingRequests: [],
  };

  await saveMeta(normalized, meta);
  return meta;
}

export async function wipeContent(id: string): Promise<void> {
  const contentDir = getContentDir(id);
  try {
    await fs.rm(contentDir, { recursive: true, force: true });
  } catch (err) {
    if (!isNoEntityError(err)) throw err;
  }
}

export async function deleteClipboard(id: string): Promise<void> {
  const dir = getClipboardDir(id);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    if (!isNoEntityError(err)) throw err;
  }
}

export async function storeContent(
  id: string,
  payload: EncryptedClipboardPayload,
): Promise<string> {
  const contentDir = getContentDir(id);
  await fs.mkdir(contentDir, { recursive: true });

  const timestamp = payload.timestamp ?? new Date().toISOString();
  const filename = `${timestamp.replace(/[:.]/g, '-')}.json`;
  const filePath = path.join(contentDir, filename);

  await fs.writeFile(filePath, JSON.stringify({ ...payload, timestamp }, null, 2));
  return filename;
}

export async function loadRecentContent(
  id: string,
  maxCount: number,
  maxAgeMs: number,
): Promise<EncryptedClipboardPayload[]> {
  const contentDir = getContentDir(id);
  const now = Date.now();
  const entries: EncryptedClipboardPayload[] = [];

  let files: string[] = [];
  try {
    files = await fs.readdir(contentDir);
  } catch (err) {
    if (isNoEntityError(err)) return [];
    throw err;
  }

  for (const file of files
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, maxCount)) {
    try {
      const text = await fs.readFile(path.join(contentDir, file), 'utf-8');
      const payload = JSON.parse(text) as EncryptedClipboardPayload;
      const ts = new Date(payload.timestamp ?? file).getTime();
      if (now - ts <= maxAgeMs) {
        entries.push(payload);
      }
    } catch {
      // Ignore unreadable files.
    }
  }

  return entries.reverse();
}

export function publicKeyThumbprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex');
}

function isNoEntityError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ENOENT'
  );
}
