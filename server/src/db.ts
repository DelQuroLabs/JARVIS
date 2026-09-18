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
