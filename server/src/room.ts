import { WebSocket } from 'ws';
import type { ClipboardMeta, Member, WsMessage } from '../../shared/types.js';
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

interface ClientInfo {
  ws: WebSocket;
  thumbprint: string;
  publicKey: string;
  name: string;
  member: Member;
}

export class Room {
  id: string;
  clients = new Map<WebSocket, ClientInfo>();
  meta: ClipboardMeta | null = null;

  constructor(id: string) {
    this.id = id;
  }

  async join(ws: WebSocket, publicKey: string, name: string): Promise<void> {
    const thumbprint = publicKeyThumbprint(publicKey);
    let meta = await loadMeta(this.id);

    if (!meta) {
      meta = await createClipboard(this.id, publicKey, name || 'Owner');
    } else {
      const existing = meta.members.find((m) => m.publicKey === publicKey);
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

      if (!existing) {
        meta.members.push({
          publicKey,
          name: name || 'User',
          profile: 'user',
          approval: { kind: 'indefinite', expiresAt: null },
        });
        await saveMeta(this.id, meta);
      }
    }

    this.meta = meta;
    const member = meta.members.find((m) => m.publicKey === publicKey)!;
    const info: ClientInfo = { ws, thumbprint, publicKey, name: name || member.name, member };
    this.clients.set(ws, info);

    this.send(ws, {
      room: this.id,
      type: 'members',
      from: 'server',
      payload: meta.members,
    });

    this.broadcast(
      {
        room: this.id,
        type: 'member_joined',
        from: thumbprint,
        payload: { publicKey, name: info.name, profile: member.profile },
      },
      ws,
    );
  }

  leave(ws: WebSocket): boolean {
    const info = this.clients.get(ws);
    if (!info) return false;

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

    return this.clients.size === 0;
  }

  async handleMessage(ws: WebSocket, message: WsMessage): Promise<void> {
    const info = this.clients.get(ws);
    if (!info) return;

    switch (message.type) {
      case 'content': {
        await this.handleContent(ws, message.payload, info.thumbprint);
        break;
      }
      default: {
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

  send(ws: WebSocket, message: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
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

  async join(ws: WebSocket, roomId: string, publicKey: string, name: string): Promise<void> {
    this.cancelCleanup(roomId);

    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }

    this.wsToRoom.set(ws, roomId);
    await room.join(ws, publicKey, name);
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
