// 数学行情引擎：每种货币一个对数强弱因子，所有货币对 = 两个因子之差的指数，
// 因此交叉汇率天然满足三角一致性（不存在三角套利）。
// 模型组成：趋势(OU) + 宏观漂移 + 均值回归 + 风险情绪/欧洲区块共同因子 + GARCH 式波动聚集
//          + 时段波动 + 市场状态（趋势/震荡/恐慌/低流动性/闪崩）+ 冲击队列 + 小幅跳跃。
import type { Ccy, MarketMode, MarketSettings, PairDef, Quote, RegimeKind, I18nText } from '../../shared/types';
import { CCYS, CCY_INFO, PAIR_MAP, PAIRS } from '../../shared/instruments';
import { Rng } from './rng';
import { sessionSpread, sessionVol } from './clock';

const YEAR = 365 * 86400;

export interface CcyFactor {
  x: number;          // 对数因子
  v: number;          // 条件方差倍数（均值约 1）
  trend: number;      // 随机趋势（年化对数漂移）
  anchor: number;     // 均值回归锚点
  macroDrift: number; // 宏观指令漂移（年化）
  macroVol: number;   // 宏观指令波动倍数
  volBoost: number;   // 事件引起的额外波动（衰减）
  spreadBoost: number;// 事件引起的点差扩大（衰减）
}

export interface Shock {
  ccy: Ccy | 'RISK';
  remaining: number;  // 尚未施加的对数变动
  rate: number;       // 每秒施加量（绝对值）
}

export interface MacroDirective {
  source: 'ai' | 'local';
  t: number;
  until: number;
  regime: RegimeKind | null;
  risk: number;
  ccys: Partial<Record<Ccy, { bias: number; vol: number }>>;
  commentary: string;
}

export interface MarketState {
  mode: MarketMode;
  f: Record<Ccy, CcyFactor>;
  regime: { kind: RegimeKind; until: number; focus: Ccy | null; mag: number };
  risk: number;
  riskTarget: number;
  shocks: Shock[];
  reopenSpread: number;
  closed: boolean;
  nextRegimeCheck: number;
  nextLocalMacro: number;
  macro: MacroDirective | null;
  day: { key: number; open: Record<string, number>; high: Record<string, number>; low: Record<string, number> };
}

export const REGIME_LABEL: Record<RegimeKind, I18nText> = {
  normal: { zh: '常态', ja: '通常' },
  trend: { zh: '趋势行情', ja: 'トレンド相場' },
  range: { zh: '震荡行情', ja: 'レンジ相場' },
  panic: { zh: '恐慌抛售', ja: 'パニック相場' },
  illiquid: { zh: '流动性枯竭', ja: '流動性低下' },
  flash: { zh: '闪崩', ja: 'フラッシュクラッシュ' },
};

const REGIME_PARAMS: Record<RegimeKind, { vol: number; spread: number; kappa: number; jump: number }> = {
  normal: { vol: 1, spread: 1, kappa: 1, jump: 1 },
  trend: { vol: 1.1, spread: 1, kappa: 0.3, jump: 1 },
  range: { vol: 0.75, spread: 0.9, kappa: 25, jump: 0.6 },
  panic: { vol: 2.3, spread: 3, kappa: 0.5, jump: 3 },
  illiquid: { vol: 1.4, spread: 3.5, kappa: 1, jump: 2 },
  flash: { vol: 3, spread: 8, kappa: 0.2, jump: 4 },
};

export function initMarket(rng: Rng, t: number, mode: MarketMode): MarketState {
  const f = {} as Record<Ccy, CcyFactor>;
  for (const c of CCYS) {
    f[c] = { x: 0, v: 1, trend: rng.normal() * 0.3, anchor: 0, macroDrift: 0, macroVol: 1, volBoost: 0, spreadBoost: 0 };
  }
  const ms: MarketState = {
    mode,
    f,
    regime: { kind: 'normal', until: t + 3 * 3600, focus: null, mag: 0 },
    risk: 0,
    riskTarget: 0,
    shocks: [],
    reopenSpread: 0,
    closed: false,
    nextRegimeCheck: t + 900,
    nextLocalMacro: t,
    macro: null,
    day: { key: dayKey(t), open: {}, high: {}, low: {} },
  };
  return ms;
}

export function dayKey(t: number): number {
  return Math.floor((t + 3 * 3600) / 86400);
}

