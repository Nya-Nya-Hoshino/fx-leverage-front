// SQLite 持久化（Node 内置 node:sqlite，无需原生编译）。
import { createRequire } from 'node:module';
import type { Candle, SaveListItem, TF } from '../shared/types';
import type { GameState } from './core/state';
import type { GameStore, ProfileRow } from './store';

export type { ProfileRow };

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');


export class Db implements GameStore {
  db: any;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS saves (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL, account_ccy TEXT NOT NULL,
        max_leverage REAL NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        sim_time INTEGER NOT NULL, equity REAL NOT NULL, net_worth REAL NOT NULL, status TEXT NOT NULL,
        state_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candles (
        save_id TEXT NOT NULL, sym TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL,
        o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL,
        PRIMARY KEY (save_id, sym, tf, t)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS ai_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL,
        api_key_enc TEXT NOT NULL, model TEXT NOT NULL, max_tokens INTEGER NOT NULL, timeout_ms INTEGER NOT NULL,
        json_mode INTEGER NOT NULL, price_in REAL NOT NULL, price_out REAL NOT NULL,
        min_interval_ms INTEGER NOT NULL, max_retries INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
    const cols = this.db.prepare('PRAGMA table_info(ai_profiles)').all().map((c: any) => c.name);
    if (!cols.includes('extra_json')) this.db.exec("ALTER TABLE ai_profiles ADD COLUMN extra_json TEXT NOT NULL DEFAULT ''");
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  listSaves(): SaveListItem[] {
    const rows = this.db.prepare('SELECT id,name,username,account_ccy,max_leverage,created_at,updated_at,sim_time,equity,net_worth,status FROM saves ORDER BY updated_at DESC').all();
    return rows.map((r: any) => ({
      id: r.id, name: r.name, username: r.username, accountCcy: r.account_ccy, maxLeverage: r.max_leverage,
      createdAt: r.created_at, updatedAt: r.updated_at, simTime: r.sim_time, equity: r.equity, netWorth: r.net_worth, status: r.status,
    }));
  }

  loadState(id: string): GameState | null {
    const r = this.db.prepare('SELECT state_json FROM saves WHERE id = ?').get(id);
    return r ? JSON.parse(r.state_json) : null;
  }

  /** 写入存档状态 + 新收盘 K 线 + 裁剪旧 K 线，在同一事务中完成 */
  writeSave(
    st: GameState, summary: { equity: number; netWorth: number; status: string },
    bars: { sym: string; tf: TF; c: Candle }[], trimBefore: { sym: string; tf: TF; t: number }[],
  ) {
    const json = JSON.stringify(st);
    this.tx(() => {
      this.db.prepare(`INSERT INTO saves (id,name,username,account_ccy,max_leverage,created_at,updated_at,sim_time,equity,net_worth,status,state_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at, sim_time=excluded.sim_time,
        equity=excluded.equity, net_worth=excluded.net_worth, status=excluded.status, state_json=excluded.state_json`)
        .run(st.saveId, st.name, st.account.username, st.account.ccy, st.account.maxLeverage, st.createdAt, Date.now(),
          Math.round(st.clock.t), summary.equity, summary.netWorth, summary.status, json);
      const ins = this.db.prepare('INSERT OR REPLACE INTO candles (save_id,sym,tf,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const b of bars) ins.run(st.saveId, b.sym, b.tf, b.c.t, b.c.o, b.c.h, b.c.l, b.c.c, b.c.v);
      const del = this.db.prepare('DELETE FROM candles WHERE save_id=? AND sym=? AND tf=? AND t < ?');
      for (const x of trimBefore) del.run(st.saveId, x.sym, x.tf, x.t);
    });
  }

  loadCandles(id: string): { sym: string; tf: TF; c: Candle }[] {
    const rows = this.db.prepare('SELECT sym,tf,t,o,h,l,c,v FROM candles WHERE save_id = ? ORDER BY t').all(id);
    return rows.map((r: any) => ({ sym: r.sym, tf: r.tf, c: { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v } }));
  }

  deleteSave(id: string) {
    this.tx(() => {
      this.db.prepare('DELETE FROM saves WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM candles WHERE save_id = ?').run(id);
    });
  }

  getMeta(k: string): string | null {
    return this.db.prepare('SELECT v FROM meta WHERE k = ?').get(k)?.v ?? null;
  }

  setMeta(k: string, v: string) {
    this.db.prepare('INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
  }

  listProfiles(): ProfileRow[] {
    return this.db.prepare('SELECT * FROM ai_profiles ORDER BY name').all();
  }

  upsertProfile(p: ProfileRow) {
    this.db.prepare(`INSERT INTO ai_profiles (id,name,provider,base_url,api_key_enc,model,max_tokens,timeout_ms,json_mode,price_in,price_out,min_interval_ms,max_retries,extra_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, provider=excluded.provider,
      base_url=excluded.base_url, api_key_enc=excluded.api_key_enc, model=excluded.model, max_tokens=excluded.max_tokens,
      timeout_ms=excluded.timeout_ms, json_mode=excluded.json_mode, price_in=excluded.price_in, price_out=excluded.price_out,
      min_interval_ms=excluded.min_interval_ms, max_retries=excluded.max_retries, extra_json=excluded.extra_json`)
      .run(p.id, p.name, p.provider, p.base_url, p.api_key_enc, p.model, p.max_tokens, p.timeout_ms, p.json_mode, p.price_in, p.price_out, p.min_interval_ms, p.max_retries, p.extra_json ?? '');
  }

  deleteProfile(id: string) {
    this.db.prepare('DELETE FROM ai_profiles WHERE id = ?').run(id);
  }

  close() {
    this.db.close();
  }
}
