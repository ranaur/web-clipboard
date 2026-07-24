export type ClipboardPayloadType = 'text' | 'image' | 'file';

export interface ClipboardPayload {
  type: ClipboardPayloadType;
  data: string; // base64-encoded content
  filename?: string;
  mime?: string;
  timestamp: string;
}

export interface PublicKeyBundle {
  signPublicKey: string; // SPKI, base64
  encryptPublicKey: string; // SPKI, base64
}

export type Profile = 'owner' | 'user' | 'blocked';

export type ApprovalKind = 'once' | 'until' | 'indefinite';

export interface Member {
  publicKey: string; // sign public key SPKI base64
  encryptPublicKey: string; // encrypt public key SPKI base64
  name: string;
  profile: Profile;
  approval: {
    kind: ApprovalKind;
    expiresAt: string | null;
  };
}

export interface PendingRequest {
  publicKey: string;
  encryptPublicKey: string;
  name: string;
  requestedAt: string;
}

export interface ClipboardMeta {
  id: string;
  ownerPublicKey: string;
  ownerEncryptPublicKey: string;
  members: Member[];
  pendingRequests: PendingRequest[];
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
