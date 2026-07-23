import './style.css';
import { CryptoClient } from './crypto-client.js';
import {
  createIdentity,
  loadIdentity,
  restoreUnprotectedIdentity,
  unlockIdentity,
  type Identity,
} from './identity-store.js';

let client: CryptoClient | undefined;

async function getSystemInfo(): Promise<{ machineName: string; userName: string }> {
  const machineName =
    (typeof navigator !== 'undefined' && (await getDeviceName())) || 'Unknown device';
  const userName = 'Anonymous';
  return { machineName, userName };
}

async function getDeviceName(): Promise<string> {
  // navigator.userAgentData is available in some modern browsers.
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
      const { identity, client: newClient } = await createIdentity(machineName, userName, password);
      client = newClient;
      renderMain(identity, client);
    } catch (err) {
      alert(`Failed to create identity: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function renderUnlockForm(identity: Identity): void {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <h1>Distributed Clipboard</h1>
    <h2>Welcome back, ${escapeHtml(identity.userName)}</h2>
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
      client = await unlockIdentity(identity, password);
      renderMain(identity, client);
    } catch (err) {
      alert(`Unlock failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

async function renderMain(identity: Identity, cryptoClient: CryptoClient): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const publicKeys = await cryptoClient.getPublicKeys();
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
    <p class="hint">Use the console to see WebSocket messages.</p>
  `;

  document.getElementById('create-clipboard')?.addEventListener('click', () => {
    console.log('Create clipboard clicked');
  });
  document.getElementById('connect-clipboard')?.addEventListener('click', () => {
    console.log('Connect clipboard clicked');
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function init(): Promise<void> {
  const identity = await loadIdentity();

  if (!identity) {
    const { machineName, userName } = await getSystemInfo();
    renderSetupForm(machineName, userName);
    return;
  }

  if (identity.hasPassword) {
    renderUnlockForm(identity);
    return;
  }

  try {
    client = await restoreUnprotectedIdentity(identity);
    await renderMain(identity, client);
  } catch (err) {
    alert(`Could not load identity: ${err instanceof Error ? err.message : String(err)}`);
    const { machineName, userName } = await getSystemInfo();
    renderSetupForm(machineName, userName);
  }
}

init().catch((err) => {
  console.error('Failed to initialise app:', err);
});
