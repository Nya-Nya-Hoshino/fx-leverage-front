import { useS, pushEffect } from './store';
import type { TickMessage } from '../../shared/types';
import { pushQuotes, seedHistory } from './history';

/** 安卓离线版：后端运行在 WebView 内（VITE_STANDALONE=1 构建） */
export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';
let local: import('./local/backend').LocalBackend | null = null;
let localReady: Promise<void> | null = null;

async function req<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const saveId = useS.getState().saveId;
  if (STANDALONE) {
    await localReady;
    const u = new URL(url, 'http://local');
    const [status, j] = await local!.handle({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: body ?? {}, saveId }) as [number, any];
    if (status >= 400 && j?.error) throw new Error(j.error);
    return JSON.parse(JSON.stringify(j));
  }
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(saveId ? { 'x-save-id': saveId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok && j?.error) throw new Error(j.error);
  return j;
}

export const api = {
  get: <T = any>(u: string) => req<T>('GET', u),
  post: <T = any>(u: string, b?: unknown) => req<T>('POST', u, b ?? {}),
  del: <T = any>(u: string) => req<T>('DELETE', u),
};

export async function loadMeta() {
  const meta = await api.get('/api/meta');
  useS.setState({ meta });
  return meta;
}

export async function loadState() {
  const st = await api.get('/api/state');
  if (!st.active) {
    useS.setState({ active: false, saveId: null, tick: null });
    return;
  }
  useS.setState({
    active: true, saveId: st.saveId, saveName: st.name, username: st.username, seed: st.seed,
    news: st.news, notices: st.notices, aiLog: st.aiLog, trades: st.trades, curve: st.equityCurve,
    settings: { marketSettings: st.marketSettings, risk: st.risk, autoTrader: st.autoTrader, roles: st.roles },
    profiles: st.profiles, tick: st.tick, repayable: st.repayable,
  });
  chartReset?.();
  void seedHistory(st.saveId).catch(() => undefined);
}

export async function refreshSettings() {
  const st = await api.get('/api/state');
  if (st.active) {
    useS.setState({
      settings: { marketSettings: st.marketSettings, risk: st.risk, autoTrader: st.autoTrader, roles: st.roles },
      profiles: st.profiles, repayable: st.repayable,
    });
  }
}

let ws: WebSocket | null = null;
let chartReset: (() => void) | null = null;
let barHandler: ((m: TickMessage) => void) | null = null;

export function setChartHooks(reset: () => void, onBars: (m: TickMessage) => void) {
  chartReset = reset;
  barHandler = onBars;
}

export function subscribeBars(sym: string, tf: string, since: number) {
  if (STANDALONE) { local?.subscribe(sym, tf as any, since); return; }
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'sub', sym, tf, since, saveId: useS.getState().saveId }));
}

function mergeById<T extends { id: string }>(list: T[], add: T[], cap: number): T[] {
  if (!add.length) return list;
  const map = new Map(list.map((x) => [x.id, x]));
  for (const a of add) map.set(a.id, a);
  const arr = [...map.values()];
  return arr.length > cap ? arr.slice(arr.length - cap) : arr;
}

function onTick(m: TickMessage) {
  const s = useS.getState();
  if (m.saveId !== s.saveId) return; // 防止串号
  pushQuotes(m.clock.t, m.quotes);
  const patch: any = { tick: m };
  if (m.news.length) patch.news = mergeById(s.news, m.news, 300).sort((a, b) => a.t - b.t);
  if (m.aiLog.length) patch.aiLog = [...s.aiLog, ...m.aiLog].slice(-300);
  if (m.trades.length) patch.trades = [...s.trades, ...m.trades].slice(-800);
  if (m.equityPoint && (!s.curve.length || s.curve[s.curve.length - 1].t !== m.equityPoint.t)) patch.curve = [...s.curve, m.equityPoint].slice(-3000);
  if (m.notices.length) {
    patch.notices = [...s.notices, ...m.notices].slice(-100);
    patch.toasts = [...s.toasts, ...m.notices].slice(-5);
    for (const n of m.notices) {
      setTimeout(() => useS.setState((x) => ({ toasts: x.toasts.filter((y) => y.seq !== n.seq) })), n.big ? 7000 : 5000);
      if (n.code === 'stopout') pushEffect({ kind: 'stopout', text: n.text });
      else if ((n.code === 'major-news' || n.code === 'breaking') && n.big) pushEffect({ kind: 'breaking', text: n.text });
      else if (n.code === 'margin-call') pushEffect({ kind: 'margin-call', text: n.text });
      else if (n.code === 'gameover') pushEffect({ kind: 'gameover', text: n.text });
    }
  }
  for (const tr of m.trades) {
    if (tr.action === 'open' || tr.action.startsWith('fill')) continue;
    const big = Math.abs(tr.pnl) >= m.account.initialCapital * 0.02;
    if (big) pushEffect({ kind: tr.pnl >= 0 ? 'profit' : 'loss', value: tr.pnl });
  }
  useS.setState(patch);
  if (m.bars) barHandler?.(m);
}

async function onMessage(m: any) {
  if (m.type === 'hello' || m.type === 'reload') {
    await loadMeta();
    await loadState();
  } else if (m.type === 'tick') {
    onTick(m);
  }
}

export function connectWs() {
  if (STANDALONE) {
    localReady = import('./local/backend').then(async (b) => {
      local = await b.startLocal((m) => void onMessage(m));
      useS.setState({ connected: true });
    });
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => useS.setState({ connected: true });
  ws.onclose = () => {
    useS.setState({ connected: false });
    setTimeout(connectWs, 1500);
  };
  ws.onmessage = (ev) => void onMessage(JSON.parse(ev.data));
}
