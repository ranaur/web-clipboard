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
import type { ClipboardMeta } from '../../shared/types.js';

const DATA_DIR_NAME = 'data';

export function getClipboardDir(id: string): string {
  const root = findProjectRoot();
  const normalized = normalizeClipboardId(id);
  return path.join(root, DATA_DIR_NAME, normalized);
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

export async function createClipboard(id: string, ownerPublicKey: string): Promise<ClipboardMeta> {
  const normalized = normalizeClipboardId(id);

  if (!(await validateClipboardId(normalized, await loadEnglishWordlist()))) {
    throw new Error('Invalid clipboard identifier');
  }

  if (await clipboardExists(normalized)) {
    throw new Error('Clipboard already exists');
  }

  const dir = getClipboardDir(normalized);
  await fs.mkdir(dir, { recursive: true });

  const meta: ClipboardMeta = {
    id: normalized,
    ownerPublicKey,
    members: [
      {
        publicKey: ownerPublicKey,
        name: 'Owner',
        profile: 'owner',
        approval: { kind: 'indefinite', expiresAt: null },
      },
    ],
  };

  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

export function publicKeyThumbprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex');
}
