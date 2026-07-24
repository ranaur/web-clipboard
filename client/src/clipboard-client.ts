import { arrayBufferToBase64, base64ToArrayBuffer } from '../../shared/encoding.js';
import type { Member, PendingRequest, WsMessage } from '../../shared/types.js';
import { CryptoClient } from './crypto-client.js';
import type { Identity } from './identity-store.js';

export type ClipboardState =
  'connecting' | 'challenge' | 'pending' | 'joined' | 'rejected' | 'closed' | 'error';

export interface ClipboardClientCallbacks {
  onStateChange?: (state: ClipboardState) => void;
  onMembers?: (members: Member[]) => void;
  onPendingRequests?: (requests: PendingRequest[]) => void;
  onJoinRequest?: (request: PendingRequest) => void;
  onContent?: (payload: unknown) => void;
  onError?: (message: string) => void;
}

export class ClipboardClient {
  private ws: WebSocket | null = null;
  readonly roomId: string;
  private cryptoClient: CryptoClient;
  private identity: Identity;
  private callbacks: ClipboardClientCallbacks;
  private _state: ClipboardState = 'connecting';

  members: Member[] = [];
  pendingRequests: PendingRequest[] = [];
  isOwner = false;
  private mySignPublicKey: string | null = null;
  private sharedSecretRaw: ArrayBuffer | null = null;
  private sharedSecretKey: CryptoKey | null = null;

  constructor(
    roomId: string,
    cryptoClient: CryptoClient,
    identity: Identity,
    callbacks: ClipboardClientCallbacks = {},
  ) {
    this.roomId = roomId;
    this.cryptoClient = cryptoClient;
    this.identity = identity;
    this.callbacks = callbacks;
  }

  get state(): ClipboardState {
    return this._state;
  }

  get myPublicKey(): string | null {
    return this.mySignPublicKey;
  }

  get hasSharedSecret(): boolean {
    return this.sharedSecretKey !== null;
  }

  private async ensureSharedSecret(): Promise<void> {
    if (this.sharedSecretKey) return;
    const raw = CryptoClient.generateSharedSecret();
    this.sharedSecretRaw = new Uint8Array(raw).buffer.slice(0, 32);
    this.sharedSecretKey = await CryptoClient.importContentKey(this.sharedSecretRaw);
  }

  private async setSharedSecret(raw: ArrayBuffer): Promise<void> {
    this.sharedSecretRaw = raw;
    this.sharedSecretKey = await CryptoClient.importContentKey(raw);
  }

  private async encryptSharedSecretFor(encryptPublicKey: string): Promise<string | null> {
    if (!this.sharedSecretRaw) return null;
    const encrypted = await this.cryptoClient.encryptSharedSecret(
      this.sharedSecretRaw,
      encryptPublicKey,
    );
    return arrayBufferToBase64(encrypted);
  }

  async encryptContent(plaintext: ArrayBuffer): Promise<{ iv: string; ciphertext: string }> {
    if (!this.sharedSecretKey) throw new Error('No shared secret');
    return CryptoClient.encryptContent(plaintext, this.sharedSecretKey);
  }

  async decryptContent(iv: string, ciphertext: string): Promise<ArrayBuffer> {
    if (!this.sharedSecretKey) throw new Error('No shared secret');
    return CryptoClient.decryptContent(iv, ciphertext, this.sharedSecretKey);
  }

  private setState(state: ClipboardState): void {
    this._state = state;
    this.callbacks.onStateChange?.(state);
  }

