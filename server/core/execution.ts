// 订单执行 / 撮合：市价、限价、止损(逆指值)挂单，止盈止损、追踪止损，部分平仓。
// 玩家与 AI 交易员的所有订单都经过这里，规则完全相同。
import type { I18nText, OrderType, PendingOrder, Position, Side, Source, TradeAction, TradeRecord } from '../../shared/types';
import { PAIR_MAP } from '../../shared/instruments';
import type { Rng } from './rng';
import { positionMargin, priceDiff, summarize, toAcct, type ValCtx } from './account';

export interface ExecCtx extends ValCtx {
  rngExec: Rng;
  t: number;
  nextId(prefix: string): string;
  notify(level: 'info' | 'warn' | 'danger' | 'success' | 'news', code: string, text: I18nText, big?: boolean): void;
  recordTrade(r: Omit<TradeRecord, 'id' | 't' | 'balanceAfter'>): TradeRecord;
  marketOpen(): boolean;
}

export interface OrderRequest {
  sym: string;
  side: Side;
  type: OrderType;
  units: number;
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
  trailPips?: number | null;
  source: Source;
  comment?: string;
}

export interface ExecResult {
  ok: boolean;
  code?: string;
  message?: I18nText;
  positionId?: string;
  orderId?: string;
  price?: number;
  slippagePips?: number;
  pnl?: number;
}

const ERR: Record<string, I18nText> = {
  closed: { zh: '市场休市中，无法交易', ja: '市場は休場中のため取引できません' },
  gameover: { zh: '游戏已结束（破产）', ja: 'ゲームオーバー（破産）です' },
  sym: { zh: '无效的货币对', ja: '無効な通貨ペアです' },
  units: { zh: '交易数量无效或超出范围', ja: '取引数量が無効、または範囲外です' },
  price: { zh: '挂单价格无效（限价/止损价方向不正确）', ja: '注文価格が無効です（指値/逆指値の方向が不正）' },
  sl: { zh: '止损价位置无效', ja: '損切り価格が無効です' },
  tp: { zh: '止盈价位置无效', ja: '利確価格が無効です' },
  margin: { zh: '可用保证金不足', ja: '有効証拠金が不足しています' },
  equity: { zh: '账户净值为负，禁止新开仓', ja: '純資産がマイナスのため新規注文できません' },
  notfound: { zh: '找不到该持仓或订单', ja: '該当するポジション/注文がありません' },
};

function fail(code: string): ExecResult {
  return { ok: false, code, message: ERR[code] };
}

function roundPx(sym: string, v: number) {
  const m = 10 ** PAIR_MAP[sym].digits;
  return Math.round(v * m) / m;
}

/** 滑点（不利方向，pips）。流动性越差（点差越大）滑点越大。使用独立的成交随机数，不影响行情序列。 */
export function slippagePips(ctx: ExecCtx, sym: string, kind: 'market' | 'stop' | 'limit'): number {
  const s = ctx.st.risk.slippage;
  if (s <= 0 || kind === 'limit') return 0;
  const p = PAIR_MAP[sym];
  const q = ctx.quotes[sym];
  const liq = Math.max(1, q.spread / p.baseSpread);
  const base = kind === 'market' ? (ctx.rngExec.chance(0.3) ? ctx.rngExec.exp(0.15) : 0) : ctx.rngExec.exp(0.25);
  return Math.round(Math.min(base * liq * s, p.baseSpread * 60) * 10) / 10;
}

function validStops(side: Side, ref: number, sl: number | null | undefined, tp: number | null | undefined): string | null {
  if (sl != null && (!(sl > 0) || (side === 'buy' ? sl >= ref : sl <= ref))) return 'sl';
  if (tp != null && (!(tp > 0) || (side === 'buy' ? tp <= ref : tp >= ref))) return 'tp';
  return null;
}

function validUnits(ctx: ExecCtx, units: number) {
  const r = ctx.st.risk;
  return Number.isFinite(units) && Number.isInteger(units) && units >= r.minUnits && units <= r.maxUnitsPerOrder;
}

