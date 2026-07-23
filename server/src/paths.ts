import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function findProjectRoot(): string {
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  let current = startDir;

  for (let depth = 0; depth < 8; depth++) {
    if (fs.existsSync(path.join(current, 'bip-0039', 'english.txt'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'bip-0039', 'english.txt'))) {
    return cwd;
  }

  throw new Error('Could not locate project root (bip-0039/english.txt not found)');
}
