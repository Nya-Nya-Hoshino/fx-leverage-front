// 与传输无关的 API 路由：桌面/服务端通过 Express 调用，安卓离线版在 WebView 内直接调用。
import { z } from 'zod';
import type { TF } from '../shared/types';
import { TFS } from '../shared/types';
import { PAIRS, PAIR_MAP, LEVERAGE_OPTIONS } from '../shared/instruments';
import type { Runtime } from './runtime';
import type { GameStore } from './store';
import { LOAN_PLANS, PLAN_NAME, repayable } from './core/loans';
import { isMarketOpen } from './core/clock';

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  body: any;
  saveId: string | null;
}

type Handler = (req: ApiRequest, params: Record<string, string>) => unknown | Promise<unknown>;

const CreateSave = z.object({
  name: z.string().trim().min(1).max(40),
  username: z.string().trim().min(1).max(24),
  accountCcy: z.enum(['JPY', 'CNY']),
  maxLeverage: z.number().min(1).max(1_000_000),
  seed: z.number().int().nonnegative().optional(),
  marketMode: z.enum(['random', 'ai']).default('random'),
});
const OrderBody = z.object({
  sym: z.string(), side: z.enum(['buy', 'sell']), type: z.enum(['market', 'limit', 'stop']),
  units: z.number().int().positive(), price: z.number().positive().nullable().optional(),
  sl: z.number().positive().nullable().optional(), tp: z.number().positive().nullable().optional(),
  trailPips: z.number().positive().nullable().optional(),
});
const MarketSettingsBody = z.object({
  volMult: z.number().min(0.1).max(10), trendStrength: z.number().min(0).max(5), meanReversion: z.number().min(0).max(10),
  jumpRate: z.number().min(0).max(20), blackSwanPerYear: z.number().min(0).max(500), gapMult: z.number().min(0).max(10),
  spreadMult: z.number().min(0.1).max(20), newsImpact: z.number().min(0).max(10), sessionEffects: z.boolean(),
}).partial();
const RiskBody = z.object({
  marginCallLevel: z.number().min(1).max(1000), stopOutLevel: z.number().min(0).max(1000),
  stopOutMode: z.enum(['all', 'worst']), negativeBalanceProtection: z.boolean(), slippage: z.number().min(0).max(10),
  lotUnits: z.number().int().min(1).max(1_000_000), minUnits: z.number().int().min(1).max(1_000_000),
  maxUnitsPerOrder: z.number().int().min(1).max(1_000_000_000),
}).partial();
const AutoTraderBody = z.object({
  enabled: z.boolean(), strategy: z.enum(['trend', 'meanrev', 'breakout', 'gambler']),
  risk: z.enum(['conservative', 'balanced', 'aggressive', 'degenerate']), maxLotsPerOrder: z.number().positive().max(100000),
  maxPositions: z.number().int().min(1).max(50), maxEffectiveLeverage: z.number().positive().max(1_000_000),
  pairs: z.array(z.string()).max(30), requireStopLoss: z.boolean(), tf: z.enum(TFS as [TF, ...TF[]]), notes: z.string().max(1000),
}).partial();
const RoleBody = z.object({
  enabled: z.boolean(), profileId: z.string().nullable(), intervalSec: z.number().min(5).max(3600), temperature: z.number().min(0).max(2),
}).partial();
export const ProfileBody = z.object({
  id: z.string().optional(), name: z.string().trim().min(1).max(40), provider: z.enum(['openai', 'anthropic']),
  baseUrl: z.string().url(), apiKey: z.string().max(500).nullable().optional(), model: z.string().trim().min(1).max(100),
  maxTokens: z.number().int().min(64).max(64000).default(4000), timeoutMs: z.number().int().min(2000).max(300000).default(90000),
  jsonMode: z.boolean().default(true), priceIn: z.number().min(0).default(0), priceOut: z.number().min(0).default(0),
  minIntervalMs: z.number().int().min(0).max(600000).default(3000), maxRetries: z.number().int().min(0).max(5).default(2),
  extraBody: z.string().max(2000).default('').refine((s) => { if (!s.trim()) return true; try { const j = JSON.parse(s); return !!j && typeof j === 'object' && !Array.isArray(j); } catch { return false; } }, 'extraBody 必须是 JSON 对象'),
});

