import fs from 'fs/promises';
import path from 'path';
import { findProjectRoot } from './paths.js';

let cached: string[] | undefined;

export async function loadEnglishWordlist(): Promise<string[]> {
  if (cached) return cached;

  const root = findProjectRoot();
  const filePath = path.join(root, 'bip-0039', 'english.txt');
  const text = await fs.readFile(filePath, 'utf-8');
  cached = parseWordlist(text);

  return cached;
}

export function parseWordlist(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
}
