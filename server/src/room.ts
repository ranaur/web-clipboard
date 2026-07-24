import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ClipboardMeta, Member, PendingRequest, WsMessage } from '../../shared/types.js';
import {
  clipboardExists,
  createClipboard,
  deleteClipboard,
  loadMeta,
  publicKeyThumbprint,
  saveMeta,
  storeContent,
  wipeContent,
} from './clipboard.js';
import { verifySignature } from './crypto.js';

const CHALLENGE_TIMEOUT_MS = 60_000;

interface ClientInfo {
  ws: WebSocket;
  thumbprint: string;
  publicKey: string;
  encryptPublicKey: string;
  name: string;
  member: Member;
}

interface PendingClient {
  ws: WebSocket;
  thumbprint: string;
  publicKey: string;
  encryptPublicKey: string;
  name: string;
}

interface PendingChallenge {
  publicKey: string;
  encryptPublicKey: string;
  name: string;
  nonce: string;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

function generateNonce(): string {
  return randomBytes(32).toString('base64');
}

function isApprovalValid(member: Member): boolean {
  if (member.profile === 'blocked') return false;
  if (member.approval.kind === 'indefinite') return true;
  if (member.approval.kind === 'until') {
    return member.approval.expiresAt ? new Date(member.approval.expiresAt) > new Date() : false;
  }
  return false;
}

export class Room {
  id: string;
  clients = new Map<WebSocket, ClientInfo>();
  pendingClients = new Map<string, PendingClient>();
  challenges = new Map<WebSocket, PendingChallenge>();
  meta: ClipboardMeta | null = null;

  constructor(id: string) {
    this.id = id;
  }

