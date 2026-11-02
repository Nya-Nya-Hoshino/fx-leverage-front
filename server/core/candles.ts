// K线聚合：所有周期都由同一 Bid 价格序列逐 Tick 更新，形成中的 K 线随每次 Tick 实时变化。
import type { Candle, TF } from '../../shared/types';
import { TF_SEC, TFS } from '../../shared/types';

export const MAX_BARS = 3000;

/** 日线以 UTC 21:00（纽约收盘）为界 */
export function bucketOf(t: number, tf: TF): number {
  const sec = TF_SEC[tf];
  if (tf === '1d') return Math.floor((t + 3 * 3600) / sec) * sec - 3 * 3600;
  return Math.floor(t / sec) * sec;
}

export interface SeriesState {
  closed: Candle[];
  forming: Candle | null;
  persistedT: number;   // 已写入数据库的最后一根收盘 K 线时间
}

export class CandleStore {
  data: Record<string, Record<TF, SeriesState>> = {};

  constructor(syms: string[]) {
    for (const s of syms) {
      this.data[s] = {} as Record<TF, SeriesState>;
      for (const tf of TFS) this.data[s][tf] = { closed: [], forming: null, persistedT: -Infinity };
    }
  }

  update(sym: string, t: number, price: number, vol: number) {
    const series = this.data[sym];
    for (const tf of TFS) {
      const st = series[tf];
      const b = bucketOf(t, tf);
      const f = st.forming;
      if (!f || f.t !== b) {
        if (f) {
          st.closed.push(f);
          // 分批裁剪，避免每次 push 都移动整个数组
          if (st.closed.length > MAX_BARS * 1.25) st.closed.splice(0, st.closed.length - MAX_BARS);
        }
        st.forming = { t: b, o: price, h: price, l: price, c: price, v: vol };
      } else {
        if (price > f.h) f.h = price;
        if (price < f.l) f.l = price;
        f.c = price;
        f.v += vol;
      }
    }
  }

  bars(sym: string, tf: TF, limit = 500): Candle[] {
    const st = this.data[sym]?.[tf];
    if (!st) return [];
    const arr = st.closed.slice(-limit);
    if (st.forming) arr.push({ ...st.forming });
    return arr;
  }

  /** 自给定时间起（含）的 K 线，用于向前端推送增量 */
  barsSince(sym: string, tf: TF, since: number): Candle[] {
    const st = this.data[sym][tf];
    const out: Candle[] = [];
    for (let i = st.closed.length - 1; i >= 0 && st.closed[i].t >= since; i--) out.unshift(st.closed[i]);
    if (st.forming && st.forming.t >= since) out.push({ ...st.forming });
    return out;
  }

  /** 取出尚未持久化的收盘 K 线，并标记为已持久化 */
  takeUnpersisted(): { sym: string; tf: TF; c: Candle }[] {
    const out: { sym: string; tf: TF; c: Candle }[] = [];
    for (const sym of Object.keys(this.data)) {
      for (const tf of TFS) {
        const st = this.data[sym][tf];
        const from = st.closed.slice(-MAX_BARS);
        for (const c of from) if (c.t > st.persistedT) out.push({ sym, tf, c });
        if (st.closed.length) st.persistedT = st.closed[st.closed.length - 1].t;
      }
    }
    return out;
  }

  formingSnapshot(): Record<string, Partial<Record<TF, Candle>>> {
    const out: Record<string, Partial<Record<TF, Candle>>> = {};
    for (const sym of Object.keys(this.data)) {
      out[sym] = {};
      for (const tf of TFS) if (this.data[sym][tf].forming) out[sym][tf] = { ...this.data[sym][tf].forming! };
    }
    return out;
  }

  restore(closed: { sym: string; tf: TF; c: Candle }[], forming: Record<string, Partial<Record<TF, Candle>>>) {
    for (const r of closed) this.data[r.sym]?.[r.tf]?.closed.push(r.c);
    for (const sym of Object.keys(this.data)) {
      for (const tf of TFS) {
        const st = this.data[sym][tf];
        st.closed.sort((a, b) => a.t - b.t);
        if (st.closed.length > MAX_BARS) st.closed.splice(0, st.closed.length - MAX_BARS);
        st.persistedT = st.closed.length ? st.closed[st.closed.length - 1].t : -Infinity;
        st.forming = forming[sym]?.[tf] ? { ...forming[sym][tf]! } : null;
      }
    }
  }
}
