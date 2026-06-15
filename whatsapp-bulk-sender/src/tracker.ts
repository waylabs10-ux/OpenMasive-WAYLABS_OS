import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DB_PATH } from './config';

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
  )
`);

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
  "SELECT COUNT(*) as count FROM sent_messages WHERE status != 'success'"
);

const historyStmt = db.prepare(`
  SELECT phone, name, status, sent_at, error_message
  FROM sent_messages
  ORDER BY sent_at DESC
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

export function closeDatabase(): void {
  db.close();
}
