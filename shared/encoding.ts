export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.slice().buffer as ArrayBuffer;
}

export function stringToBuffer(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  return encoded.slice().buffer as ArrayBuffer;
}

export function bufferToString(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}
