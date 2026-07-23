import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { findProjectRoot } from './paths.js';
import { loadEnglishWordlist } from './wordlist.js';
import { clipboardExists, generateUniqueClipboardId } from './clipboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = createServer(app);

app.use(express.json());

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', (data) => {
    console.log('Received:', data.toString());
    // Echo back for bootstrap verification.
    ws.send(data);
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
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

// Serve the built client in production.
const clientDir = path.resolve(__dirname, '../../client');

app.use(express.static(clientDir));

app.get('*', (_req, res) => {
  res.sendFile(path.resolve(clientDir, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
