import './style.css';

function initApp(): void {
  const root = document.getElementById('app');
  if (!root) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;
  const ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    console.log('WebSocket connected');
    ws.send(JSON.stringify({ type: 'hello', message: 'client ready' }));
  });

  ws.addEventListener('message', (event) => {
    console.log('WebSocket message:', event.data);
  });

  ws.addEventListener('close', () => {
    console.log('WebSocket disconnected');
  });

  root.innerHTML = `
    <h1>Distributed Clipboard</h1>
    <p>Client loaded. Open the console to see WebSocket messages.</p>
  `;
}

initApp();
