# Distributed Clipboard — Architecture & Tech Stack

This document describes the architecture and technology choices for the Distributed Clipboard project described in the original requirements.

## Project Goal

A cross-platform, distributed clipboard. Any connected client can send text, images or files to other clients that share the same clipboard identifier. The server is only a thin relay and storage medium — it never performs cryptographic operations on plaintext.

## Core Principles

1. **Client-side cryptography only** — key generation, signing, encryption and decryption all happen in the browser.
2. **Minimal server** — the server routes messages and stores encrypted blobs; it has no access to the shared secret.
3. **Flat-file storage** — each clipboard uses a dedicated directory. The only data kept after the last client disconnects is metadata: the clipboard identifier, allowed public keys, profiles and approvals.
4. **Cross-platform** — the first version runs in a browser. Native wrappers can be added later.

## High-Level Components

```
+-----------------+      WebSocket      +------------------+
|  Browser client |<------------------->|  Node.js server  |
|  (TypeScript)   |   encrypted relay   |  (relay + files) |
+-----------------+                     +------------------+
       |                                        |
       | reads/writes                           | flat-file
       v                                        v
  Clipboard API                          data/<clipboard-id>/
  IndexedDB (keys)                         encrypted JSON
```

### Client (Browser)

- Written in **TypeScript** with native Web APIs.
- Served as a single-page application from the server.
- Uses the **Web Crypto API** for all cryptography.
- Stores identity keys in **IndexedDB** (optionally password-protected).
- Communicates with the server over **WebSocket**.
- Optionally interacts with the **Clipboard API** for system clipboard integration.

### Server (Node.js)

- **Express** serves the static client build.
- **`ws`** handles WebSocket connections.
- Manages clipboard "rooms", member presence, join requests and approval state.
- Persists metadata and encrypted content as flat files.
- Deletes clipboard data when the last member disconnects, retaining only metadata for a configurable TTL before recycling the directory.

### Storage Layout

```
data/
  <clipboard-id>/          # 3 BIP-39 words joined by dashes, e.g. abandon-ability-able
    meta.json              # unencrypted: name, owner pubkey, member list, approvals
    content/
      20260723-185230.json # encrypted clipboard payload (AES-GCM)
      ...
```

`meta.json` may contain:

```json
{
  "id": "abandon-ability-able",
  "ownerPublicKey": "...",
  "members": [
    {
      "publicKey": "...",
      "profile": "owner|user|blocked",
      "approval": { "kind": "once|until|indefinite", "expiresAt": null }
    }
  ]
}
```

Encrypted content files use the layout:

```json
{
  "iv": "base64",
  "ciphertext": "base64",
  "tag": "base64"
}
```

## Identity & Access Control

### Machine Identity

- On first load, the client creates a public/private key pair.
- If the platform exposes a cryptographic API (e.g., WebAuthn, OS key store via a future native bridge), it should be used. Otherwise the pair is created in JavaScript and stored in IndexedDB.
- The private key can optionally be protected with a password-derived wrapping key.
- The machine name and user name are collected from the environment and editable by the user.

### Clipboard Identifier

- A clipboard is identified by a random phrase of three BIP-0039 words (e.g., `abandon-ability-able`).
- The wordlist is embedded or fetched at build time.

### Join Flow

1. Client connects to WebSocket.
2. Client sends its public key and requested clipboard id.
3. Server issues a private/public key challenge: a random nonce.
4. Client signs the nonce and returns the signature.
5. Server verifies the signature.
6. If the public key is not known, the owner must approve the request.
7. If approved, the joining client requests the shared secret.
8. A connected client encrypts the shared secret with the asker's public key and sends it.

### Profiles

- `owner` — can approve/reject members, change profiles, has indefinite access.
- `user` — can read/write clipboard content, subject to approval limits.
- `blocked` — cannot connect or receive data.
- An owner cannot change their own profile.

## Cryptography

| Purpose | Mechanism |
|--------|-----------|
| Identity key pair | RSA-OAEP 2048 (encryption) + RSASSA-PKCS1-v1_5 2048 (signing) or equivalent ECDSA/ECDH P-256 pair |
| Signing challenges | RSASSA-PKCS1-v1_5 / ECDSA with SHA-256 |
| Shared secret | 256-bit random value |
| Clipboard content encryption | AES-256-GCM |
| Shared secret distribution | Encrypted with the asker's public key |
| Optional key password | PBKDF2-HMAC-SHA-256 derived AES-256-GCM wrapping key |

All operations use the Web Crypto API (`crypto.subtle`) in the browser.

## Clipboard Data & History

- The current clipboard payload is broadcast to all connected clients, encrypted with the shared secret.
- The server stores a history of payloads, each in its own file.
- History is bounded by:
  - a maximum number of entries, and
  - a maximum retention time.
- Files, images and text are represented as a single JSON structure with a `type` field and Base64-encoded data.
- When the last client disconnects, the `content/` directory is removed. Only `meta.json` remains until its TTL expires.

## Communication Protocol

WebSocket messages are JSON envelopes carrying an encrypted payload:

```json
{
  "room": "abandon-ability-able",
  "type": "content|request_secret|share_secret|approval|join|leave|...",
  "from": "<public-key-thumbprint>",
  "payload": "<base64-encrypted-ciphertext>"
}
```

The server may also send plain control messages for join requests and approvals, but it never sees plaintext content or the shared secret.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (client and server) |
| Build/bundle | esbuild or Vite |
| Server runtime | Node.js 20+ |
| HTTP server | Express |
| WebSocket | `ws` |
| Storage | Filesystem (flat files) |
| Client storage | IndexedDB (via `idb` wrapper) |
| Crypto | Web Crypto API in client; Node.js `crypto` on server for non-secret helpers |
| BIP-39 wordlist | Embedded wordlist or `bip39` / `@scure/bip39` package |
| System clipboard | Browser Clipboard API first; native wrappers later |
| Testing | vitest (client), Node Test Runner (server) |
| Lint/format | ESLint + Prettier |
| Container | Optional Dockerfile |

## Deployment Options

1. **Self-hosted**: run `npm install` and `npm start` on a server with Node.js.
2. **Docker**: container runs the Node server and serves static client files.
3. **Cloud**: deploy the Docker container to Fly.io, Railway, etc.

The client can also be built as a static site and served by any HTTP server, as long as the WebSocket endpoint is available at the same origin or configured explicitly.

## Phases / Future Work

1. **Browser MVP** — fully functional web client with all core features.
2. **System clipboard bridge** — optional native browser permissions; later Electron / Tauri / Capacitor wrappers for deeper integration.
3. **Offline / peer-to-peer** — investigate WebRTC data channels to reduce server relay.
4. **Key rotation & forward secrecy** — rotate shared secret periodically; re-encrypt history lazily.
