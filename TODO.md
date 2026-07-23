# Implementation TODO — Distributed Clipboard

## 1. Repository Bootstrap

- [x] Initialize `package.json` with `"type": "module"` and workspace/project scripts.
- [x] Set up TypeScript config (`tsconfig.json`) for client and server.
- [x] Configure build tool (Vite or esbuild) and dev server.
- [x] Add lint/format tooling: ESLint, Prettier.
- [x] Create initial directory structure: `client/`, `server/`, `shared/`, `docs/`, `data/` (gitignored).
- [x] Add `.gitignore` entries for `node_modules/`, `dist/`, `data/`, and environment files.
- [x] Add basic README with setup and run instructions.

## 2. BIP-39 Clipboard Identifier

- [x] Embed the BIP-0039 English wordlist from `bip-0039/` .
- [x] Implement `generateClipboardId()` returning three random words joined by dashes.
- [x] Implement validation/normalization of clipboard ids.
- [x] Add collision detection (server rejects duplicate id on creation if directory exists).

## 3. Client-Side Cryptography

- [x] Wrap `crypto.subtle` in a `CryptoClient` module.
- [x] Generate RSA-OAEP / RSASSA-PKCS1-v1_5 key pair (or ECDSA/ECDH P-256 pair) for identity.
- [x] Export public key to SPKI and import peer public keys.
- [x] Sign challenge nonces with the private key.
- [x] Verify signatures from peers.
- [x] Generate a 256-bit random shared secret.
- [x] Encrypt/decrypt the shared secret with a peer's public key and the local private key.
- [x] Encrypt/decrypt clipboard content with AES-256-GCM and an exported/imported key.
- [x] Optional: password-protect the local private key with PBKDF2 + AES-256-GCM.

## 4. Local Key & Identity Storage

- [x] Store identity key pair in IndexedDB (use `idb` for a simpler API).
- [x] Store machine name and user name locally.
- [x] On first load, prompt for machine/user name and optional password.
- [x] Load identity on app startup; if a password is set, prompt to unlock the private key.

## 5. Server Core

- [ ] Create Express app that serves the built client.
- [ ] Add `ws` WebSocket server at `/ws`.
- [ ] Implement room management: join, leave, and list members by clipboard id.
- [ ] Load/create `data/<clipboard-id>/meta.json` on first join.
- [ ] Forward encrypted payloads to all members of a room.
- [ ] Track active connections; when the last member leaves, wipe the `content/` directory.
- [ ] Keep `meta.json` for a configurable TTL before deleting the clipboard directory.

## 6. Join & Approval Flow

- [ ] Client sends `join` message with clipboard id and public key.
- [ ] Server sends `challenge` nonce.
- [ ] Client responds with `challenge_response` signature.
- [ ] Server verifies signature and checks member list in `meta.json`.
- [ ] If public key is unknown, mark as pending and notify owner(s).
- [ ] Owner UI shows pending requests; owner can approve/reject.
- [ ] Approval can be `once`, `until <date>`, or `indefinite`.
- [ ] Blocked public keys are rejected immediately.
- [ ] Owner can change a member's profile (`user` <-> `owner`), but not their own.

## 7. Shared Secret Distribution

- [ ] First client in an empty clipboard generates the shared secret.
- [ ] When a new member is approved, an existing member sends `share_secret` encrypted with the new member's public key.
- [ ] New member decrypts and stores the shared secret locally for the session.
- [ ] Implement shared secret rotation: generate new secret, re-encrypt for current members, and use it for subsequent content.

## 8. Clipboard Content Sync

- [ ] UI displays current clipboard type (`text`, `image`, `file`) and contents where feasible.
- [ ] Client reads text from the system clipboard when enabled (`Clipboard API`).
- [ ] Client writes received text to the system clipboard when enabled.
- [ ] File drops/copies are read into memory and converted to a Base64 payload.
- [ ] Payloads are encrypted with the shared secret before being sent to the server.
- [ ] Server stores encrypted payload in `data/<id>/content/<timestamp>.json` and broadcasts to room.
- [ ] Receiving clients decrypt and render the payload.

## 9. History & Retention

- [ ] Maintain an in-memory list of recent clipboard entries.
- [ ] Load recent history files on connect (within retention window).
- [ ] Enforce maximum history entry count.
- [ ] Enforce maximum history retention time.
- [ ] Periodically delete expired history files on the server.

## 10. UI / User Experience

- [ ] Landing screen: create new clipboard or connect to existing one.
- [ ] Settings screen: edit machine/user name, set/change password, export public key.
- [ ] Clipboard view: show current content, accept new paste/drag, toggle system clipboard integration.
- [ ] Owner panel: list members, approve pending, change profile, block users.
- [ ] Responsive layout for desktop and mobile browsers.

## 11. Cross-Platform Considerations

- [ ] Ensure Clipboard API usage degrades gracefully on browsers without permission.
- [ ] Test on Windows, macOS, Linux, Android, iOS browsers.
- [ ] Document native wrapper options: Electron/Tauri for desktop, Capacitor for mobile.

## 12. Testing

- [ ] Unit tests for BIP-39 generation and normalization.
- [ ] Unit tests for encrypt/decrypt and sign/verify with known vectors.
- [ ] Integration tests for server room join/leave.
- [ ] End-to-end test: two clients join the same clipboard and exchange text.

## 13. Deployment & Packaging

- [ ] Add `Dockerfile` and `.dockerignore`.
- [ ] Add `docker-compose.yml` for local self-hosting.
- [ ] Document environment variables (port, data directory, TTLs, history limits).
- [ ] Add GitHub Actions workflow for lint, test, and build.

## 14. Documentation

- [ ] Update README with build/run instructions.
- [ ] Add API/WebSocket message reference in `docs/protocol.md`.
- [ ] Add security notes in `docs/security.md`.
- [ ] Keep `AGENTS.md` and `TODO.md` in sync as the project evolves.
