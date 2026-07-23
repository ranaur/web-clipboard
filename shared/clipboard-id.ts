export const WORDS_PER_ID = 3;

export type RandomInt = (max: number) => number;

export function parseClipboardId(id: string): string[] {
  return normalizeClipboardId(id).split('-');
}

export function normalizeClipboardId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function validateWord(word: string, wordlist: string[]): boolean {
  return wordlist.includes(word.trim().toLowerCase());
}

export function validateClipboardId(id: string, wordlist: string[]): boolean {
  const words = parseClipboardId(id);
  if (words.length !== WORDS_PER_ID) return false;
  if (new Set(words).size !== words.length) return false;
  return words.every((w) => validateWord(w, wordlist));
}

export function generateClipboardId(wordlist: string[], randomInt?: RandomInt): string {
  if (wordlist.length < WORDS_PER_ID) {
    throw new Error('Wordlist is too small to generate an identifier');
  }

  const rng = randomInt ?? defaultRandomInt;
  const words: string[] = [];

  while (words.length < WORDS_PER_ID) {
    const word = wordlist[rng(wordlist.length)];
    if (!words.includes(word)) {
      words.push(word);
    }
  }

  return words.join('-');
}

function defaultRandomInt(max: number): number {
  return Math.floor(Math.random() * max);
}
