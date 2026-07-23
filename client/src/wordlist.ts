let cached: string[] | undefined;

export async function loadEnglishWordlist(): Promise<string[]> {
  if (cached) return cached;

  const response = await fetch('/bip-0039/english.txt');
  if (!response.ok) {
    throw new Error(`Failed to load wordlist: ${response.status}`);
  }

  const text = await response.text();
  cached = text
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);

  return cached;
}
