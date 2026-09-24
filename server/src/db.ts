// Database layer — SQLite via better-sqlite3.
// Tables mirror the old Supabase schema: { id, user_id, updated_at, payload }.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'jarvis.db');

// Ensure the data directory exists
import fs from 'node:fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    github_id  INTEGER UNIQUE NOT NULL,
    login      TEXT NOT NULL,
    name       TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS key_vault (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL,
    payload    TEXT NOT NULL
  );
`);

const DATA_TABLES = [
  'conversations', 'memory_items', 'workflows', 'skills',
  'routines', 'ideas', 'traces', 'crew_runs', 'projects',
  'expenses', 'contacts', 'events',
];

for (const t of DATA_TABLES) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${t} (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL,
      payload    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${t}_user ON ${t} (user_id, updated_at DESC);
  `);
}

// ---- User helpers ----

export interface DBUser {
  id: number;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export function upsertUser(githubId: number, login: string, name: string | null, avatarUrl: string | null): DBUser {
  db.prepare(`
    INSERT INTO users (github_id, login, name, avatar_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, name=excluded.name, avatar_url=excluded.avatar_url
  `).run(githubId, login, name, avatarUrl);
  return db.prepare('SELECT * FROM users WHERE github_id = ?').get(githubId) as DBUser;
}

export function findUserById(id: number): DBUser | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DBUser | undefined;
}

// ---- Assistant tables (Telegram, persona, per-user server settings) ----

db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_links (
    chat_id    INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username   TEXT,
    linked_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS link_codes (
    code       TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tg_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tg_messages_user ON tg_messages (user_id, created_at DESC);
`);

export interface UserSettings {
  persona: 'jarvis' | 'neutral' | 'terse';
  humor: number;          // 0..1
  name?: string;          // how Jarvis addresses the user
  currency: string;       // e.g. USD
  smtp?: { host: string; port: number; user: string; pass: string; from: string };
}

export const DEFAULT_SETTINGS: UserSettings = { persona: 'jarvis', humor: 0.5, currency: 'USD' };

export function getSettings(uid: number): UserSettings {
  const row = db.prepare('SELECT payload FROM user_settings WHERE user_id = ?').get(uid) as { payload: string } | undefined;
  return row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.payload) } : { ...DEFAULT_SETTINGS };
}

export function setSettings(uid: number, s: Partial<UserSettings>): UserSettings {
  const next = { ...getSettings(uid), ...s };
  db.prepare('INSERT INTO user_settings (user_id, payload) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload')
    .run(uid, JSON.stringify(next));
  return next;
}

export function userForChat(chatId: number): DBUser | undefined {
  return db.prepare('SELECT u.* FROM telegram_links t JOIN users u ON u.id = t.user_id WHERE t.chat_id = ?').get(chatId) as DBUser | undefined;
}

export function createLinkCode(uid: number): string {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare('DELETE FROM link_codes WHERE user_id = ? OR expires_at < ?').run(uid, Date.now());
  db.prepare('INSERT INTO link_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(code, uid, Date.now() + 10 * 60_000);
  return code;
}

export function redeemLinkCode(code: string, chatId: number, username: string | null): DBUser | undefined {
  const row = db.prepare('SELECT user_id FROM link_codes WHERE code = ? AND expires_at > ?').get(code.toUpperCase(), Date.now()) as { user_id: number } | undefined;
  if (!row) return undefined;
  db.prepare('DELETE FROM link_codes WHERE code = ?').run(code.toUpperCase());
  db.prepare('INSERT INTO telegram_links (chat_id, user_id, username) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET user_id=excluded.user_id, username=excluded.username')
    .run(chatId, row.user_id, username);
  return findUserById(row.user_id);
}

export function telegramLinkFor(uid: number): { chat_id: number; username: string | null; linked_at: string } | undefined {
  return db.prepare('SELECT chat_id, username, linked_at FROM telegram_links WHERE user_id = ?').get(uid) as never;
}

export function unlinkTelegram(uid: number): void {
  db.prepare('DELETE FROM telegram_links WHERE user_id = ?').run(uid);
}

// Rolling conversation buffer for Telegram (last N turns)
export function pushTgMessage(uid: number, role: 'user' | 'assistant', content: string): void {
  db.prepare('INSERT INTO tg_messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(uid, role, content, Date.now());
  db.prepare(`DELETE FROM tg_messages WHERE user_id = ? AND id NOT IN (
    SELECT id FROM tg_messages WHERE user_id = ? ORDER BY id DESC LIMIT 40)`).run(uid, uid);
}

export function recentTgMessages(uid: number, limit = 20): { role: 'user' | 'assistant'; content: string }[] {
  const rows = db.prepare('SELECT role, content FROM tg_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(uid, limit) as { role: 'user' | 'assistant'; content: string }[];
  return rows.reverse();
}

export function clearTgMessages(uid: number): void {
  db.prepare('DELETE FROM tg_messages WHERE user_id = ?').run(uid);
}

// Generic row helpers for data tables (used by assistant tools)
export interface DataRow { id: string; updated_at: string; payload: string }
export function listRows(table: string, uid: number): { id: string; updated: number; data: Record<string, unknown> }[] {
  const rows = db.prepare(`SELECT id, updated_at, payload FROM ${table} WHERE user_id = ? ORDER BY updated_at DESC`).all(uid) as DataRow[];
  return rows.map((r) => ({ id: r.id, updated: new Date(r.updated_at).getTime(), data: JSON.parse(r.payload) }));
}
export function putRow(table: string, uid: number, id: string, data: Record<string, unknown>): void {
  db.prepare(`INSERT INTO ${table} (id, user_id, updated_at, payload) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, payload=excluded.payload`)
    .run(id, uid, new Date().toISOString(), JSON.stringify(data));
}
export function deleteRow(table: string, uid: number, id: string): boolean {
  return db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).run(id, uid).changes > 0;
}
