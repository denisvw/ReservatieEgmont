const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(DATA_DIR, 'reservaties.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// De partijen die mogen reserveren. "key" wordt in de databank bewaard.
const PARTIES = [
  { key: 'celine-matthias', label: 'Celine & Matthias', color: '#e07a5f', external: false },
  { key: 'nadine-johan', label: 'Nadine & Johan', color: '#3d85c6', external: false },
  { key: 'mieke-denis', label: 'Mieke & Denis', color: '#6aa84f', external: false },
  { key: 'nicolas-jef', label: 'Nicolas & Jef', color: '#b366c4', external: false },
  { key: 'external', label: 'EXTERNAL', color: '#3a3a3a', external: true },
];
const PARTY_KEYS = PARTIES.map((p) => p.key);
const partyLabel = (key) => (PARTIES.find((p) => p.key === key) || {}).label || key;

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  party TEXT,                       -- NULL = geen familiepartij (bv. enkel beheerder)
  is_admin INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  phone TEXT,                       -- internationaal formaat, bv. +32470123456
  callmebot_key TEXT,               -- persoonlijke CallMeBot API-sleutel
  notify_whatsapp INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party TEXT NOT NULL,
  start_date TEXT NOT NULL,         -- aankomstdag (YYYY-MM-DD)
  end_date TEXT NOT NULL,           -- vertrekdag (YYYY-MM-DD), exclusief
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_res_dates ON reservations(start_date, end_date);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- NULL = systeembericht
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = { db, PARTIES, PARTY_KEYS, partyLabel };
