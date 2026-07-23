# Distributed Clipboard

A cross-platform, browser-first distributed clipboard. Share text, images and files between devices using a three-word BIP-39 identifier. All cryptography runs in the client; the server only relays and stores encrypted blobs.

## Quick Start

```bash
npm install
npm run dev
```

This starts the Node/WebSocket server on `http://localhost:3000` and the Vite dev server on `http://localhost:5173` with `/ws` proxied to the server.

## Build & Run

```bash
npm run build      # compile server and bundle client to dist/
npm start          # run the production server from dist/server/src/index.js
```

## Scripts

- `npm run dev` — development with hot reload
- `npm run build` — production build
- `npm run start` — production server
- `npm run typecheck` — TypeScript type checking
- `npm run lint` — ESLint
- `npm run format` — Prettier formatting
- `npm run format:check` — Prettier check

## Project Structure

- `client/src/` — browser TypeScript application
- `server/src/` — Node.js relay and storage server
- `shared/` — shared TypeScript types
- `docs/` — architecture and design documents
- `data/` — runtime flat-file storage (gitignored)

See `docs/ARCHITECTURE.md`, `AGENTS.md` and `TODO.md` for more details.