export function createApi(rt: Runtime, store: GameStore) {
  const routes: { method: string; pattern: RegExp; keys: string[]; fn: Handler }[] = [];
  const add = (method: string, path: string, fn: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, pattern, keys, fn });
  };

  const game = () => {
    if (!rt.game) throw new Error('当前没有载入存档');
    return rt.game;
  };
  /** 所有改变游戏状态的请求都必须携带当前存档 ID，防止存档切换时串号 */
  const guard = (req: ApiRequest) => {
    const g = game();
    if (req.saveId !== g.st.saveId) throw new Error('存档已切换，请刷新页面（save id mismatch）');
    return g;
  };
  const after = <T,>(r: T): T => { rt.broadcast(); return r; };

  // ---------- 元信息与存档 ----------
  add('GET', '/api/meta', () => ({
    pairs: PAIRS, tfs: TFS, leverageOptions: LEVERAGE_OPTIONS,
    loanPlans: LOAN_PLANS.map((p) => ({ ...p, name: PLAN_NAME[p.id] })),
    activeSaveId: rt.game?.st.saveId ?? null, lastSaveId: store.getMeta('lastSave'),
  }));
  add('GET', '/api/saves', () => store.listSaves());
  add('POST', '/api/saves', async (req) => ({ ok: true, saveId: (await rt.create(CreateSave.parse(req.body))).st.saveId }));
  add('POST', '/api/saves/:id/load', async (_r, p) => ({ ok: true, saveId: (await rt.load(p.id)).st.saveId }));
  add('POST', '/api/saves/:id/reset', async (_r, p) => ({ ok: true, saveId: (await rt.reset(p.id)).st.saveId }));
  add('DELETE', '/api/saves/:id', async (_r, p) => { await rt.remove(p.id); return { ok: true }; });
  add('POST', '/api/save', (req) => { guard(req); rt.persist(); return { ok: true, savedAt: Date.now() }; });
  add('POST', '/api/unload', async () => { await rt.unload(); rt.broadcastReload(); return { ok: true }; });

  // ---------- 状态 ----------
  add('GET', '/api/state', () => {
    const g = rt.game;
    if (!g) return { active: false };
    const st = g.st;
    return {
      active: true,
      saveId: st.saveId, name: st.name, username: st.account.username, seed: st.seed,
      marketSettings: st.marketSettings, risk: st.risk, autoTrader: st.autoTrader, roles: st.ai.roles,
      news: st.news.slice(-150), notices: st.notices.slice(-30), aiLog: st.aiLog.slice(-200), trades: st.trades.slice(-500),
      equityCurve: st.equityCurve, profiles: rt.profilesPublic(), repayable: repayable(g),
      tick: { ...rt.tickBase(g, { notices: [], news: [], aiLog: [], trades: [], releases: [], majorEvent: false }), bars: null },
    };
  });
  add('GET', '/api/candles', (req) => {
    const g = game();
    const sym = String(req.query.sym);
    const tf = String(req.query.tf) as TF;
    if (!PAIR_MAP[sym] || !TFS.includes(tf)) throw new Error('bad sym/tf');
    const limit = Math.min(3000, Number(req.query.limit ?? 600));
    return { saveId: g.st.saveId, sym, tf, bars: g.candles.bars(sym, tf, limit) };
  });

  /** 迷你走势图/综合走势图的种子数据：每个货币对最近 n 根 15s K 线收盘价（Bid） */
  add('GET', '/api/sparks', (req) => {
    const g = game();
    const n = Math.max(10, Math.min(400, Number(req.query.n ?? 160)));
    return { saveId: g.st.saveId, series: Object.fromEntries(PAIRS.map((p) => [p.sym, g.candles.bars(p.sym, '15s', n).map((b) => [b.t, b.c])])) };
  });

  // ---------- 交易 ----------
  add('POST', '/api/order', (req) => after(guard(req).order({ ...OrderBody.parse(req.body), source: 'player' })));
  add('POST', '/api/positions/:id/close', (req, p) => {
    const b = z.object({ units: z.number().int().positive().nullable().optional() }).parse(req.body ?? {});
    return after(guard(req).close(p.id, b.units ?? null));
  });
  add('POST', '/api/positions/:id/modify', (req, p) => {
    const b = z.object({ sl: z.number().positive().nullable(), tp: z.number().positive().nullable(), trailPips: z.number().positive().nullable() }).parse(req.body);
    return after(guard(req).modify(p.id, b.sl, b.tp, b.trailPips));
  });
  add('POST', '/api/close-all', (req) => {
    const b = z.object({ sym: z.string().optional(), source: z.enum(['player', 'ai']).optional() }).parse(req.body ?? {});
    const r = guard(req).closeAll(b);
    return after({ ok: r.every((x) => x.ok), results: r });
  });
  add('POST', '/api/orders/:id/cancel', (req, p) => after(guard(req).cancel(p.id)));

  // ---------- 借贷与破产 ----------
  add('POST', '/api/loans/borrow', (req) => {
    const b = z.object({ amount: z.number().positive(), planId: z.string() }).parse(req.body);
    return after(guard(req).borrow(b.amount, b.planId));
  });
  add('POST', '/api/loans/:id/repay', (req, p) => {
    const b = z.object({ amount: z.number().positive() }).parse(req.body);
    const g = guard(req);
    const r = g.repay(p.id, b.amount);
    return after({ ...r, repayable: repayable(g) });
  });
  add('GET', '/api/loans/repayable', () => ({ repayable: repayable(game()) }));
  add('POST', '/api/bankrupt', (req) => { guard(req).setGameOver('declared'); return after({ ok: true }); });

  // ---------- 模拟时钟 ----------
  add('POST', '/api/sim', (req) => {
    const g = guard(req);
    const b = z.object({
      paused: z.boolean().optional(), speed: z.number().min(0.25).max(3600).optional(),
      tickMs: z.number().int().min(500).max(10000).optional(), autoSkipWeekend: z.boolean().optional(),
    }).parse(req.body);
    if (g.st.gameOver && b.paused === false) throw new Error('游戏已结束');
    Object.assign(g.st.clock, b);
    return after({ ok: true, clock: g.st.clock });
  });
  add('POST', '/api/sim/skip-weekend', (req) => {
    const g = guard(req);
    if (isMarketOpen(g.t)) throw new Error('市场未休市');
    return after({ ok: g.skipWeekend() });
  });

  // ---------- 设置 ----------
  add('POST', '/api/settings', (req) => {
    const g = guard(req);
    const b = z.object({
      market: MarketSettingsBody.optional(), risk: RiskBody.optional(), autoTrader: AutoTraderBody.optional(),
      marketMode: z.enum(['random', 'ai']).optional(),
      roles: z.object({ news: RoleBody.optional(), macro: RoleBody.optional(), trader: RoleBody.optional() }).optional(),
    }).parse(req.body);
    if (b.market) Object.assign(g.st.marketSettings, b.market);
    if (b.risk) {
      const r = { ...g.st.risk, ...b.risk };
      if (r.stopOutLevel >= r.marginCallLevel) throw new Error('强平线必须低于预警线');
      if (r.minUnits > r.maxUnitsPerOrder) throw new Error('最小单位不能大于最大单位');
      g.st.risk = r;
    }
    if (b.autoTrader) {
      if (b.autoTrader.pairs) b.autoTrader.pairs = b.autoTrader.pairs.filter((x) => PAIR_MAP[x]);
      const wasOn = g.st.autoTrader.enabled;
      Object.assign(g.st.autoTrader, b.autoTrader);
      if (!wasOn && g.st.autoTrader.enabled) g.st.ai.acc.trader = g.st.ai.roles.trader.intervalSec; // 开启后立即看盘
    }
    if (b.marketMode && b.marketMode !== g.st.market.mode) {
      g.st.market.mode = b.marketMode;
      g.st.ai.acc.macro = g.st.ai.roles.macro.intervalSec;
      if (b.marketMode === 'random' && g.st.market.macro?.source === 'ai') g.st.market.macro.until = g.t;
    }
    if (b.roles) {
      for (const k of ['news', 'macro', 'trader'] as const) if (b.roles[k]) Object.assign(g.st.ai.roles[k], b.roles[k]);
    }
    return after({ ok: true });
  });
  add('POST', '/api/ai/trader/run-now', async (req) => { guard(req); await rt.runTrader(true); return { ok: true }; });

  // ---------- AI 配置（密钥只写不读） ----------
  add('GET', '/api/ai/profiles', () => rt.profilesPublic());
  add('POST', '/api/ai/profiles', (req) => ({ ok: true, id: rt.saveProfile(ProfileBody.parse(req.body)) }));
  add('DELETE', '/api/ai/profiles/:id', (_r, p) => { store.deleteProfile(p.id); return { ok: true }; });
  add('POST', '/api/ai/profiles/:id/test', (_r, p) => rt.testProfile(p.id));

  /** 处理一个请求；返回 [HTTP 状态码, JSON] */
  async function handle(req: ApiRequest): Promise<[number, unknown]> {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(req.path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        return [200, (await r.fn(req, params)) ?? { ok: true }];
      } catch (e: any) {
        const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : String(e?.message ?? e);
        return [400, { ok: false, error: msg }];
      }
    }
    return [404, { ok: false, error: `not found: ${req.method} ${req.path}` }];
  }

  return { handle };
}