export function placeOrder(ctx: ExecCtx, req: OrderRequest): ExecResult {
  if (ctx.st.gameOver) return fail('gameover');
  if (!PAIR_MAP[req.sym]) return fail('sym');
  if (req.side !== 'buy' && req.side !== 'sell') return fail('sym');
  if (!validUnits(ctx, req.units)) return fail('units');
  const q = ctx.quotes[req.sym];
  const sl = req.sl ?? null, tp = req.tp ?? null;
  const trail = req.trailPips != null && req.trailPips > 0 ? req.trailPips : null;

  if (req.type === 'market') {
    if (!ctx.marketOpen()) return fail('closed');
    const slip = slippagePips(ctx, req.sym, 'market');
    const pip = PAIR_MAP[req.sym].pip;
    const price = roundPx(req.sym, req.side === 'buy' ? q.ask + slip * pip : q.bid - slip * pip);
    const ref = req.side === 'buy' ? q.bid : q.ask;
    const bad = validStops(req.side, ref, sl, tp);
    if (bad) return fail(bad);
    return openPosition(ctx, { sym: req.sym, side: req.side, units: req.units, price, sl, tp, trail, source: req.source, comment: req.comment, slip, action: 'open' });
  }

  const price = req.price;
  if (price == null || !(price > 0)) return fail('price');
  const px = req.side === 'buy' ? q.ask : q.bid;
  const okDir = req.type === 'limit' ? (req.side === 'buy' ? price < px : price > px) : (req.side === 'buy' ? price > px : price < px);
  if (!okDir) return fail('price');
  const bad = validStops(req.side, price, sl, tp);
  if (bad) return fail(bad);
  const o: PendingOrder = {
    id: ctx.nextId('o'), sym: req.sym, side: req.side, type: req.type, price: roundPx(req.sym, price), units: req.units,
    sl, tp, trailPips: trail, createdAt: ctx.t, source: req.source, comment: req.comment,
  };
  ctx.st.orders.push(o);
  return { ok: true, orderId: o.id };
}

interface OpenParams {
  sym: string; side: Side; units: number; price: number; sl: number | null; tp: number | null; trail: number | null;
  source: Source; comment?: string; slip: number; action: TradeAction;
}

function openPosition(ctx: ExecCtx, a: OpenParams): ExecResult {
  const pos: Position = {
    id: ctx.nextId('p'), sym: a.sym, side: a.side, units: a.units, openPrice: a.price, openTime: ctx.t,
    sl: a.sl != null ? roundPx(a.sym, a.sl) : null, tp: a.tp != null ? roundPx(a.sym, a.tp) : null,
    trailPips: a.trail, trailRef: null, swap: 0, source: a.source, comment: a.comment,
  };
  const sum = summarize(ctx);
  if (sum.equity <= 0) return fail('equity');
  const req = positionMargin(ctx, a.sym, a.units);
  const pnl0 = priceDiff(pos, ctx.quotes[a.sym]) * a.units * toAcct(ctx, PAIR_MAP[a.sym].quote);
  if (sum.equity + pnl0 - sum.usedMargin - req < 0) return fail('margin');
  ctx.st.positions.push(pos);
  ctx.recordTrade({
    sym: a.sym, side: a.side, action: a.action, units: a.units, price: a.price, pnl: 0, swap: 0,
    slippagePips: a.slip, positionId: pos.id, source: a.source,
  });
  return { ok: true, positionId: pos.id, price: a.price, slippagePips: a.slip };
}

export function closePosition(ctx: ExecCtx, id: string, units: number | null, action: TradeAction = 'close'): ExecResult {
  const pos = ctx.st.positions.find((p) => p.id === id);
  if (!pos) return fail('notfound');
  if (!ctx.marketOpen()) return fail('closed');
  const u = units == null ? pos.units : units;
  if (!Number.isInteger(u) || u <= 0 || u > pos.units) return fail('units');
  const p = PAIR_MAP[pos.sym];
  const q = ctx.quotes[pos.sym];
  const kind = action === 'tp' ? 'limit' : action === 'close' || action === 'partial' ? 'market' : 'stop';
  const slip = slippagePips(ctx, pos.sym, kind);
  const exit = roundPx(pos.sym, pos.side === 'buy' ? q.bid - slip * p.pip : q.ask + slip * p.pip);
  const diff = pos.side === 'buy' ? exit - pos.openPrice : pos.openPrice - exit;
  const swapPart = pos.swap * (u / pos.units);
  const pnl = diff * u * toAcct(ctx, p.quote) + swapPart;
  const acc = ctx.st.account;
  acc.balance += pnl;
  acc.realized += pnl;
  acc.totalSwap += swapPart;
  pos.swap -= swapPart;
  pos.units -= u;
  if (pos.units === 0) ctx.st.positions = ctx.st.positions.filter((x) => x !== pos);
  const stats = ctx.st.stats;
  stats.trades++;
  if (pnl >= 0) stats.wins++; else stats.losses++;
  stats.biggestWin = Math.max(stats.biggestWin, pnl);
  stats.biggestLoss = Math.min(stats.biggestLoss, pnl);
  const realAction: TradeAction = action === 'close' && pos.units > 0 ? 'partial' : action;
  ctx.recordTrade({
    sym: pos.sym, side: pos.side, action: realAction, units: u, price: exit, openPrice: pos.openPrice, pnl, swap: swapPart,
    slippagePips: slip, positionId: pos.id, source: pos.source,
  });
  return { ok: true, positionId: pos.id, price: exit, slippagePips: slip, pnl };
}

