import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { findProjectRoot } from './paths.js';
import { loadEnglishWordlist } from './wordlist.js';
import { clipboardExists, generateUniqueClipboardId, loadMeta } from './clipboard.js';
import { RoomManager } from './room.js';
import type { WsMessage } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = createServer(app);

app.use(express.json());

const roomManager = new RoomManager();
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', async (data) => {
    let message: WsMessage;
    try {
      message = JSON.parse(data.toString()) as WsMessage;
      if (!message || typeof message !== 'object') return;
    } catch {
      console.error('Received invalid JSON');
      return;
    }

    try {
      if (message.type === 'join') {
        const { room, payload } = message;
        const { publicKey, encryptPublicKey, name } = payload as {
          publicKey: string;
          encryptPublicKey: string;
          name?: string;
        };
        await roomManager.requestJoin(ws, room, publicKey, encryptPublicKey, name ?? '');
      } else if (message.type === 'leave') {
        await roomManager.leave(ws);
      } else {
        await roomManager.handleMessage(ws, message);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
      if (ws.readyState === 1) {
        ws.send(
          JSON.stringify({
            room: message.room,
            type: 'error',
            from: 'server',
            payload: { message: err instanceof Error ? err.message : 'Server error' },
          }),
        );
      }
    }
  });

  ws.on('close', async () => {
    console.log('WebSocket client disconnected');
    await roomManager.leave(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// Serve the BIP-39 wordlists to the client.
const rootDir = findProjectRoot();
app.use('/bip-0039', express.static(path.join(rootDir, 'bip-0039')));

app.post('/api/clipboard-id/generate', async (_req, res, next) => {
  try {
    const wordlist = await loadEnglishWordlist();
    const id = await generateUniqueClipboardId(wordlist);
    res.json({ id });
  } catch (err) {
    next(err);
  }
});

app.get('/api/clipboard/:id/exists', async (req, res, next) => {
  try {
    const exists = await clipboardExists(req.params.id);
    res.json({ id: req.params.id, exists });
  } catch (err) {
    next(err);
  }
});

app.get('/api/clipboard/:id/members', async (req, res, next) => {
  try {
    const meta = await loadMeta(req.params.id);
    res.json({
      id: req.params.id,
      members: meta?.members ?? [],
      pendingRequests: meta?.pendingRequests ?? [],
    });
  } catch (err) {
    next(err);
  }
});

// Serve the built client in production.
const clientDir = path.resolve(__dirname, '../../client');

app.use(express.static(clientDir));

app.get('*', (_req, res) => {
  res.sendFile(path.resolve(clientDir, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