  async requestJoin(
    ws: WebSocket,
    publicKey: string,
    encryptPublicKey: string,
    name: string,
  ): Promise<void> {
    if (!publicKey || !encryptPublicKey) {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'Missing public keys' },
      });
      return;
    }

    this.cancelChallenge(ws);
    const nonce = generateNonce();
    const timer = setTimeout(() => this.cancelChallenge(ws), CHALLENGE_TIMEOUT_MS);
    this.challenges.set(ws, {
      publicKey,
      encryptPublicKey,
      name,
      nonce,
      expiresAt: Date.now() + CHALLENGE_TIMEOUT_MS,
      timer,
    });

    this.send(ws, { room: this.id, type: 'challenge', from: 'server', payload: { nonce } });
  }

  async verifyJoin(ws: WebSocket, signature: string, nonce: string): Promise<void> {
    const challenge = this.challenges.get(ws);
    if (!challenge || challenge.nonce !== nonce) {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'Invalid challenge' },
      });
      ws.close(1008, 'invalid challenge');
      return;
    }

    this.cancelChallenge(ws);

    const valid = await verifySignature(challenge.publicKey, signature, nonce);
    if (!valid) {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'Invalid signature' },
      });
      ws.close(1008, 'invalid signature');
      return;
    }

    let meta = await loadMeta(this.id);
    const thumbprint = publicKeyThumbprint(challenge.publicKey);

    if (!meta) {
      meta = await createClipboard(
        this.id,
        challenge.publicKey,
        challenge.encryptPublicKey,
        challenge.name || 'Owner',
      );
    }

    const existing = meta.members.find((m) => m.publicKey === challenge.publicKey);

    if (existing?.profile === 'blocked') {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'Access denied' },
      });
      ws.close(1008, 'blocked');
      return;
    }

    if (existing && isApprovalValid(existing)) {
      this.meta = meta;
      const member = existing;
      const info: ClientInfo = {
        ws,
        thumbprint,
        publicKey: challenge.publicKey,
        encryptPublicKey: challenge.encryptPublicKey,
        name: challenge.name || member.name,
        member,
      };
      this.clients.set(ws, info);
      this.send(ws, {
        room: this.id,
        type: 'joined',
        from: 'server',
        payload: { profile: member.profile },
      });
      this.send(ws, { room: this.id, type: 'members', from: 'server', payload: meta.members });
      this.broadcast(
        {
          room: this.id,
          type: 'member_joined',
          from: thumbprint,
          payload: {
            publicKey: info.publicKey,
            encryptPublicKey: info.encryptPublicKey,
            name: info.name,
            profile: member.profile,
          },
        },
        ws,
      );
      return;
    }

    // Either a new member or an existing one without valid approval -> pending.
    const alreadyPending = meta.pendingRequests.find((p) => p.publicKey === challenge.publicKey);
    if (!alreadyPending) {
      const pending: PendingRequest = {
        publicKey: challenge.publicKey,
        encryptPublicKey: challenge.encryptPublicKey,
        name: challenge.name || 'User',
        requestedAt: new Date().toISOString(),
      };
      meta.pendingRequests.push(pending);
      await saveMeta(this.id, meta);
    }

    this.pendingClients.set(challenge.publicKey, {
      ws,
      thumbprint,
      publicKey: challenge.publicKey,
      encryptPublicKey: challenge.encryptPublicKey,
      name: challenge.name || 'User',
    });
    this.meta = meta;
    this.send(ws, {
      room: this.id,
      type: 'pending',
      from: 'server',
      payload: { message: 'Waiting for owner approval' },
    });
    this.broadcastToOwners({
      room: this.id,
      type: 'join_request',
      from: thumbprint,
      payload: {
        publicKey: challenge.publicKey,
        encryptPublicKey: challenge.encryptPublicKey,
        name: challenge.name || 'User',
      },
    });
  }

  async approve(
    ws: WebSocket,
    publicKey: string,
    kind: 'once' | 'until' | 'indefinite',
    expiresAt: string | null,
  ): Promise<void> {
    const info = this.clients.get(ws);
    if (!info || info.member.profile !== 'owner') {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'Only owners can approve' },
      });
      return;
    }

    const meta = this.meta ?? (await loadMeta(this.id));
    if (!meta) return;

    const pendingIndex = meta.pendingRequests.findIndex((p) => p.publicKey === publicKey);
    if (pendingIndex === -1) {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'No pending request found' },
      });
      return;
    }

    const pending = meta.pendingRequests[pendingIndex];
    meta.pendingRequests.splice(pendingIndex, 1);

    const existingMember = meta.members.find((m) => m.publicKey === publicKey);
    if (existingMember) {
      existingMember.profile = 'user';
      existingMember.approval = { kind, expiresAt };
    } else {
      meta.members.push({
        publicKey: pending.publicKey,
        encryptPublicKey: pending.encryptPublicKey,
        name: pending.name,
        profile: 'user',
        approval: { kind, expiresAt },
      });
    }

    this.meta = meta;
    await saveMeta(this.id, meta);
    this.broadcast({ room: this.id, type: 'members', from: 'server', payload: meta.members }, ws);

    // If the requester is currently connected, add them to the room now.
    const pendingClient = this.pendingClients.get(publicKey);
    if (pendingClient) {
      this.pendingClients.delete(publicKey);
      const member: Member = {
        publicKey: pendingClient.publicKey,
        encryptPublicKey: pendingClient.encryptPublicKey,
        name: pendingClient.name,
        profile: 'user',
        approval: { kind, expiresAt },
      };
      const clientInfo: ClientInfo = {
        ws: pendingClient.ws,
        thumbprint: pendingClient.thumbprint,
        publicKey: pendingClient.publicKey,
        encryptPublicKey: pendingClient.encryptPublicKey,
        name: pendingClient.name,
        member,
      };
      this.clients.set(pendingClient.ws, clientInfo);
      this.send(pendingClient.ws, {
        room: this.id,
        type: 'approved',
        from: 'server',
        payload: { kind, expiresAt },
      });
      this.send(pendingClient.ws, {
        room: this.id,
        type: 'members',
        from: 'server',
        payload: meta.members,
      });
      this.broadcast(
        {
          room: this.id,
          type: 'member_joined',
          from: pendingClient.thumbprint,
          payload: {
            publicKey: pendingClient.publicKey,
            encryptPublicKey: pendingClient.encryptPublicKey,
            name: pendingClient.name,
            profile: 'user',
          },
        },
        pendingClient.ws,
      );
    }
  }

  async reject(ws: WebSocket, publicKey: string): Promise<void> {
    const info = this.clients.get(ws);
    if (!info || info.member.profile !== 'owner') {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'Only owners can reject' },
      });
      return;
    }

    const meta = this.meta ?? (await loadMeta(this.id));
    if (!meta) return;

    meta.pendingRequests = meta.pendingRequests.filter((p) => p.publicKey !== publicKey);

    const member = meta.members.find((m) => m.publicKey === publicKey);
    if (member) {
      member.profile = 'blocked';
      member.approval = { kind: 'once', expiresAt: null };
    }

    this.meta = meta;
    await saveMeta(this.id, meta);
    this.broadcast({ room: this.id, type: 'members', from: 'server', payload: meta.members });

    const pending = this.pendingClients.get(publicKey);
    if (pending) {
      this.pendingClients.delete(publicKey);
      this.send(pending.ws, {
        room: this.id,
        type: 'rejected',
        from: 'server',
        payload: { message: 'Request rejected' },
      });
      pending.ws.close(1008, 'rejected');
      return;
    }

    for (const [clientWs, client] of this.clients) {
      if (client.publicKey === publicKey) {
        this.send(clientWs, {
          room: this.id,
          type: 'rejected',
          from: 'server',
          payload: { message: 'Request rejected' },
        });
        clientWs.close(1008, 'rejected');
        this.clients.delete(clientWs);
        break;
      }
    }
  }

  async changeProfile(ws: WebSocket, publicKey: string, profile: 'owner' | 'user'): Promise<void> {
    const info = this.clients.get(ws);
    if (!info || info.member.profile !== 'owner') {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'Only owners can change profiles' },
      });
      return;
    }

    if (publicKey === info.publicKey) {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'Cannot change your own profile' },
      });
      return;
    }

    const meta = this.meta ?? (await loadMeta(this.id));
    if (!meta) return;

    const member = meta.members.find((m) => m.publicKey === publicKey);
    if (!member) {
      this.send(ws, {
        room: this.id,
        type: 'error',
        from: 'server',
        payload: { message: 'Member not found' },
      });
      return;
    }

    if (profile === 'user' && member.profile === 'owner') {
      const otherOwners = meta.members.filter(
        (m) => m.profile === 'owner' && m.publicKey !== publicKey,
      );
      if (otherOwners.length === 0) {
        this.send(ws, {
          room: this.id,
          type: 'error',
          from: 'server',
          payload: { message: 'Cannot remove the last owner' },
        });
        return;
      }
    }

    member.profile = profile;
    this.meta = meta;
    await saveMeta(this.id, meta);
    this.broadcast({ room: this.id, type: 'members', from: 'server', payload: meta.members });
  }

  leave(ws: WebSocket): boolean {
    const challenge = this.challenges.get(ws);
    if (challenge) {
      clearTimeout(challenge.timer);
      this.challenges.delete(ws);
    }

    const info = this.clients.get(ws);
    if (info) {
      this.clients.delete(ws);
      this.broadcast(
        {
          room: this.id,
          type: 'member_left',
          from: info.thumbprint,
          payload: { publicKey: info.publicKey, name: info.name },
        },
        ws,
      );
    }

    for (const [publicKey, pending] of this.pendingClients) {
      if (pending.ws === ws) {
        this.pendingClients.delete(publicKey);
        break;
      }
    }

    return this.clients.size === 0;
  }

  async handleMessage(ws: WebSocket, message: WsMessage): Promise<void> {
    const info = this.clients.get(ws);

    switch (message.type) {
      case 'challenge_response': {
        const { signature, nonce } = message.payload as { signature: string; nonce: string };
        await this.verifyJoin(ws, signature, nonce);
        return;
      }
      case 'approve': {
        const { publicKey, kind, expiresAt } = message.payload as {
          publicKey: string;
          kind: 'once' | 'until' | 'indefinite';
          expiresAt?: string | null;
        };
        await this.approve(ws, publicKey, kind, expiresAt ?? null);
        return;
      }
      case 'reject': {
        const { publicKey } = message.payload as { publicKey: string };
        await this.reject(ws, publicKey);
        return;
      }
      case 'change_profile': {
        if (!info) return;
        const { publicKey, profile } = message.payload as {
          publicKey: string;
          profile: 'owner' | 'user';
        };
        await this.changeProfile(ws, publicKey, profile);
        return;
      }
      case 'content': {
        if (!info) return;
        await this.handleContent(ws, message.payload, info.thumbprint);
        return;
      }
      default: {
        if (!info) return;
        this.broadcast({ ...message, from: info.thumbprint }, ws);
      }
    }
  }

  private async handleContent(ws: WebSocket, payload: unknown, from: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const storedPayload = { ...(payload as object), timestamp };
    await storeContent(
      this.id,
      storedPayload as { iv: string; ciphertext: string; timestamp: string },
    );
    this.broadcast({ room: this.id, type: 'content', from, payload: storedPayload }, ws);
  }

  broadcast(message: WsMessage, exclude?: WebSocket): void {
    const text = JSON.stringify(message);
    for (const [clientWs] of this.clients) {
      if (clientWs !== exclude && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(text);
      }
    }
  }

  broadcastToOwners(message: WsMessage): void {
    const text = JSON.stringify(message);
    for (const [clientWs, info] of this.clients) {
      if (info.member.profile === 'owner' && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(text);
      }
    }
  }

  send(ws: WebSocket, message: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private cancelChallenge(ws: WebSocket): void {
    const challenge = this.challenges.get(ws);
    if (challenge) {
      clearTimeout(challenge.timer);
      this.challenges.delete(ws);
    }
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();
  wsToRoom = new Map<WebSocket, string>();
  cleanupTimers = new Map<string, NodeJS.Timeout>();
  ttlMs: number;

  constructor() {
    this.ttlMs = Number(process.env.CLIPBOARD_TTL_MS) || 24 * 60 * 60 * 1000;
  }

  async requestJoin(
    ws: WebSocket,
    roomId: string,
    publicKey: string,
    encryptPublicKey: string,
    name: string,
  ): Promise<void> {
    this.cancelCleanup(roomId);

    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }

    this.wsToRoom.set(ws, roomId);
    await room.requestJoin(ws, publicKey, encryptPublicKey, name);
  }

  async leave(ws: WebSocket): Promise<void> {
    const roomId = this.wsToRoom.get(ws);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    const empty = room.leave(ws);
    this.wsToRoom.delete(ws);

    if (empty) {
      this.rooms.delete(roomId);
      await wipeContent(roomId);
      this.scheduleCleanup(roomId);
    }
  }

  async handleMessage(ws: WebSocket, message: WsMessage): Promise<void> {
    const roomId = this.wsToRoom.get(ws);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    await room.handleMessage(ws, message);
  }

  getMembers(roomId: string): Member[] {
    return this.rooms.get(roomId)?.meta?.members ?? [];
  }

  private scheduleCleanup(roomId: string): void {
    if (this.cleanupTimers.has(roomId)) return;

    const timer = setTimeout(async () => {
      this.cleanupTimers.delete(roomId);
      const exists = await clipboardExists(roomId);
      if (exists) {
        await deleteClipboard(roomId);
      }
    }, this.ttlMs);

    this.cleanupTimers.set(roomId, timer);
  }

  private cancelCleanup(roomId: string): void {
    const timer = this.cleanupTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(roomId);
    }
  }
}
