// 安卓/离线版存储：内存为主（同步接口），IndexedDB 顺序写回（异步持久化）。
import type { Candle, SaveListItem, TF } from '../../../shared/types';
import type { GameState } from '../../../server/core/state';
import type { ClosedBar, GameStore, ProfileRow } from '../../../server/store';

const DB_NAME = 'fxsim';
const LOW = -1e15;

interface SaveRec { id: string; item: SaveListItem; json: string }
interface BarRec { s: string; f: TF; t: number; o: number; h: number; l: number; c: number; v: number }

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export class MemStore implements GameStore {
  private saves = new Map<string, SaveRec>();
  private profiles = new Map<string, ProfileRow>();
  private meta = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  private constructor(private db: IDBDatabase) {}

  static async open(): Promise<MemStore> {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('saves', { keyPath: 'id' });
      db.createObjectStore('bars');
      db.createObjectStore('profiles', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'k' });
    };
    const db = await reqP(open);
    const s = new MemStore(db);
    const tx = db.transaction(['saves', 'profiles', 'meta'], 'readonly');
    for (const r of await reqP(tx.objectStore('saves').getAll()) as SaveRec[]) s.saves.set(r.id, r);
    for (const r of await reqP(tx.objectStore('profiles').getAll()) as ProfileRow[]) s.profiles.set(r.id, r);
    for (const r of await reqP(tx.objectStore('meta').getAll()) as { k: string; v: string }[]) s.meta.set(r.k, r.v);
    return s;
  }

  /** 按顺序执行写事务，保证删除与写入的先后关系 */
  private enqueue(stores: string[], fn: (tx: IDBTransaction) => void) {
    this.queue = this.queue.then(() => new Promise<void>((res) => {
      const tx = this.db.transaction(stores, 'readwrite');
      tx.oncomplete = () => res();
      tx.onerror = () => { console.error('[store]', tx.error); res(); };
      tx.onabort = () => { console.error('[store] abort', tx.error); res(); };
      fn(tx);
    }));
  }

  flush(): Promise<void> {
    return this.queue;
  }

  listSaves(): SaveListItem[] {
    return [...this.saves.values()].map((r) => r.item).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  loadState(id: string): GameState | null {
    const r = this.saves.get(id);
    return r ? JSON.parse(r.json) : null;
  }

  writeSave(st: GameState, sum: { equity: number; netWorth: number; status: string }, bars: ClosedBar[], trim: { sym: string; tf: TF; t: number }[]) {
    const prev = this.saves.get(st.saveId);
    const rec: SaveRec = {
      id: st.saveId,
      json: JSON.stringify(st),
      item: {
        id: st.saveId, name: st.name, username: st.account.username, accountCcy: st.account.ccy, maxLeverage: st.account.maxLeverage,
        createdAt: prev?.item.createdAt ?? st.createdAt, updatedAt: Date.now(), simTime: Math.round(st.clock.t),
        equity: sum.equity, netWorth: sum.netWorth, status: sum.status,
      },
    };
    this.saves.set(st.saveId, rec);
    this.enqueue(['saves', 'bars'], (tx) => {
      tx.objectStore('saves').put(rec);
      const bs = tx.objectStore('bars');
      for (const b of bars) {
        const v: BarRec = { s: b.sym, f: b.tf, t: b.c.t, o: b.c.o, h: b.c.h, l: b.c.l, c: b.c.c, v: b.c.v };
        bs.put(v, [st.saveId, b.sym, b.tf, b.c.t]);
      }
      for (const x of trim) bs.delete(IDBKeyRange.bound([st.saveId, x.sym, x.tf, LOW], [st.saveId, x.sym, x.tf, x.t], false, true));
    });
  }

  async loadCandles(id: string): Promise<ClosedBar[]> {
    await this.flush();
    const tx = this.db.transaction(['bars'], 'readonly');
    const rows = await reqP(tx.objectStore('bars').getAll(IDBKeyRange.bound([id], [id, []]))) as BarRec[];
    return rows.map((r) => ({ sym: r.s, tf: r.f, c: { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v } as Candle }));
  }

  deleteSave(id: string) {
    this.saves.delete(id);
    this.enqueue(['saves', 'bars'], (tx) => {
      tx.objectStore('saves').delete(id);
      tx.objectStore('bars').delete(IDBKeyRange.bound([id], [id, []]));
    });
  }

  getMeta(k: string) {
    return this.meta.get(k) ?? null;
  }

  setMeta(k: string, v: string) {
    this.meta.set(k, v);
    this.enqueue(['meta'], (tx) => tx.objectStore('meta').put({ k, v }));
  }

  listProfiles() {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  upsertProfile(p: ProfileRow) {
    this.profiles.set(p.id, p);
    this.enqueue(['profiles'], (tx) => tx.objectStore('profiles').put(p));
  }

  deleteProfile(id: string) {
    this.profiles.delete(id);
    this.enqueue(['profiles'], (tx) => tx.objectStore('profiles').delete(id));
  }
}
