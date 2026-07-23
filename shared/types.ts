export type ClipboardPayloadType = 'text' | 'image' | 'file';

export interface ClipboardPayload {
  type: ClipboardPayloadType;
  data: string; // base64-encoded content
  filename?: string;
  mime?: string;
  timestamp: string;
}

export type Profile = 'owner' | 'user' | 'blocked';

export type ApprovalKind = 'once' | 'until' | 'indefinite';

export interface Member {
  publicKey: string;
  name: string;
  profile: Profile;
  approval: {
    kind: ApprovalKind;
    expiresAt: string | null;
  };
}

export interface ClipboardMeta {
  id: string;
  ownerPublicKey: string;
  members: Member[];
}

export interface EncryptedClipboardPayload {
  iv: string;
  ciphertext: string;
  timestamp?: string;
}

export interface WsMessage<T = unknown> {
  room: string;
  type: string;
  from: string;
  payload: T;
}
