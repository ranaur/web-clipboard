import './style.css';
import { CryptoClient } from './crypto-client.js';
import { ClipboardClient } from './clipboard-client.js';
import {
  createIdentity,
  loadIdentity,
  restoreUnprotectedIdentity,
  unlockIdentity,
  type Identity,
} from './identity-store.js';
import type { Member, PendingRequest } from '../../shared/types.js';

let client: CryptoClient | undefined;
let identity: Identity | undefined;
let clipboardClient: ClipboardClient | undefined;

async function getSystemInfo(): Promise<{ machineName: string; userName: string }> {
  const machineName =
    (typeof navigator !== 'undefined' && (await getDeviceName())) || 'Unknown device';
  const userName = 'Anonymous';
  return { machineName, userName };
}

async function getDeviceName(): Promise<string> {
  const anyNav = navigator as Navigator & { userAgentData?: { platform: string; model?: string } };
  if (anyNav.userAgentData) {
    return anyNav.userAgentData.model || anyNav.userAgentData.platform;
  }
  return navigator.platform;
}

function renderSetupForm(defaultMachineName: string, defaultUserName: string): void {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <h1>Distributed Clipboard</h1>
    <h2>Set up this device</h2>
    <form id="setup-form">
      <label>
        Device name
        <input type="text" id="machine-name" value="${escapeHtml(defaultMachineName)}" required />
      </label>
      <label>
        Your name
        <input type="text" id="user-name" value="${escapeHtml(defaultUserName)}" required />
      </label>
      <label>
        Password (optional)
        <input type="password" id="password" placeholder="Leave blank for no password" />
      </label>
      <button type="submit">Create identity</button>
    </form>
    <p class="hint">A private/public key pair will be generated in your browser.</p>
  `;

  const form = document.getElementById('setup-form') as HTMLFormElement;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const machineName = (document.getElementById('machine-name') as HTMLInputElement).value;
    const userName = (document.getElementById('user-name') as HTMLInputElement).value;
    const password = (document.getElementById('password') as HTMLInputElement).value || undefined;

    try {
      const result = await createIdentity(machineName, userName, password);
      client = result.client;
      identity = result.identity;
      renderMain();
    } catch (err) {
      alert(`Failed to create identity: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function renderUnlockForm(): void {
  const app = document.getElementById('app');
  if (!app || !identity) return;

  const currentIdentity = identity;

  app.innerHTML = `
    <h1>Distributed Clipboard</h1>
    <h2>Welcome back, ${escapeHtml(currentIdentity.userName)}</h2>
    <form id="unlock-form">
      <label>
        Password
        <input type="password" id="password" required />
      </label>
      <button type="submit">Unlock</button>
    </form>
  `;

  const form = document.getElementById('unlock-form') as HTMLFormElement;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = (document.getElementById('password') as HTMLInputElement).value;

    try {
      client = await unlockIdentity(currentIdentity, password);
      renderMain();
    } catch (err) {
      alert(`Unlock failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

async function renderMain(): Promise<void> {
  const app = document.getElementById('app');
  if (!app || !client || !identity) return;

  const publicKeys = await client.getPublicKeys();
  const publicKeyPreview = publicKeys.signPublicKey.slice(0, 24) + '...';

  app.innerHTML = `
    <h1>Distributed Clipboard</h1>
    <div class="identity-card">
      <p><strong>Device:</strong> ${escapeHtml(identity.machineName)}</p>
      <p><strong>User:</strong> ${escapeHtml(identity.userName)}</p>
      <p><strong>Public key:</strong> ${escapeHtml(publicKeyPreview)}</p>
    </div>
    <div class="actions">
      <button id="create-clipboard">Create a new clipboard</button>
      <button id="connect-clipboard">Connect to existing clipboard</button>
    </div>
    <div id="room-container"></div>
  `;

  document.getElementById('create-clipboard')?.addEventListener('click', createClipboard);
  document.getElementById('connect-clipboard')?.addEventListener('click', () => {
    const id = prompt('Enter the 3-word clipboard identifier:');
    if (id) connectClipboard(id);
  });
}

async function createClipboard(): Promise<void> {
  try {
    const response = await fetch('/api/clipboard-id/generate');
    const { id } = (await response.json()) as { id: string };
    connectClipboard(id);
  } catch (err) {
    alert(`Failed to create clipboard: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function connectClipboard(roomId: string): void {
  if (!client || !identity) return;
  if (clipboardClient) {
    clipboardClient.close();
  }

  const roomContainer = document.getElementById('room-container');
  if (roomContainer) {
    roomContainer.innerHTML = `<p>Connecting to <code>${escapeHtml(roomId)}</code>...</p>`;
  }

  clipboardClient = new ClipboardClient(roomId, client, identity, {
    onStateChange: (state) => renderRoomState(state, roomId),
    onMembers: (members) => renderMembers(members),
    onJoinRequest: () => renderPendingRequests(),
    onError: (message) => {
      console.error('Clipboard error:', message);
      const el = document.getElementById('room-error');
      if (el) el.textContent = message;
    },
  });

  clipboardClient.connect();
}

function renderRoomState(state: string, roomId: string): void {
  const container = document.getElementById('room-container');
  if (!container) return;

  const stateClass =
    state === 'joined' ? 'success' : state === 'error' || state === 'rejected' ? 'error' : '';
  container.innerHTML = `
    <div class="room-card">
      <p><strong>Room:</strong> <code>${escapeHtml(roomId)}</code></p>
      <p class="${stateClass}"><strong>State:</strong> ${escapeHtml(state)}</p>
      <p id="room-error" class="error"></p>
      <div id="members-section"></div>
      <div id="pending-section"></div>
    </div>
  `;
}

function renderMembers(members: Member[]): void {
  const section = document.getElementById('members-section');
  if (!section || !clipboardClient) return;

  const isOwner = clipboardClient.isOwner;
  const myKey = clipboardClient.myPublicKey;

  const list = members
    .map((m) => {
      const canChange = isOwner && m.publicKey !== myKey;
      const button = canChange
        ? `<button class="profile-toggle" data-public-key="${escapeHtml(m.publicKey)}" data-profile="${m.profile === 'owner' ? 'user' : 'owner'}">Make ${m.profile === 'owner' ? 'user' : 'owner'}</button>`
        : '';
      return `
        <li data-public-key="${escapeHtml(m.publicKey)}">
          ${escapeHtml(m.name)} (${m.profile})
          ${m.approval.kind === 'until' ? ` until ${escapeHtml(m.approval.expiresAt || '')}` : ''}
          ${button}
        </li>
      `;
    })
    .join('');

  section.innerHTML = `
    <h3>Members</h3>
    <ul>${list}</ul>
    ${isOwner ? `<button id="rotate-secret">Rotate shared secret</button>` : ''}
    <p>Shared secret: ${clipboardClient.hasSharedSecret ? 'ready' : 'missing'}</p>
  `;

  document.getElementById('rotate-secret')?.addEventListener('click', () => {
    clipboardClient?.rotateSecret();
  });

  section.querySelectorAll('.profile-toggle').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const publicKey = target.getAttribute('data-public-key')!;
      const profile = target.getAttribute('data-profile') as 'owner' | 'user';
      clipboardClient?.changeProfile(publicKey, profile);
    });
  });

  renderPendingRequests();
}

