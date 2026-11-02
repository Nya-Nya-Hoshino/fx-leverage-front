import { Game } from '../server/core/game';
import type { AccountCcy, Ccy } from '../shared/types';

export function newGame(opts: Partial<{ ccy: AccountCcy; lev: number; seed: number; days: number }> = {}) {
  const g = Game.create({
    saveId: 'test', name: 'test', username: 'tester', accountCcy: opts.ccy ?? 'JPY', maxLeverage: opts.lev ?? 25,
    seed: opts.seed ?? 12345, preRollDays: opts.days ?? 1,
  });
  g.st.risk.slippage = 0;
  g.st.clock.autoSkipWeekend = false; // 测试中让周末真实消耗时间，便于精确计算利息/掉期
  // 测试中关闭随机事件，确保价格只由我们控制
  g.st.marketSettings.jumpRate = 0;
  g.st.marketSettings.blackSwanPerYear = 0;
  return g;
}

/** 直接移动某货币因子（对数），并刷新报价 —— 仅用于测试 */
export function shift(g: Game, ccy: Ccy, logDelta: number) {
  g.st.market.f[ccy].x += logDelta;
  g.refreshQuotes();
}
