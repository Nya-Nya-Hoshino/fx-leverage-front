// 前端实时价格历史（每个货币对的 Bid 序列）：用于汇率看板迷你走势图与持仓综合走势图。
// 种子来自服务端最近的 15s K 线，之后由每个 Tick 追加。
import type { Quote } from '../../shared/types';
import { api } from './api';

export type Pt = { t: number; v: number };
const CAP = 400;
export const hist: Record<string, Pt[]> = {};
let seededFor: string | null = null;

export async function seedHistory(saveId: string) {
  seededFor = saveId;
  for (const k of Object.keys(hist)) delete hist[k];
  const r = await api.get<{ saveId: string; series: Record<string, [number, number][]> }>('/api/sparks?n=200');
  if (r.saveId !== seededFor) return;
  for (const [sym, arr] of Object.entries(r.series)) {
    const cur = hist[sym] ?? [];
    const seeded = arr.map(([t, v]) => ({ t, v }));
    // 合并：种子在前，已到达的 Tick 在后
    const lastT = seeded.length ? seeded[seeded.length - 1].t : -Infinity;
    hist[sym] = [...seeded, ...cur.filter((p) => p.t > lastT)].slice(-CAP);
  }
}

export function pushQuotes(t: number, quotes: Quote[]) {
  for (const q of quotes) {
    const a = (hist[q.sym] ??= []);
    const last = a[a.length - 1];
    if (last && t <= last.t) { last.v = q.bid; continue; }
    a.push({ t, v: q.bid });
    if (a.length > CAP) a.splice(0, a.length - CAP);
  }
}