/** 1 单位货币 = ? USD */
export function usdPer(ms: MarketState): Record<Ccy, number> {
  const out = {} as Record<Ccy, number>;
  const xu = ms.f.USD.x;
  for (const c of CCYS) {
    const info = CCY_INFO[c];
    out[c] = c === 'USD' ? 1 : info.usdPer * Math.exp(ms.f[c].x + (info.peg - 1) * xu);
  }
  return out;
}

export function midOf(ms: MarketState, sym: string, up = usdPer(ms)): number {
  const p = PAIR_MAP[sym];
  return up[p.base] / up[p.quote];
}

/** 中间价换算：1 单位 from = ? 单位 to */
export function conv(up: Record<Ccy, number>, from: Ccy, to: Ccy): number {
  return up[from] / up[to];
}

export function spreadPips(ms: MarketState, p: PairDef, t: number, s: MarketSettings): number {
  const reg = REGIME_PARAMS[ms.regime.kind];
  const boost = Math.max(ms.f[p.base].spreadBoost, ms.f[p.quote].spreadBoost);
  const sess = s.sessionEffects ? sessionSpread(t) : 1;
  const raw = p.baseSpread * s.spreadMult * sess * reg.spread * (1 + boost) * (1 + ms.reopenSpread);
  return Math.min(raw, p.baseSpread * 400);
}