  connect(serverUrl?: string): void {
    if (this.ws) return;

    if (serverUrl) {
      this.ws = new WebSocket(serverUrl);
    } else {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${location.host}/ws`);
    }

    this.ws.addEventListener('open', () => {
      this.sendJoin();
    });

    this.ws.addEventListener('message', (event) => {
      this.handleMessage(event.data as string);
    });

    this.ws.addEventListener('close', () => {
      this.setState('closed');
      this.ws = null;
    });

    this.ws.addEventListener('error', () => {
      this.setState('error');
      this.callbacks.onError?.('WebSocket error');
    });
  }

  private async sendJoin(): Promise<void> {
    const publicKeys = await this.cryptoClient.getPublicKeys();
    this.mySignPublicKey = publicKeys.signPublicKey;
    this.send({
      room: this.roomId,
      type: 'join',
      from: '',
      payload: {
        publicKey: publicKeys.signPublicKey,
        encryptPublicKey: publicKeys.encryptPublicKey,
        name: this.identity.userName,
      },
    });
  }

  private async handleMessage(data: string): Promise<void> {
    let message: WsMessage;
    try {
      message = JSON.parse(data) as WsMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case 'challenge': {
        this.setState('challenge');
        const { nonce } = message.payload as { nonce: string };
        const signature = await this.cryptoClient.signChallengeBase64(nonce);
        this.send({
          room: this.roomId,
          type: 'challenge_response',
          from: '',
          payload: { nonce, signature },
        });
        break;
      }
      case 'joined': {
        this.setState('joined');
        break;
      }
      case 'pending': {
        this.setState('pending');
        break;
      }
      case 'approved': {
        this.setState('joined');
        break;
      }
      case 'rejected': {
        this.setState('rejected');
        this.callbacks.onError?.('Join request rejected');
        break;
      }
      case 'members': {
        this.members = message.payload as Member[];
        this.isOwner = this.mySignPublicKey
          ? this.members.some((m) => m.profile === 'owner' && m.publicKey === this.mySignPublicKey)
          : false;
        if (this.isOwner) {
          await this.ensureSharedSecret();
        }
        this.callbacks.onMembers?.(this.members);
        break;
      }
      case 'request_share_secret': {
        const { targetEncryptPublicKey } = message.payload as {
          targetPublicKey: string;
          targetEncryptPublicKey: string;
        };
        const encryptedSecret = await this.encryptSharedSecretFor(targetEncryptPublicKey);
        if (encryptedSecret) {
          const { targetPublicKey } = message.payload as { targetPublicKey: string };
          this.send({
            room: this.roomId,
            type: 'share_secret',
            from: '',
            payload: { toPublicKey: targetPublicKey, encryptedSecret },
          });
        }
        break;
      }
      case 'share_secret': {
        const { encryptedSecret } = message.payload as { encryptedSecret: string };
        const raw = await this.cryptoClient.decryptSharedSecret(
          base64ToArrayBuffer(encryptedSecret),
        );
        await this.setSharedSecret(raw);
        break;
      }
      case 'join_request': {
        const request = message.payload as PendingRequest;
        this.callbacks.onJoinRequest?.(request);
        break;
      }
      case 'content': {
        this.callbacks.onContent?.(message.payload);
        break;
      }
      case 'error': {
        const { message: errorMessage } = message.payload as { message: string };
        this.callbacks.onError?.(errorMessage);
        break;
      }
    }
  }

  approve(
    publicKey: string,
    kind: 'once' | 'until' | 'indefinite',
    expiresAt: string | null,
  ): void {
    this.send({
      room: this.roomId,
      type: 'approve',
      from: '',
      payload: { publicKey, kind, expiresAt },
    });
  }

  reject(publicKey: string): void {
    this.send({
      room: this.roomId,
      type: 'reject',
      from: '',
      payload: { publicKey },
    });
  }

  changeProfile(publicKey: string, profile: 'owner' | 'user'): void {
    this.send({
      room: this.roomId,
      type: 'change_profile',
      from: '',
      payload: { publicKey, profile },
    });
  }

  sendContent(payload: unknown): void {
    this.send({
      room: this.roomId,
      type: 'content',
      from: '',
      payload,
    });
  }

  async rotateSecret(): Promise<void> {
    const raw = CryptoClient.generateSharedSecret();
    this.sharedSecretRaw = new Uint8Array(raw).buffer.slice(0, 32);
    this.sharedSecretKey = await CryptoClient.importContentKey(this.sharedSecretRaw);

    for (const member of this.members) {
      if (member.publicKey === this.mySignPublicKey) continue;
      const encryptedSecret = await this.encryptSharedSecretFor(member.encryptPublicKey);
      if (encryptedSecret) {
        this.send({
          room: this.roomId,
          type: 'share_secret',
          from: '',
          payload: { toPublicKey: member.publicKey, encryptedSecret },
        });
      }
    }
  }

  private send(message: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
