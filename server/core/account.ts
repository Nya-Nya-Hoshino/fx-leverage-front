// 账户结算：持仓盈亏、保证金、净值、维持率、掉期。全部使用同一行情状态（quotes / usdPer）。
import type { AccountSummary, Ccy, Position, Quote } from '../../shared/types';
import { PAIR_MAP, acctMarketCcy, LOAN_LIMIT_JPY } from '../../shared/instruments';
import type { GameState } from './state';
import { swapDays } from './clock';

export const SWAP_MARKUP = 0.5; // 业者在利差上抽取的年化 %

export interface ValCtx {
  st: GameState;
  quotes: Record<string, Quote>;
  up: Record<Ccy, number>;
}

export function acctCcy(st: GameState): Ccy {
  return acctMarketCcy(st.account.ccy);
}

/** 1 单位 from 货币折合多少账户本位币（中间价） */
export function toAcct(ctx: ValCtx, from: Ccy): number {
  return ctx.up[from] / ctx.up[acctCcy(ctx.st)];
}

/** 持仓价格盈亏（报价货币计） —— 多头按 Bid 平仓，空头按 Ask 平仓 */
export function priceDiff(pos: Position, q: Quote): number {
  return pos.side === 'buy' ? q.bid - pos.openPrice : pos.openPrice - q.ask;
}

/** 持仓价格盈亏（账户本位币，不含掉期） */
export function positionPnl(ctx: ValCtx, pos: Position): number {
  const p = PAIR_MAP[pos.sym];
  return priceDiff(pos, ctx.quotes[pos.sym]) * pos.units * toAcct(ctx, p.quote);
}

export function positionMargin(ctx: ValCtx, sym: string, units: number): number {
  const p = PAIR_MAP[sym];
  return (units * toAcct(ctx, p.base)) / ctx.st.account.maxLeverage;
}

export function positionNotional(ctx: ValCtx, sym: string, units: number): number {
  return units * toAcct(ctx, PAIR_MAP[sym].base);
}

export function loanDebt(st: GameState) {
  let principal = 0, interest = 0;
  for (const l of st.loans) if (l.status !== 'repaid') { principal += l.outstanding; interest += l.interest; }
  return { principal, interest, total: principal + interest };
}

export function loanLimit(ctx: ValCtx): number {
  return LOAN_LIMIT_JPY * (ctx.up.JPY / ctx.up[acctCcy(ctx.st)]);
}

export function summarize(ctx: ValCtx): AccountSummary {
  const st = ctx.st;
  let unrealized = 0, usedMargin = 0, notional = 0;
  for (const pos of st.positions) {
    unrealized += positionPnl(ctx, pos) + pos.swap;
    usedMargin += positionMargin(ctx, pos.sym, pos.units);
    notional += positionNotional(ctx, pos.sym, pos.units);
  }
  const balance = st.account.balance;
  const equity = balance + unrealized;
  const debt = loanDebt(st);
  const limit = loanLimit(ctx);
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : null;
  const netWorth = equity - debt.total;
  let status: AccountSummary['status'] = 'normal';
  if (st.gameOver) status = 'bankrupt';
  else if (netWorth < 0 && (balance < 0 || debt.total > 0)) status = 'insolvent';
  else if (balance < 0) status = 'negative';
  else if (marginLevel !== null && marginLevel <= st.risk.marginCallLevel) status = 'margin-call';
  return {
    ccy: st.account.ccy,
    maxLeverage: st.account.maxLeverage,
    balance,
    unrealized,
    equity,
    usedMargin,
    freeMargin: equity - usedMargin,
    marginLevel,
    notional,
    effectiveLeverage: equity > 0 ? notional / equity : notional > 0 ? Infinity : 0,
    realized: st.account.realized,
    totalSwap: st.account.totalSwap,
    loanDebt: debt.total,
    loanPrincipal: debt.principal,
    loanLimit: limit,
    loanAvailable: Math.max(0, limit - debt.principal),
    netWorth,
    totalAssets: Math.max(0, equity),
    liabilities: debt.total + Math.max(0, -balance),
    initialCapital: st.account.initialCapital,
    status,
  };
}

/** 每 1 单位持仓每天的掉期（报价货币计），long/short */
export function swapPerUnitDay(st: GameState, sym: string, mid: number): { long: number; short: number } {
  const p = PAIR_MAP[sym];
  const rb = st.economy.econ[p.base].rate;
  const rq = st.economy.econ[p.quote].rate;
  const long = (mid * (rb - rq - SWAP_MARKUP)) / 100 / 365;
  const short = (mid * (rq - rb - SWAP_MARKUP)) / 100 / 365;
  return { long, short };
}

/** 换日：把掉期计入每个持仓（未实现，平仓时结算） */
export function applyRollover(ctx: ValCtx, rolloverT: number) {
  const days = swapDays(rolloverT);
  for (const pos of ctx.st.positions) {
    const q = ctx.quotes[pos.sym];
    const s = swapPerUnitDay(ctx.st, pos.sym, q.mid);
    const perUnit = pos.side === 'buy' ? s.long : s.short;
    pos.swap += perUnit * pos.units * days * toAcct(ctx, PAIR_MAP[pos.sym].quote);
  }
}

/** 每 1 手（lotUnits）每天的掉期（账户本位币），供界面展示 */
export function swapTable(ctx: ValCtx): Record<string, { long: number; short: number }> {
  const out: Record<string, { long: number; short: number }> = {};
  const lot = ctx.st.risk.lotUnits;
  for (const sym of Object.keys(ctx.quotes)) {
    const s = swapPerUnitDay(ctx.st, sym, ctx.quotes[sym].mid);
    const k = lot * toAcct(ctx, PAIR_MAP[sym].quote);
    out[sym] = { long: s.long * k, short: s.short * k };
  }
  return out;
}
