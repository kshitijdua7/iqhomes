import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Where the house is saved.
 *  - Default: small JSON files in server/data (git-ignored).
 *  - With DATABASE_URL set: a PostgreSQL table (one JSON document per key), so the app can run on a host
 *    with no persistent disk (Render, Railway, Fly…) and keep everything across deploys.
 *
 * Everything is loaded once at startup into memory; writes are debounced.
 */

const KEYS = ['state.json', 'auth.json', 'push.json', 'hardware.json', 'kasa.json', 'hubspace.json'];

export class Storage {
  private cache = new Map<string, unknown>();
  private timers = new Map<string, NodeJS.Timeout>();
  private pool?: pg.Pool;

  constructor(private dir: string, private databaseUrl = process.env.DATABASE_URL) {}

  get kind() { return this.pool ? 'PostgreSQL' : `JSON files (${this.dir})`; }

  async init() {
    if (this.databaseUrl) {
      this.pool = new pg.Pool({
        connectionString: this.databaseUrl,
        ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(this.databaseUrl) ? false : { rejectUnauthorized: false },
        max: 4,
      });
      await this.pool.query(`CREATE TABLE IF NOT EXISTS iqhomes_store (
        key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
      const { rows } = await this.pool.query<{ key: string; value: unknown }>('SELECT key, value FROM iqhomes_store');
      for (const r of rows) this.cache.set(r.key, r.value);
      return;
    }
    if (!existsSync(this.dir)) return;
    for (const f of readdirSync(this.dir)) {
      if (!KEYS.includes(f)) continue;
      try { this.cache.set(f, JSON.parse(readFileSync(join(this.dir, f), 'utf8'))); } catch { /* corrupt file: start fresh */ }
    }
  }

  load<T>(key: string): T | undefined { return this.cache.get(key) as T | undefined; }

  /** Save (debounced 300 ms). `data` is a function so the latest state is written. */
  save(key: string, data: () => unknown) {
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => void this.write(key, data()), 300));
  }

  /** Wipe everything (demo mode hourly reset). */
  async clear(keys = KEYS) {
    for (const k of keys) { this.cache.delete(k); clearTimeout(this.timers.get(k)); }
    if (this.pool) await this.pool.query('DELETE FROM iqhomes_store WHERE key = ANY($1)', [keys]);
  }

  private async write(key: string, value: unknown) {
    this.cache.set(key, value);
    try {
      if (this.pool) {
        await this.pool.query(
          `INSERT INTO iqhomes_store (key, value, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, JSON.stringify(value)],
        );
      } else {
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(join(this.dir, key), JSON.stringify(value, null, 2));
      }
    } catch (e) {
      console.error(`Could not save ${key}:`, e instanceof Error ? e.message : e);
    }
  }
}
