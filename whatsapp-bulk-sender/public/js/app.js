const $ = (id) => document.getElementById(id);

const els = {
  sessionBadge: $('sessionBadge'),
  statContacts: $('statContacts'),
  statSent: $('statSent'),
  statSkipped: $('statSkipped'),
  statFailed: $('statFailed'),
  statExcluded: $('statExcluded'),
  btnConnect: $('btnConnect'),
  btnDisconnect: $('btnDisconnect'),
  btnStart: $('btnStart'),
  btnStop: $('btnStop'),
  btnResetDb: $('btnResetDb'),
  btnSaveContacts: $('btnSaveContacts'),
  btnSaveMessage: $('btnSaveMessage'),
  btnClearLog: $('btnClearLog'),
  btnRefreshCampaigns: $('btnRefreshCampaigns'),
  btnSaveOptout: $('btnSaveOptout'),
  campaignName: $('campaignName'),
  campaignList: $('campaignList'),
  contactsCsv: $('contactsCsv'),
  messageText: $('messageText'),
  optoutList: $('optoutList'),
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

let wasSending = false;

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

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderCampaigns(campaigns) {
  if (!campaigns.length) {
    els.campaignList.innerHTML = '<p class="empty-note">Aún no hay campañas registradas.</p>';
    return;
  }

  els.campaignList.innerHTML = campaigns
    .map((c) => {
      const finished = Boolean(c.finished_at);
      const statusClass = finished ? 'done' : 'pending';
      const statusLabel = finished ? 'Completada' : 'En curso';
      return `
        <article class="campaign-item">
          <div class="campaign-item-head">
            <strong>${escapeHtml(c.name)}</strong>
            <span class="campaign-status ${statusClass}">${statusLabel}</span>
          </div>
          <p class="campaign-meta">
            ${formatDate(c.started_at)}
            · ${c.sent ?? 0} enviados · ${c.excluded ?? 0} excluidos · ${c.failed ?? 0} fallidos
          </p>
          <div class="campaign-actions">
            <a class="btn btn-line btn-sm" href="/api/campaigns/${c.id}/report.html" target="_blank" rel="noopener">Ver HTML</a>
            <a class="btn btn-line btn-sm" href="/api/campaigns/${c.id}/report.csv">Descargar CSV</a>
          </div>
        </article>
      `;
    })
    .join('');
}

async function loadCampaigns() {
  const data = await api('/api/campaigns');
  renderCampaigns(data.campaigns || []);
}

function updateUI(status) {
  const session = status.session || 'idle';
  const label = sessionLabels[session] || session;

  els.sessionBadge.className = `session-pill ${session}`;
  const textEl = els.sessionBadge.querySelector('.session-text');
  if (textEl) textEl.textContent = label;

  const liveTag = document.getElementById('liveTag');
  if (liveTag) {
    liveTag.classList.toggle('hidden', !status.sending);
  }

  els.statContacts.textContent = status.contactCount ?? 0;
  els.statSent.textContent = status.sent ?? 0;
  els.statSkipped.textContent = status.skipped ?? 0;
  els.statFailed.textContent = status.failed ?? 0;
  if (els.statExcluded) {
    els.statExcluded.textContent = status.excluded ?? 0;
  }

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

  if (wasSending && !sending) {
    loadCampaigns().catch(() => null);
  }
  wasSending = sending;
}

async function loadData() {
  const [contacts, message, status, optout] = await Promise.all([
    api('/api/contacts'),
    api('/api/message'),
    api('/api/status'),
    api('/api/optout'),
  ]);
  els.contactsCsv.value = contacts.csv;
  els.messageText.value = message.message;
  if (els.optoutList) {
    els.optoutList.value = optout.content;
  }
  updateUI(status);
  await loadCampaigns();
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
    const campaignName = els.campaignName?.value?.trim() || '';
    const data = await api('/api/send/start', {
      method: 'POST',
      body: JSON.stringify({ campaignName }),
    });
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

els.btnSaveOptout?.addEventListener('click', async () => {
  try {
    const data = await api('/api/optout', {
      method: 'PUT',
      body: JSON.stringify({ content: els.optoutList.value }),
    });
    appendLog({
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message: `Lista de exclusión guardada: ${data.count} número(s).`,
      type: 'success',
    });
    updateUI(data.status);
  } catch (err) {
    appendLog({
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message: err.message,
      type: 'error',
    });
  }
});

els.btnRefreshCampaigns?.addEventListener('click', async () => {
  try {
    await loadCampaigns();
    appendLog({
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message: 'Lista de campañas actualizada.',
      type: 'info',
    });
  } catch (err) {
    appendLog({
      timestamp: new Date().toLocaleTimeString('es-CO', { hour12: false }),
      message: err.message,
      type: 'error',
    });
  }
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
