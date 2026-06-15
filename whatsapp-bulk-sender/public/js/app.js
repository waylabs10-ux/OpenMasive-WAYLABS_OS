const $ = (id) => document.getElementById(id);

const els = {
  sessionBadge: $('sessionBadge'),
  statContacts: $('statContacts'),
  statSent: $('statSent'),
  statSkipped: $('statSkipped'),
  statFailed: $('statFailed'),
  btnConnect: $('btnConnect'),
  btnDisconnect: $('btnDisconnect'),
  btnStart: $('btnStart'),
  btnStop: $('btnStop'),
  btnResetDb: $('btnResetDb'),
  btnSaveContacts: $('btnSaveContacts'),
  btnSaveMessage: $('btnSaveMessage'),
  btnClearLog: $('btnClearLog'),
  contactsCsv: $('contactsCsv'),
  messageText: $('messageText'),
  qrBox: $('qrBox'),
  qrImage: $('qrImage'),
  logConsole: $('logConsole'),
};

const sessionLabels = {
  idle: 'Desconectado',
  connecting: 'Conectando…',
  ready: 'Listo para enviar',
  sending: 'Enviando…',
  error: 'Error de sesión',
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

function appendLog(entry) {
  const line = document.createElement('div');
  line.className = `log-line ${entry.type || 'info'}`;
  line.innerHTML = `<span class="time">[${entry.timestamp}]</span> ${escapeHtml(entry.message)}`;
  els.logConsole.appendChild(line);
  els.logConsole.scrollTop = els.logConsole.scrollHeight;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function updateUI(status) {
  const session = status.session || 'idle';
  els.sessionBadge.textContent = sessionLabels[session] || session;
  els.sessionBadge.className = `session-badge ${session}`;

  els.statContacts.textContent = status.contactCount ?? 0;
  els.statSent.textContent = status.sent ?? 0;
  els.statSkipped.textContent = status.skipped ?? 0;
  els.statFailed.textContent = status.failed ?? 0;

  const ready = session === 'ready';
  const sending = Boolean(status.sending);
  const connecting = session === 'connecting';

  els.btnConnect.disabled = connecting || ready || sending;
  els.btnDisconnect.disabled = session === 'idle' || connecting;
  els.btnStart.disabled = !ready || sending;
  els.btnStop.disabled = !sending;

  if (session === 'ready' || session === 'sending') {
    els.qrBox.classList.add('hidden');
  }
}

async function loadData() {
  const [contacts, message, status] = await Promise.all([
    api('/api/contacts'),
    api('/api/message'),
    api('/api/status'),
  ]);
  els.contactsCsv.value = contacts.csv;
  els.messageText.value = message.message;
  updateUI(status);
}

function connectEvents() {
  const source = new EventSource('/api/events');

  source.addEventListener('log', (e) => {
    appendLog(JSON.parse(e.data));
  });

  source.addEventListener('qr', (e) => {
    const { dataUrl } = JSON.parse(e.data);
    els.qrImage.src = dataUrl;
    els.qrBox.classList.remove('hidden');
  });

  source.addEventListener('status', (e) => {
    updateUI(JSON.parse(e.data));
  });

  source.onerror = () => {
    appendLog({
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message: 'Conexión SSE interrumpida. Reconectando…',
      type: 'skip',
    });
  };
}

els.btnConnect.addEventListener('click', async () => {
  els.btnConnect.disabled = true;
  try {
    const data = await api('/api/session/connect', { method: 'POST' });
    updateUI(data.status);
  } catch (err) {
    appendLog({
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message: err.message,
      type: 'error',
    });
    els.btnConnect.disabled = false;
  }
});

els.btnDisconnect.addEventListener('click', async () => {
  const data = await api('/api/session/disconnect', { method: 'POST' });
  updateUI(data.status);
});

els.btnStart.addEventListener('click', async () => {
  try {
    const data = await api('/api/send/start', { method: 'POST' });
    updateUI(data.status);
  } catch (err) {
    appendLog({
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message: err.message,
      type: 'error',
    });
  }
});

els.btnStop.addEventListener('click', async () => {
  const data = await api('/api/send/stop', { method: 'POST' });
  updateUI(data.status);
});

els.btnResetDb.addEventListener('click', async () => {
  if (!confirm('¿Borrar historial de envíos (sent.db)? Podrás reenviar a todos.')) return;
  const data = await api('/api/db/reset', { method: 'POST' });
  updateUI(data.status);
});

els.btnSaveContacts.addEventListener('click', async () => {
  try {
    const data = await api('/api/contacts', {
      method: 'PUT',
      body: JSON.stringify({ csv: els.contactsCsv.value }),
    });
    appendLog({
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message: `Contactos guardados: ${data.count}`,
      type: 'success',
    });
    const status = await api('/api/status');
    updateUI(status);
  } catch (err) {
    appendLog({
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message: err.message,
      type: 'error',
    });
  }
});

els.btnSaveMessage.addEventListener('click', async () => {
  await api('/api/message', {
    method: 'PUT',
    body: JSON.stringify({ message: els.messageText.value }),
  });
  appendLog({
    timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
    message: 'Mensaje guardado.',
    type: 'success',
  });
});

els.btnClearLog.addEventListener('click', () => {
  els.logConsole.innerHTML = '';
});

loadData().catch((err) => {
  appendLog({
    timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
    message: `Error al cargar: ${err.message}`,
    type: 'error',
  });
});

connectEvents();
