#!/usr/bin/env node
/**
 * Manage MTG Tracker profiles, like LifeOS's scripts/user.cjs.
 *
 *   node scripts/profile.cjs list
 *   node scripts/profile.cjs add <id> "<display name>"
 *   node scripts/profile.cjs rename <id> "<display name>"
 *
 * A profile is only a name that lists belong to - there is no password.
 * Run it from the app directory, or set MTG_DB_PATH.
 */

const { mkdirSync } = require('fs');
const { dirname, join } = require('path');
const { Database } = require('node-sqlite3-wasm');

const DB_PATH = process.env.MTG_DB_PATH || join(process.cwd(), 'data', 'mtg.db');
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.run(`CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL
)`);
const hasLists = db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='lists'");
const listsHaveProfiles = hasLists
  && db.all('PRAGMA table_info(lists)').some((c) => c.name === 'profileId');

const [command, id, name] = process.argv.slice(2);

if (command === 'list') {
  const rows = db.all('SELECT id, name, createdAt FROM profiles ORDER BY createdAt');
  if (!rows.length) console.log('No profiles. Add one with: node scripts/profile.cjs add <id> "<name>"');
  for (const row of rows) {
    const lists = listsHaveProfiles
      ? db.get('SELECT count(*) AS c FROM lists WHERE profileId = ?', [row.id]).c
      : '?';
    console.log(`${row.id.padEnd(10)} ${String(row.name).padEnd(16)} lists: ${lists}`);
  }
} else if (command === 'add') {
  if (!/^[a-z0-9-]+$/.test(id ?? '') || !name) {
    console.error('usage: add <id> "<display name>"   (id: lowercase letters, digits, dashes)');
    process.exit(1);
  }
  db.run('INSERT INTO profiles (id, name, createdAt) VALUES (?, ?, ?)', [id, name, new Date().toISOString()]);
  console.log(`created ${id} (${name})`);
} else if (command === 'rename') {
  if (!id || !name) { console.error('usage: rename <id> "<display name>"'); process.exit(1); }
  db.run('UPDATE profiles SET name = ? WHERE id = ?', [name, id]);
  console.log(`renamed ${id} to ${name}`);
} else {
  console.error('usage: list | add <id> "<name>" | rename <id> "<name>"');
  process.exit(1);
}
db.close();
