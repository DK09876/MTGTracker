/**
 * scripts/backup.sh (review 26): a deploy's named snapshot is taken, verified on its own file and never pruned
 * with the nightly ones; a verify fails on a database with no profiles. Needs bash and sqlite3.
 */

import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/backup.sh');
const hasSqlite = spawnSync('sqlite3', ['-version']).status === 0;

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mtg-backup-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const db = (profiles: number) => {
  const path = join(dir, 'mtg.db');
  execFileSync('sqlite3', [path, `CREATE TABLE profiles (id TEXT); CREATE TABLE lists (id TEXT); ${Array.from({ length: profiles }, (_, i) => `INSERT INTO profiles VALUES ('p${i}');`).join(' ')}`]);
  return path;
};
const run = (path: string, ...args: string[]) => spawnSync('bash', [SCRIPT, ...args], { env: { ...process.env, MTG_DB_PATH: path, MTG_BACKUP_DIR: join(dir, 'b'), MTG_BACKUP_KEEP: '1' }, encoding: 'utf8' });

describe.skipIf(!hasSqlite)('backup.sh', () => {
  it('a tagged snapshot is verified on its own file and survives the pruning of nightly ones', () => {
    const path = db(2);
    expect(run(path, '--tag', 'predeploy-abc', '--verify').status).toBe(0);
    writeFileSync(join(dir, 'touch'), '');
    execFileSync('sqlite3', [path, "INSERT INTO lists VALUES ('l');"]);
    expect(run(path, '--force').status).toBe(0);
    execFileSync('sqlite3', [path, "INSERT INTO lists VALUES ('m');"]);
    expect(run(path, '--force').status).toBe(0);
    const files = readdirSync(join(dir, 'b')).filter((f) => f.endsWith('.db.gz'));
    expect(files.filter((f) => f.startsWith('predeploy-abc_'))).toHaveLength(1);
    expect(files.filter((f) => f.startsWith('mtg_')).length).toBeLessThanOrEqual(2);
  });

  it('verify fails on a database with no profiles', () => {
    const r = run(db(0), '--tag', 'predeploy-x', '--verify');
    expect(r.status).not.toBe(0);
  });
});