export function modifyPosition(ctx: ExecCtx, id: string, sl: number | null, tp: number | null, trailPips: number | null): ExecResult {
  const pos = ctx.st.positions.find((p) => p.id === id);
  if (!pos) return fail('notfound');
  const q = ctx.quotes[pos.sym];
  const ref = pos.side === 'buy' ? q.bid : q.ask;
  const bad = validStops(pos.side, ref, sl, tp);
  if (bad) return fail(bad);
  pos.sl = sl != null ? roundPx(pos.sym, sl) : null;
  pos.tp = tp != null ? roundPx(pos.sym, tp) : null;
  pos.trailPips = trailPips != null && trailPips > 0 ? trailPips : null;
  pos.trailRef = null;
  return { ok: true, positionId: id };
}

export function cancelOrder(ctx: ExecCtx, id: string): ExecResult {
  const n = ctx.st.orders.length;
  ctx.st.orders = ctx.st.orders.filter((o) => o.id !== id);
  return n === ctx.st.orders.length ? fail('notfound') : { ok: true, orderId: id };
}

/** 每个子步检查挂单触发、止盈止损与追踪止损 */
export function processTriggers(ctx: ExecCtx) {
  const st = ctx.st;
  for (const o of [...st.orders]) {
    const q = ctx.quotes[o.sym];
    const px = o.side === 'buy' ? q.ask : q.bid;
    const hit = o.type === 'limit' ? (o.side === 'buy' ? px <= o.price : px >= o.price) : (o.side === 'buy' ? px >= o.price : px <= o.price);
    if (!hit) continue;
    st.orders = st.orders.filter((x) => x !== o);
    const slip = o.type === 'stop' ? slippagePips(ctx, o.sym, 'stop') : 0;
    const pip = PAIR_MAP[o.sym].pip;
    const price = roundPx(o.sym, o.side === 'buy' ? px + slip * pip : px - slip * pip);
    const r = openPosition(ctx, {
      sym: o.sym, side: o.side, units: o.units, price, sl: o.sl, tp: o.tp, trail: o.trailPips, source: o.source,
      comment: o.comment, slip, action: o.type === 'limit' ? 'fill-limit' : 'fill-stop',
    });
    if (r.ok) {
      ctx.notify('info', 'order-filled', { zh: `挂单成交：${o.sym} ${o.side === 'buy' ? '买入' : '卖出'} ${o.units} @ ${price}`, ja: `注文約定：${o.sym} ${o.side === 'buy' ? '買' : '売'} ${o.units} @ ${price}` });
    } else {
      ctx.notify('warn', 'order-rejected', { zh: `挂单触发但被拒绝：${r.message?.zh}`, ja: `注文が発動しましたが拒否：${r.message?.ja}` });
    }
  }

  for (const pos of [...st.positions]) {
    if (!st.positions.includes(pos)) continue;
    const q = ctx.quotes[pos.sym];
    const pip = PAIR_MAP[pos.sym].pip;
    const mark = pos.side === 'buy' ? q.bid : q.ask;
    if (pos.trailPips) {
      if (pos.side === 'buy') {
        pos.trailRef = Math.max(pos.trailRef ?? mark, mark);
        const ns = roundPx(pos.sym, pos.trailRef - pos.trailPips * pip);
        if (pos.sl === null || ns > pos.sl) pos.sl = ns;
      } else {
        pos.trailRef = Math.min(pos.trailRef ?? mark, mark);
        const ns = roundPx(pos.sym, pos.trailRef + pos.trailPips * pip);
        if (pos.sl === null || ns < pos.sl) pos.sl = ns;
      }
    }
    const slHit = pos.sl !== null && (pos.side === 'buy' ? mark <= pos.sl : mark >= pos.sl);
    const tpHit = pos.tp !== null && (pos.side === 'buy' ? mark >= pos.tp : mark <= pos.tp);
    if (slHit) {
      const r = closePosition(ctx, pos.id, null, pos.trailPips ? 'trail' : 'sl');
      if (r.ok) ctx.notify(r.pnl! >= 0 ? 'info' : 'warn', 'sl', { zh: `止损成交 ${pos.sym}：${fmtMoney(r.pnl!)}`, ja: `損切り約定 ${pos.sym}：${fmtMoney(r.pnl!)}` });
    } else if (tpHit) {
      const r = closePosition(ctx, pos.id, null, 'tp');
      if (r.ok) ctx.notify('success', 'tp', { zh: `止盈成交 ${pos.sym}：${fmtMoney(r.pnl!)}`, ja: `利確約定 ${pos.sym}：${fmtMoney(r.pnl!)}` });
    }
  }
}

export function fmtMoney(v: number) {
  const s = Math.round(v).toLocaleString('en-US');
  return v > 0 ? `+${s}` : s;
}
