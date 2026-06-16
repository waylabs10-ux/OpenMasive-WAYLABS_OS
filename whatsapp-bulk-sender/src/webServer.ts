import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  CONTACTS_CSV,
  log,
  MESSAGE_FILE,
  printBanner,
  WEB_PORT,
} from './config';
import { readContactsCsvRaw, saveContactsCsv } from './csvLoader';
import { logBus } from './logBus';
import {
  clearSentHistory,
  connectWhatsApp,
  disconnectWhatsApp,
  getCampaignById,
  getCampaignsList,
  getOptoutContent,
  getSendHistory,
  getStatus,
  saveOptoutContent,
  shutdownApp,
  startBulkSend,
  stopBulkSend,
} from './sessionService';

export function startWebServer(): void {
  const app = express();
  const publicDir = path.resolve(__dirname, '../public');

  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(publicDir));

  app.get('/api/status', (_req, res) => {
    res.json(getStatus());
  });

  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('status', getStatus());

    const onLog = (payload: unknown) => send('log', payload);
    const onQr = (payload: unknown) => send('qr', payload);
    const onStatus = (payload: unknown) => send('status', payload);

    logBus.on('log', onLog);
    logBus.on('qr', onQr);
    logBus.on('status', onStatus);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      logBus.off('log', onLog);
      logBus.off('qr', onQr);
      logBus.off('status', onStatus);
    });
  });

  app.get('/api/contacts', (_req, res) => {
    res.json({ csv: readContactsCsvRaw() });
  });

  app.put('/api/contacts', (req, res) => {
    try {
      const csv = String(req.body?.csv ?? '');
      const count = saveContactsCsv(csv);
      res.json({ ok: true, count });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.get('/api/message', (_req, res) => {
    const message = fs.existsSync(MESSAGE_FILE)
      ? fs.readFileSync(MESSAGE_FILE, 'utf-8')
      : '';
    res.json({ message });
  });

  app.put('/api/message', (req, res) => {
    const message = String(req.body?.message ?? '');
    fs.mkdirSync(path.dirname(MESSAGE_FILE), { recursive: true });
    fs.writeFileSync(MESSAGE_FILE, message, 'utf-8');
    res.json({ ok: true });
  });

  app.get('/api/history', (_req, res) => {
    res.json({ history: getSendHistory() });
  });

  app.post('/api/session/connect', async (_req, res) => {
    try {
      await connectWhatsApp();
      res.json({ ok: true, status: getStatus() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message, status: getStatus() });
    }
  });

  app.post('/api/session/disconnect', async (_req, res) => {
    await disconnectWhatsApp();
    res.json({ ok: true, status: getStatus() });
  });

  app.post('/api/send/start', async (req, res) => {
    const status = getStatus();
    if (status.session !== 'ready') {
      res.status(400).json({ ok: false, error: 'Conecta WhatsApp antes de enviar' });
      return;
    }
    if (status.sending) {
      res.status(400).json({ ok: false, error: 'Ya hay un envío en curso' });
      return;
    }

    const campaignName = String(req.body?.campaignName ?? '').trim() || undefined;
    void startBulkSend(campaignName).catch(() => null);
    res.json({ ok: true, status: getStatus() });
  });

  app.post('/api/send/stop', (_req, res) => {
    stopBulkSend();
    res.json({ ok: true, status: getStatus() });
  });

  app.post('/api/db/reset', (_req, res) => {
    clearSentHistory();
    res.json({ ok: true, status: getStatus() });
  });

  app.get('/api/optout', (_req, res) => {
    res.json({ content: getOptoutContent(), count: getStatus().optoutCount });
  });

  app.put('/api/optout', (req, res) => {
    const content = String(req.body?.content ?? '');
    const count = saveOptoutContent(content);
    res.json({ ok: true, count, status: getStatus() });
  });

  app.get('/api/campaigns', (_req, res) => {
    res.json({ campaigns: getCampaignsList() });
  });

  app.get('/api/campaigns/:id/report.csv', (req, res) => {
    const campaign = getCampaignById(Number(req.params.id));
    if (!campaign?.report_csv || !fs.existsSync(campaign.report_csv)) {
      res.status(404).json({ error: 'Informe no encontrado' });
      return;
    }
    res.download(campaign.report_csv);
  });

  app.get('/api/campaigns/:id/report.html', (req, res) => {
    const campaign = getCampaignById(Number(req.params.id));
    if (!campaign?.report_html || !fs.existsSync(campaign.report_html)) {
      res.status(404).json({ error: 'Informe no encontrado' });
      return;
    }
    res.sendFile(path.resolve(campaign.report_html));
  });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const server = app.listen(WEB_PORT, () => {
    printBanner();
    log(`Panel VOTOMAP → http://localhost:${WEB_PORT}`, 'success');
    log('Abre esa URL en tu navegador para controlar el envío masivo.', 'info');
  });

  const gracefulShutdown = () => {
    log('Cerrando servidor web...', 'info');
    void shutdownApp().finally(() => {
      server.close(() => process.exit(0));
    });
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}