function roundTo(v: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

export function makeQuotes(ms: MarketState, t: number, s: MarketSettings, prev: Record<string, Quote> | null): Record<string, Quote> {
  const up = usdPer(ms);
  const out: Record<string, Quote> = {};
  const dk = dayKey(t);
  const newDay = dk !== ms.day.key;
  if (newDay) ms.day = { key: dk, open: {}, high: {}, low: {} };
  for (const p of PAIRS) {
    const mid = up[p.base] / up[p.quote];
    const sp = spreadPips(ms, p, t, s);
    const tickSize = 10 ** -p.digits;
    let bid = roundTo(mid - (sp * p.pip) / 2, p.digits);
    let ask = roundTo(mid + (sp * p.pip) / 2, p.digits);
    if (ask <= bid) ask = roundTo(bid + tickSize, p.digits);
    if (bid <= 0) { bid = tickSize; ask = 2 * tickSize; }
    if (ms.day.open[p.sym] === undefined) {
      ms.day.open[p.sym] = bid; ms.day.high[p.sym] = bid; ms.day.low[p.sym] = bid;
    }
    ms.day.high[p.sym] = Math.max(ms.day.high[p.sym], bid);
    ms.day.low[p.sym] = Math.min(ms.day.low[p.sym], bid);
    const pq = prev?.[p.sym];
    const dir: -1 | 0 | 1 = !pq ? 0 : bid > pq.bid ? 1 : bid < pq.bid ? -1 : pq.dir;
    out[p.sym] = {
      sym: p.sym, bid, ask, mid,
      spread: Math.round(((ask - bid) / p.pip) * 10) / 10,
      open: ms.day.open[p.sym], high: ms.day.high[p.sym], low: ms.day.low[p.sym], dir,
    };
  }
  return out;
}

/**
 * 推进行情 dt 秒（模拟时间）。返回每种货币的“活跃度”，用于模拟 Tick Volume。
 */
export function stepMarket(ms: MarketState, dt: number, t: number, rng: Rng, s: MarketSettings): Record<Ccy, number> {
  const activity = {} as Record<Ccy, number>;
  if (dt <= 0) return activity;
  const dtY = dt / YEAR;
  const sq = Math.sqrt(dtY);
  const reg = REGIME_PARAMS[ms.regime.kind];

  // 风险情绪：OU 过程
  ms.risk += (ms.riskTarget - ms.risk) * Math.min(1, dt / 7200) + rng.normal() * 0.04 * Math.sqrt(dt / 60);
  ms.risk = Math.max(-1, Math.min(1, ms.risk));

  const zr = rng.normal();
  const ze = rng.normal();
  const shockApply: Partial<Record<Ccy, number>> = {};
  for (const sh of ms.shocks) {
    const amt = Math.sign(sh.remaining) * Math.min(Math.abs(sh.remaining), sh.rate * dt);
    sh.remaining -= amt;
    if (sh.ccy === 'RISK') {
      for (const c of CCYS) shockApply[c] = (shockApply[c] ?? 0) + amt * CCY_INFO[c].risk;
    } else {
      shockApply[sh.ccy] = (shockApply[sh.ccy] ?? 0) + amt;
    }
  }
  ms.shocks = ms.shocks.filter((x) => Math.abs(x.remaining) > 1e-7);

  for (const c of CCYS) {
    const info = CCY_INFO[c];
    const fc = ms.f[c];
    const sv = s.sessionEffects ? sessionVol(t, info.region) : 1;
    const load2 = info.risk ** 2 + info.euro ** 2;
    const eps = rng.normal() * Math.sqrt(Math.max(0.05, 1 - load2)) + info.risk * zr + info.euro * ze;
    const sigma = info.sigma * s.volMult * sv * reg.vol * Math.sqrt(fc.v) * fc.macroVol * (1 + fc.volBoost);

    // 随机趋势 OU（时间尺度约 2 天）
    fc.trend += -fc.trend * Math.min(1, dt / (2 * 86400)) + rng.normal() * 0.35 * s.trendStrength * Math.sqrt(dt / 86400);

    let drift = fc.trend * s.trendStrength + fc.macroDrift + info.risk * ms.risk * 1.2;
    if (ms.regime.kind === 'trend' && ms.regime.focus === c) drift += ms.regime.mag * s.trendStrength;
    // 均值回归：锚点为 x 的慢速移动平均
    const kappa = 3 * reg.kappa * s.meanReversion * (c === 'HKD' ? 400 : 1);
    drift -= kappa * (fc.x - fc.anchor);
    fc.anchor += (fc.x - fc.anchor) * Math.min(1, dt / (5 * 86400));
    if (c === 'HKD') fc.anchor = 0;

    let dx = drift * dtY + sigma * sq * eps;
    // 小幅跳跃（泊松）
    const lambda = 2 * s.jumpRate * reg.jump * (dt / 86400);
    if (rng.chance(lambda)) {
      const size = rng.exp(0.0006) * info.sigma / 0.07 * s.volMult;
      dx += rng.sign() * size;
    }
    dx += shockApply[c] ?? 0;
    fc.x += dx;

    // GARCH 式波动聚集
    const e2 = eps * eps;
    fc.v += (1 - fc.v) * Math.min(1, dt / (3 * 3600)) + 0.1 * (e2 - 1) * fc.v * Math.min(1, Math.sqrt(dt / 60));
    fc.v = Math.max(0.35, Math.min(5, fc.v));
    fc.volBoost *= Math.exp(-dt / 600);
    fc.spreadBoost *= Math.exp(-dt / 120);
    activity[c] = Math.abs(dx) / Math.max(1e-9, info.sigma * sq) + sv;
  }
  ms.reopenSpread *= Math.exp(-dt / 1200);
  return activity;
}

/** 冲击：size 为对数变动（例如 0.01 ≈ 1%），immediate 部分立即施加，其余在 duration 秒内施加 */
export function applyShock(ms: MarketState, ccy: Ccy | 'RISK', size: number, opts: { immediate?: number; duration?: number; vol?: number; spread?: number } = {}) {
  const imm = opts.immediate ?? 0.6;
  const dur = Math.max(1, opts.duration ?? 300);
  const nowPart = size * imm;
  if (ccy === 'RISK') {
    for (const c of CCYS) ms.f[c].x += nowPart * CCY_INFO[c].risk;
    ms.risk = Math.max(-1, Math.min(1, ms.risk + Math.sign(size) * Math.min(0.6, Math.abs(size) * 40)));
  } else {
    ms.f[ccy].x += nowPart;
  }
  const rest = size - nowPart;
  if (Math.abs(rest) > 1e-9) ms.shocks.push({ ccy, remaining: rest, rate: Math.abs(rest) / dur });
  const targets = ccy === 'RISK' ? CCYS : [ccy];
  for (const c of targets) {
    if (opts.vol) ms.f[c].volBoost = Math.max(ms.f[c].volBoost, opts.vol);
    if (opts.spread) ms.f[c].spreadBoost = Math.max(ms.f[c].spreadBoost, opts.spread);
  }
}

/** 周末重新开市跳空：按休市时长的方差施加 */
export function applyWeekendGap(ms: MarketState, closedSec: number, rng: Rng, s: MarketSettings) {
  const sq = Math.sqrt(closedSec / YEAR) * 0.45 * s.gapMult;
  const zr = rng.normal();
  for (const c of CCYS) {
    const info = CCY_INFO[c];
    const eps = rng.normal() * Math.sqrt(Math.max(0.05, 1 - info.risk ** 2)) + info.risk * zr;
    let g = info.sigma * s.volMult * sq * eps;
    if (rng.chance(0.08 * s.gapMult)) g += rng.sign() * rng.exp(0.004) * info.sigma / 0.07;
    ms.f[c].x += g;
    ms.f[c].volBoost = Math.max(ms.f[c].volBoost, 0.6);
  }
  ms.reopenSpread = Math.max(ms.reopenSpread, 5);
}

/** 本地市场状态切换（随机模式，或 AI 宏观指令过期时） */
export function updateRegime(ms: MarketState, t: number, rng: Rng, s: MarketSettings): RegimeKind | null {
  if (t < ms.nextRegimeCheck) return null;
  ms.nextRegimeCheck = t + 900;
  const aiActive = ms.mode === 'ai' && ms.macro?.source === 'ai' && ms.macro.until > t;
  if (aiActive) {
    if (ms.macro!.regime && ms.macro!.regime !== ms.regime.kind && ms.regime.kind !== 'flash') {
      setRegime(ms, ms.macro!.regime, t, rng, s);
      return ms.regime.kind;
    }
    return null;
  }
  if (t < ms.regime.until) return null;
  const w: [RegimeKind, number][] = [
    ['normal', 0.45], ['trend', 0.27], ['range', 0.2], ['panic', 0.03 * s.jumpRate], ['illiquid', 0.05],
  ];
  const tot = w.reduce((a, b) => a + b[1], 0);
  let r = rng.next() * tot;
  let kind: RegimeKind = 'normal';
  for (const [k, p] of w) { if ((r -= p) <= 0) { kind = k; break; } }
  const prev = ms.regime.kind;
  setRegime(ms, kind, t, rng, s);
  return kind !== prev ? kind : null;
}

export function setRegime(ms: MarketState, kind: RegimeKind, t: number, rng: Rng, s: MarketSettings) {
  const dur: Record<RegimeKind, [number, number]> = {
    normal: [2, 8], trend: [1, 6], range: [1, 5], panic: [0.3, 1.5], illiquid: [0.5, 2], flash: [0.1, 0.25],
  };
  const [a, b] = dur[kind];
  ms.regime = { kind, until: t + rng.range(a, b) * 3600, focus: null, mag: 0 };
  if (kind === 'trend') {
    ms.regime.focus = rng.pick(['USD', 'JPY', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'CHF'] as Ccy[]);
    ms.regime.mag = rng.sign() * rng.range(1.5, 4.5);
  }
  if (kind === 'panic') ms.riskTarget = -0.8;
  else if (kind === 'normal' || kind === 'range') ms.riskTarget = ms.macro?.risk ?? 0;
}

/** 本地宏观倾向生成器：随机模式 / AI 不可用时的离线降级 */
export function localMacro(ms: MarketState, t: number, rng: Rng, s: MarketSettings): MacroDirective | null {
  if (t < ms.nextLocalMacro) return null;
  if (ms.mode === 'ai' && ms.macro?.source === 'ai' && ms.macro.until > t) return null;
  const hours = rng.range(2, 6);
  ms.nextLocalMacro = t + hours * 3600;
  const ccys: MacroDirective['ccys'] = {};
  for (const c of CCYS) ccys[c] = { bias: Math.max(-1, Math.min(1, rng.normal() * 0.35)), vol: Math.exp(rng.normal() * 0.12) };
  const dir: MacroDirective = {
    source: 'local', t, until: t + hours * 3600, regime: null,
    risk: Math.max(-1, Math.min(1, rng.normal() * 0.35)), ccys, commentary: 'local',
  };
  applyMacro(ms, dir, rng, s);
  return dir;
}

/**
 * 应用宏观指令。宏观倾向只改变“概率分布”（漂移/波动），并叠加随机噪声与方向不确定性，
 * 不会直接决定价格，也不读取任何玩家持仓。
 */
export function applyMacro(ms: MarketState, dir: MacroDirective, rng: Rng, s: MarketSettings) {
  ms.macro = dir;
  ms.riskTarget = dir.risk;
  for (const c of CCYS) {
    const d = dir.ccys[c];
    const bias = d ? d.bias : 0;
    // 不确定性：强度随机缩放 0.3~1.3，并有 12% 概率完全不兑现
    const realize = rng.chance(0.12) ? 0 : rng.range(0.3, 1.3);
    ms.f[c].macroDrift = bias * 2.2 * s.trendStrength * realize;
    ms.f[c].macroVol = Math.max(0.5, Math.min(3, d ? d.vol : 1));
  }
}
