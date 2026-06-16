import fs from 'fs';
import path from 'path';
import { REPORTS_DIR } from './config';
import { getHistory } from './tracker';

export interface CampaignStats {
  name: string;
  totalContacts: number;
  sent: number;
  skipped: number;
  failed: number;
  excluded: number;
  messagePreview: string;
}

export interface SavedCampaignReport {
  id: number;
  csvPath: string;
  htmlPath: string;
}

function ensureReportsDir(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'campana';
}

function statusLabel(status: string): string {
  if (status === 'success') return 'Enviado';
  if (status === 'optout_excluded') return 'Excluido (Habeas Data)';
  if (status === 'not_on_whatsapp') return 'No está en WhatsApp';
  if (status === 'failed') return 'Fallido';
  return status;
}

function buildCsvRows(): string {
  const history = getHistory();
  const header = 'telefono,nombre,estado,detalle,fecha_hora';
  const rows = history.map((row) => {
    const phone = row.phone.replace('@c.us', '').replace('@lid', '');
    const name = (row.name ?? '').replace(/"/g, '""');
    const status = statusLabel(row.status);
    const detail = (row.error_message ?? '').replace(/"/g, '""');
    const date = row.sent_at ?? '';
    return `"${phone}","${name}","${status}","${detail}","${date}"`;
  });
  return [header, ...rows].join('\n');
}

function buildHtmlReport(stats: CampaignStats): string {
  const history = getHistory();
  const now = new Date().toLocaleString('es-CO');
  const effectiveness =
    stats.totalContacts > 0
      ? ((stats.sent / stats.totalContacts) * 100).toFixed(1)
      : '0.0';

  const rows = history
    .map((row) => {
      const phone = row.phone.replace('@c.us', '').replace('@lid', '');
      const ok = row.status === 'success';
      return `<tr class="${ok ? 'ok' : 'bad'}">
        <td>${phone}</td>
        <td>${row.name ?? '—'}</td>
        <td>${statusLabel(row.status)}</td>
        <td>${row.error_message ?? '—'}</td>
        <td>${row.sent_at ?? '—'}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Informe — ${stats.name}</title>
  <style>
    body { font-family: system-ui, sans-serif; color: #0f172a; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    h1 span { color: #2563eb; }
    .meta { color: #64748b; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem 1rem; }
    .kpi strong { display: block; font-size: 1.5rem; }
    .kpi span { font-size: 0.75rem; color: #64748b; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { border: 1px solid #e2e8f0; padding: 0.5rem 0.6rem; text-align: left; }
    th { background: #f8fafc; }
    tr.ok td:nth-child(3) { color: #16a34a; }
    tr.bad td:nth-child(3) { color: #dc2626; }
    .footer { margin-top: 2rem; font-size: 0.8rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>Informe de campaña · <span>VOTOMAP</span></h1>
  <p class="meta"><strong>${stats.name}</strong> · Generado ${now}<br>
  Mensaje: «${stats.messagePreview.slice(0, 120)}${stats.messagePreview.length > 120 ? '…' : ''}»</p>
  <div class="kpis">
    <div class="kpi"><strong>${stats.sent}</strong><span>Enviados</span></div>
    <div class="kpi"><strong>${effectiveness}%</strong><span>Efectividad</span></div>
    <div class="kpi"><strong>${stats.failed}</strong><span>Fallidos</span></div>
    <div class="kpi"><strong>${stats.skipped}</strong><span>Saltados</span></div>
    <div class="kpi"><strong>${stats.excluded}</strong><span>Excluidos Habeas</span></div>
    <div class="kpi"><strong>${stats.totalContacts}</strong><span>Total lista</span></div>
  </div>
  <table>
    <thead><tr><th>Teléfono</th><th>Nombre</th><th>Estado</th><th>Detalle</th><th>Fecha</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">Sin registros</td></tr>'}</tbody>
  </table>
  <p class="footer">VOTOMAP · DRAN DIGITAL S.A.S · Informe generado automáticamente · Ley 1581 de 2012</p>
</body>
</html>`;
}

export function generateCampaignReport(
  stats: CampaignStats,
  campaignId: number
): SavedCampaignReport {
  ensureReportsDir();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const base = `${stamp}_${slugify(stats.name)}_id${campaignId}`;
  const csvPath = path.join(REPORTS_DIR, `${base}.csv`);
  const htmlPath = path.join(REPORTS_DIR, `${base}.html`);

  fs.writeFileSync(csvPath, buildCsvRows(), 'utf-8');
  fs.writeFileSync(htmlPath, buildHtmlReport(stats), 'utf-8');

  return { id: campaignId, csvPath, htmlPath };
}