function renderPendingRequests(): void {
  const section = document.getElementById('pending-section');
  if (!section || !clipboardClient || !clipboardClient.isOwner) {
    if (section) section.innerHTML = '';
    return;
  }

  // Pending requests are kept in meta on the server; poll the members endpoint to refresh.
  fetch(`/api/clipboard/${encodeURIComponent(clipboardClient.roomId)}/members`)
    .then((res) => res.json())
    .then(
      ({ members, pendingRequests }: { members: Member[]; pendingRequests?: PendingRequest[] }) => {
        clipboardClient!.members = members;
        const requests = pendingRequests ?? [];
        if (requests.length === 0) {
          section.innerHTML = '';
          return;
        }

        const list = requests
          .map(
            (req) => `
            <li data-public-key="${escapeHtml(req.publicKey)}">
              <span>${escapeHtml(req.name)}</span>
              <select class="approval-kind">
                <option value="indefinite">Indefinite</option>
                <option value="once">Once</option>
                <option value="until">Until</option>
              </select>
              <input type="datetime-local" class="approval-expires" />
              <button class="approve-btn">Approve</button>
              <button class="reject-btn">Reject</button>
            </li>
          `,
          )
          .join('');

        section.innerHTML = `<h3>Pending requests</h3><ul>${list}</ul>`;

        section.querySelectorAll('.approve-btn').forEach((btn) => {
          btn.addEventListener('click', (event) => {
            const li = (event.target as HTMLElement).closest('li');
            if (!li) return;
            const publicKey = li.getAttribute('data-public-key')!;
            const kind = (li.querySelector('.approval-kind') as HTMLSelectElement).value as
              'once' | 'until' | 'indefinite';
            const expires =
              (li.querySelector('.approval-expires') as HTMLInputElement).value || null;
            clipboardClient?.approve(publicKey, kind, expires);
          });
        });

        section.querySelectorAll('.reject-btn').forEach((btn) => {
          btn.addEventListener('click', (event) => {
            const li = (event.target as HTMLElement).closest('li');
            if (!li) return;
            const publicKey = li.getAttribute('data-public-key')!;
            clipboardClient?.reject(publicKey);
          });
        });
      },
    )
    .catch(() => {
      // Ignore polling errors.
    });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function init(): Promise<void> {
  const loaded = await loadIdentity();

  if (!loaded) {
    const { machineName, userName } = await getSystemInfo();
    renderSetupForm(machineName, userName);
    return;
  }

  identity = loaded;

  if (identity.hasPassword) {
    renderUnlockForm();
    return;
  }

  try {
    client = await restoreUnprotectedIdentity(identity);
    await renderMain();
  } catch (err) {
    alert(`Could not load identity: ${err instanceof Error ? err.message : String(err)}`);
    const { machineName, userName } = await getSystemInfo();
    renderSetupForm(machineName, userName);
  }
}

init().catch((err) => {
  console.error('Failed to initialise app:', err);
});
