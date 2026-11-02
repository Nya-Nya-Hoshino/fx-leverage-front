// 本地规则交易员：未配置 AI 或 AI 调用失败时的离线降级。输出与 AI-3 相同的结构，经由同一执行器下单。
import { PAIR_MAP } from '../../shared/instruments';
import { atr, bollinger, ema, rsi } from '../../shared/indicators';
import type { RiskProfile } from '../../shared/types';
import type { Game } from '../core/game';
import { toAcct } from '../core/account';
import type { TraderOut } from './schemas';

const RISK_PCT: Record<RiskProfile, number> = { conservative: 0.005, balanced: 0.015, aggressive: 0.05, degenerate: 0.25 };

function lotsFor(g: Game, sym: string, slPips: number): number {
  const s = g.st.autoTrader;
  const p = PAIR_MAP[sym];
  const eq = Math.max(0, g.summary().equity);
  const pipValPerUnit = p.pip * toAcct(g, p.quote);
  const units = (eq * RISK_PCT[s.risk]) / Math.max(1e-9, slPips * pipValPerUnit);
  const lots = units / g.st.risk.lotUnits;
  return Math.max(g.st.risk.minUnits / g.st.risk.lotUnits, Math.min(s.maxLotsPerOrder, Math.floor(lots * 10) / 10));
}

export function localDecide(g: Game): TraderOut {
  const s = g.st.autoTrader;
  const actions: TraderOut['actions'] = [];
  const notes: string[] = [];
  const mine = g.st.positions.filter((p) => p.source === 'ai');
  let slots = s.maxPositions - mine.length;

  for (const sym of s.pairs) {
    const p = PAIR_MAP[sym];
    if (!p) continue;
    const bars = g.candles.bars(sym, s.tf, 120);
    if (bars.length < 60) continue;
    const c = bars.map((b) => b.c);
    const e20 = ema(c, 20), e50 = ema(c, 50);
    const r = rsi(c, 14);
    const a = atr(bars, 14);
    const n = c.length - 1;
    const atrPips = Math.max(3, (a[n] ?? 0) / p.pip);
    const held = mine.filter((x) => x.sym === sym);
    let signal: 'buy' | 'sell' | null = null;
    let sl = atrPips * 1.5, tp = atrPips * 3, trail: number | null = null;

    if (s.strategy === 'trend') {
      const up = (e20[n] ?? 0) > (e50[n] ?? 0), upPrev = (e20[n - 1] ?? 0) > (e50[n - 1] ?? 0);
      if (up && !upPrev && (r[n] ?? 50) < 70) signal = 'buy';
      if (!up && upPrev && (r[n] ?? 50) > 30) signal = 'sell';
      for (const h of held) {
        if ((h.side === 'buy' && !up) || (h.side === 'sell' && up)) actions.push({ type: 'close', position_id: h.id, lots: null, reason: `${sym} EMA20/50 反向交叉，趋势结束` });
      }
    } else if (s.strategy === 'meanrev') {
      const bb = bollinger(c, 20, 2);
      if ((r[n] ?? 50) < 28 && c[n] < (bb.dn[n] ?? -Infinity)) signal = 'buy';
      if ((r[n] ?? 50) > 72 && c[n] > (bb.up[n] ?? Infinity)) signal = 'sell';
      sl = atrPips * 2; tp = Math.max(atrPips, Math.abs(c[n] - (bb.mid[n] ?? c[n])) / p.pip);
    } else if (s.strategy === 'breakout') {
      const hi = Math.max(...bars.slice(n - 20, n).map((b) => b.h));
      const lo = Math.min(...bars.slice(n - 20, n).map((b) => b.l));
      if (c[n] > hi) signal = 'buy';
      if (c[n] < lo) signal = 'sell';
      sl = atrPips * 1.2; tp = atrPips * 4; trail = Math.round(atrPips * 1.5);
    } else if (s.strategy === 'gambler') {
      // 动量 + 马丁格尔：亏损后加倍
      const mom = c[n] - c[n - 5];
      if (held.length === 0 && g.rng.next() < 0.6) signal = mom >= 0 ? 'buy' : 'sell';
      sl = atrPips * 1; tp = atrPips * 1;
    }

    if (signal && slots > 0 && held.length === 0) {
      let lots = lotsFor(g, sym, sl);
      if (s.strategy === 'gambler') {
        const lastAi = [...g.st.trades].reverse().find((x) => x.source === 'ai' && x.action !== 'open' && x.action !== 'fill-limit' && x.action !== 'fill-stop');
        if (lastAi && lastAi.pnl < 0) lots = Math.min(s.maxLotsPerOrder, (lastAi.units / g.st.risk.lotUnits) * 2);
      }
      actions.push({
        type: 'open', sym, side: signal, lots, sl_pips: Math.round(sl * 10) / 10, tp_pips: Math.round(tp * 10) / 10,
        trail_pips: trail, reason: `${s.strategy} 信号：RSI ${Math.round(r[n] ?? 0)}，ATR ${atrPips.toFixed(1)}p`,
      });
      slots--;
    }
    notes.push(`${sym}: RSI ${Math.round(r[n] ?? 0)} EMA20${(e20[n] ?? 0) > (e50[n] ?? 0) ? '>' : '<'}EMA50`);
  }
  if (actions.length === 0) actions.push({ type: 'hold', reason: '无明确信号' });
  return { analysis: `[本地策略:${s.strategy}] ${notes.join('；')}`, confidence: 0.5, actions };
}
