import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DB_PATH, OPTOUT_FILE } from './config';
import { loadOptoutList, saveOptoutRaw } from './optout';

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS sent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    total_contacts INTEGER DEFAULT 0,
    sent INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    excluded INTEGER DEFAULT 0,
    message_preview TEXT,
    report_csv TEXT,
    report_html TEXT
  );
`);

if (fs.existsSync(OPTOUT_FILE)) {
  loadOptoutList(fs.readFileSync(OPTOUT_FILE, 'utf-8').split('\n'));
}

const checkSentStmt = db.prepare(
  'SELECT 1 FROM sent_messages WHERE phone = ? AND status = ?'
);

const insertStmt = db.prepare(`
  INSERT INTO sent_messages (phone, name, status, error_message)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(phone) DO UPDATE SET
    name = excluded.name,
    status = excluded.status,
    error_message = excluded.error_message,
    sent_at = CURRENT_TIMESTAMP
`);

const sentCountStmt = db.prepare(
  "SELECT COUNT(*) as count FROM sent_messages WHERE status = 'success'"
);

const failedCountStmt = db.prepare(
  "SELECT COUNT(*) as count FROM sent_messages WHERE status NOT IN ('success', 'optout_excluded')"
);

const historyStmt = db.prepare(`
  SELECT phone, name, status, sent_at, error_message
  FROM sent_messages
  ORDER BY sent_at DESC
`);

const insertCampaignStmt = db.prepare(`
  INSERT INTO campaigns (name, total_contacts, message_preview)
  VALUES (?, ?, ?)
`);

const finishCampaignStmt = db.prepare(`
  UPDATE campaigns SET
    finished_at = CURRENT_TIMESTAMP,
    sent = ?,
    skipped = ?,
    failed = ?,
    excluded = ?,
    report_csv = ?,
    report_html = ?
  WHERE id = ?
`);

const listCampaignsStmt = db.prepare(`
  SELECT id, name, started_at, finished_at, total_contacts, sent, skipped, failed, excluded, message_preview, report_csv, report_html
  FROM campaigns
  ORDER BY id DESC
  LIMIT 50
`);

const getCampaignStmt = db.prepare(`
  SELECT id, name, started_at, finished_at, total_contacts, sent, skipped, failed, excluded, message_preview, report_csv, report_html
  FROM campaigns WHERE id = ?
`);

export function isAlreadySent(phone: string): boolean {
  const row = checkSentStmt.get(phone, 'success');
  return row !== undefined;
}

export function markAsSent(
  phone: string,
  name: string,
  status: string,
  error?: string
): void {
  insertStmt.run(phone, name, status, error ?? null);
}

export function getSentCount(): number {
  const row = sentCountStmt.get() as { count: number };
  return row.count;
}

export function getPendingCount(total: number): number {
  return total - getSentCount();
}

export function getFailedCount(): number {
  const row = failedCountStmt.get() as { count: number };
  return row.count;
}

export function getHistory(): Array<{
  phone: string;
  name: string | null;
  status: string;
  sent_at: string;
  error_message: string | null;
}> {
  return historyStmt.all() as Array<{
    phone: string;
    name: string | null;
    status: string;
    sent_at: string;
    error_message: string | null;
  }>;
}

export function resetDatabase(): void {
  db.exec('DELETE FROM sent_messages');
}

export function startCampaign(name: string, totalContacts: number, messagePreview: string): number {
  const result = insertCampaignStmt.run(name, totalContacts, messagePreview);
  return Number(result.lastInsertRowid);
}

export function finishCampaign(
  id: number,
  stats: {
    sent: number;
    skipped: number;
    failed: number;
    excluded: number;
    reportCsv: string;
    reportHtml: string;
  }
): void {
  finishCampaignStmt.run(
    stats.sent,
    stats.skipped,
    stats.failed,
    stats.excluded,
    stats.reportCsv,
    stats.reportHtml,
    id
  );
}

export function listCampaigns(): Array<{
  id: number;
  name: string;
  started_at: string;
  finished_at: string | null;
  total_contacts: number;
  sent: number;
  skipped: number;
  failed: number;
  excluded: number;
  message_preview: string | null;
  report_csv: string | null;
  report_html: string | null;
}> {
  return listCampaignsStmt.all() as Array<{
    id: number;
    name: string;
    started_at: string;
    finished_at: string | null;
    total_contacts: number;
    sent: number;
    skipped: number;
    failed: number;
    excluded: number;
    message_preview: string | null;
    report_csv: string | null;
    report_html: string | null;
  }>;
}

export function getCampaign(id: number) {
  return getCampaignStmt.get(id) as
    | {
        id: number;
        name: string;
        started_at: string;
        finished_at: string | null;
        total_contacts: number;
        sent: number;
        skipped: number;
        failed: number;
        excluded: number;
        message_preview: string | null;
        report_csv: string | null;
        report_html: string | null;
      }
    | undefined;
}

export function persistOptoutList(content: string): number {
  const count = saveOptoutRaw(content);
  fs.mkdirSync(path.dirname(OPTOUT_FILE), { recursive: true });
  fs.writeFileSync(OPTOUT_FILE, content, 'utf-8');
  return count;
}

export function closeDatabase(): void {
  db.close();
}
