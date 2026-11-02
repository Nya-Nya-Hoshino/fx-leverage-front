import { describe, expect, it } from 'vitest';
import { PAIR_MAP, LOAN_LIMIT_JPY } from '../shared/instruments';
import { positionMargin, summarize } from '../server/core/account';
import { START_T } from '../server/core/clock';
import { newGame, shift } from './helpers';

describe('多空盈亏结算', () => {
  it('多头以 Ask 开仓、按 Bid 估值；空头以 Bid 开仓、按 Ask 估值', () => {
    const g = newGame();
    const q = g.quotes.USDJPY;
    const L = g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 10000, source: 'player' });
    const S = g.order({ sym: 'USDJPY', side: 'sell', type: 'market', units: 10000, source: 'player' });
    expect(L.price).toBe(q.ask);
    expect(S.price).toBe(q.bid);
    const s = summarize(g);
    // 刚开仓：两边各亏一个点差
    expect(s.unrealized).toBeCloseTo(-2 * (q.ask - q.bid) * 10000, 6);
  });

  it('跨币种换算：EUR/USD 盈亏以 USD 计，再按 USD/JPY 中间价换算为日元', () => {
    const g = newGame({ lev: 100 });
    const r = g.order({ sym: 'EURUSD', side: 'buy', type: 'market', units: 100000, source: 'player' });
    shift(g, 'EUR', 0.01);
    const q = g.quotes.EURUSD;
    const expected = (q.bid - r.price!) * 100000 * g.quotes.USDJPY.mid;
    expect(summarize(g).unrealized).toBeCloseTo(expected, 4);
    const c = g.close(r.positionId!, null);
    expect(c.pnl).toBeCloseTo(expected, 4);
    expect(g.st.account.balance).toBeCloseTo(250000 + expected, 4);
  });

  it('CNY 账户：盈亏换算为人民币（经 CNH）', () => {
    const g = newGame({ ccy: 'CNY', lev: 100 });
    const r = g.order({ sym: 'USDJPY', side: 'sell', type: 'market', units: 10000, source: 'player' });
    shift(g, 'USD', -0.005);
    const q = g.quotes.USDJPY;
    const jpyPnl = (r.price! - q.ask) * 10000;
    const cnyPerJpy = g.up.JPY / g.up.CNH;
    expect(summarize(g).unrealized).toBeCloseTo(jpyPnl * cnyPerJpy, 6);
    expect(cnyPerJpy).toBeCloseTo(g.quotes.CNHJPY.mid ** -1, 10);
  });

  it('部分平仓：按比例结算掉期、剩余数量正确', () => {
    const g = newGame();
    const r = g.order({ sym: 'GBPJPY', side: 'buy', type: 'market', units: 30000, source: 'player' });
    const pos = g.st.positions[0];
    pos.swap = 300;
    const c = g.close(r.positionId!, 10000);
    expect(c.ok).toBe(true);
    expect(pos.units).toBe(20000);
    expect(pos.swap).toBeCloseTo(200, 8);
    expect(g.st.trades.at(-1)!.action).toBe('partial');
  });
});

describe('保证金与维持率', () => {
  it('保证金 = 本位币名义金额 ÷ 账户最高杠杆；净值 = 余额 + 未实现盈亏；维持率 = 净值 ÷ 保证金', () => {
    const g = newGame({ lev: 25 });
    g.order({ sym: 'EURUSD', side: 'buy', type: 'market', units: 10000, source: 'player' });
    const s = summarize(g);
    const notional = 10000 * g.up.EUR / g.up.JPY;
    expect(s.usedMargin).toBeCloseTo(notional / 25, 6);
    expect(s.equity).toBeCloseTo(s.balance + s.unrealized, 8);
    expect(s.marginLevel!).toBeCloseTo((s.equity / s.usedMargin) * 100, 8);
    expect(s.freeMargin).toBeCloseTo(s.equity - s.usedMargin, 8);
    expect(s.effectiveLeverage).toBeCloseTo(notional / s.equity, 6);
  });

  it('保证金不足时拒单；账户最高杠杆不等于实际杠杆', () => {
    const g = newGame({ lev: 25 });
    // 250,000 JPY × 25 ≈ 6.25M JPY 名义 → 约 4 万美元上限
    expect(g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 50000, source: 'player' }).code).toBe('margin');
    const ok = g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 10000, source: 'player' });
    expect(ok.ok).toBe(true);
    expect(summarize(g).effectiveLeverage).toBeLessThan(10);
  });

  it('3000 倍杠杆：极小保证金即可开出巨额仓位，几个 pips 就会被强平', () => {
    const g = newGame({ lev: 3000 });
    const units = 4_000_000; // 名义约 6 亿日元
    const r = g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units, source: 'player' });
    expect(r.ok).toBe(true);
    expect(positionMargin(g, 'USDJPY', units)).toBeCloseTo(units * g.quotes.USDJPY.mid / 3000, 0);
    // 跌 5 pips 左右即爆仓
    shift(g, 'USD', -0.0004);
    g.simulate(4, 4);
    expect(g.st.positions.length).toBe(0);
    expect(g.st.stats.stopOuts).toBe(1);
    expect(g.st.trades.at(-1)!.action).toBe('stopout');
  });
});

describe('强制平仓与负余额', () => {
  it('维持率 ≤ 50% 全部强平；跳空导致余额为负，形成欠款', () => {
    const g = newGame({ lev: 1000 });
    g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 1_000_000, source: 'player' });
    g.order({ sym: 'EURJPY', side: 'buy', type: 'market', units: 100_000, source: 'player' });
    // 剧烈跳空：日元急升 3%
    shift(g, 'JPY', 0.03);
    g.simulate(4, 4);
    const s = summarize(g);
    expect(g.st.positions.length).toBe(0);
    expect(s.balance).toBeLessThan(0);
    expect(s.status === 'negative' || s.status === 'insolvent').toBe(true);
    expect(g.st.notices.some((n) => n.code === 'negative-balance')).toBe(true);
    // 负余额时禁止新开仓
    expect(g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 1000, source: 'player' }).ok).toBe(false);
  });

  it('零截断开启时，负余额被归零', () => {
    const g = newGame({ lev: 1000 });
    g.st.risk.negativeBalanceProtection = true;
    g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 1_000_000, source: 'player' });
    shift(g, 'JPY', 0.03);
    g.simulate(4, 4);
    expect(g.st.account.balance).toBe(0);
  });

  it('“亏损最大者优先”模式只平部分仓位', () => {
    const g = newGame({ lev: 1000 });
    g.st.risk.stopOutMode = 'worst';
    g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 1_000_000, source: 'player' });
    g.order({ sym: 'EURUSD', side: 'buy', type: 'market', units: 10_000, source: 'player' });
    shift(g, 'USD', -0.0013);
    g.simulate(4, 4);
    expect(g.st.positions.map((p) => p.sym)).toEqual(['EURUSD']);
  });

  it('维持率 ≤ 100% 触发追证警告（仅一次，直至恢复）', () => {
    const g = newGame({ lev: 1000 });
    g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 1_000_000, source: 'player' });
    shift(g, 'USD', -0.0008);
    g.simulate(4, 4);
    g.simulate(4, 4);
    expect(g.st.notices.filter((n) => n.code === 'margin-call').length).toBe(1);
  });
});

describe('挂单、止盈止损、追踪止损', () => {
  it('限价单在价格触及时成交；止损单在突破时成交', () => {
    const g = newGame();
    const q = g.quotes.USDJPY;
    const lim = g.order({ sym: 'USDJPY', side: 'buy', type: 'limit', price: q.ask - 0.1, units: 10000, source: 'player' });
    const stp = g.order({ sym: 'USDJPY', side: 'sell', type: 'stop', price: q.bid - 0.1, units: 10000, source: 'player' });
    expect(lim.ok && stp.ok).toBe(true);
    expect(g.order({ sym: 'USDJPY', side: 'buy', type: 'limit', price: q.ask + 0.1, units: 10000, source: 'player' }).code).toBe('price');
    shift(g, 'USD', -0.0012);
    g.simulate(4, 4);
    expect(g.st.orders.length).toBe(0);
    expect(g.st.positions.length).toBe(2);
  });

  it('跳空穿越止损价时按更差的市场价成交', () => {
    const g = newGame();
    const r = g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 10000, sl: g.quotes.USDJPY.bid - 0.2, source: 'player' });
    const sl = g.st.positions[0].sl!;
    shift(g, 'USD', -0.01); // 约 1.5 日元跳空
    g.simulate(4, 4);
    const tr = g.st.trades.at(-1)!;
    expect(tr.action).toBe('sl');
    expect(tr.price).toBeLessThan(sl);
    expect(tr.pnl).toBeCloseTo((tr.price - r.price!) * 10000, 4);
  });

  it('止盈触发', () => {
    const g = newGame();
    g.order({ sym: 'EURJPY', side: 'sell', type: 'market', units: 10000, tp: g.quotes.EURJPY.bid - 0.3, source: 'player' });
    shift(g, 'EUR', -0.004);
    g.simulate(4, 4);
    expect(g.st.trades.at(-1)!.action).toBe('tp');
    expect(g.st.trades.at(-1)!.pnl).toBeGreaterThan(0);
  });

  it('追踪止损随有利价格上移，不会下移', () => {
    const g = newGame();
    g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 10000, trailPips: 20, source: 'player' });
    g.simulate(0.001, 4);
    const sl0 = g.st.positions[0].sl!;
    shift(g, 'USD', 0.004);
    g.simulate(0.001, 4);
    const sl1 = g.st.positions[0].sl!;
    expect(sl1).toBeGreaterThan(sl0);
    shift(g, 'USD', -0.001);
    g.simulate(0.001, 4);
    expect(g.st.positions[0].sl).toBe(sl1);
  });

  it('止损价方向错误时拒单', () => {
    const g = newGame();
    const q = g.quotes.USDJPY;
    expect(g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 10000, sl: q.ask + 0.5, source: 'player' }).code).toBe('sl');
    expect(g.order({ sym: 'USDJPY', side: 'sell', type: 'market', units: 10000, tp: q.bid + 0.5, source: 'player' }).code).toBe('tp');
  });

  it('休市时市价单被拒绝，挂单可以提交', () => {
    const g = newGame();
    g.st.clock.autoSkipWeekend = false;
    const fridayClose = START_T + 4 * 86400 + 21 * 3600;
    g.simulate(fridayClose - g.t + 60, 60);
    expect(g.marketOpen()).toBe(false);
    expect(g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 1000, source: 'player' }).code).toBe('closed');
    expect(g.order({ sym: 'USDJPY', side: 'buy', type: 'limit', price: g.quotes.USDJPY.ask - 1, units: 1000, source: 'player' }).ok).toBe(true);
  });
});

describe('掉期', () => {
  it('高息货币多头每天获得正掉期，周三三倍', () => {
    const g = newGame({ lev: 100 });
    g.st.economy.econ.AUD.rate = 5;
    g.st.economy.econ.JPY.rate = 0;
    g.order({ sym: 'AUDJPY', side: 'buy', type: 'market', units: 100000, source: 'player' });
    g.order({ sym: 'AUDJPY', side: 'sell', type: 'market', units: 100000, source: 'player' });
    g.simulate(86400, 60); // 跨过一次换日（周一）
    const [L, S] = g.st.positions;
    expect(L.swap).toBeGreaterThan(0);
    expect(S.swap).toBeLessThan(0);
    const mid = g.quotes.AUDJPY.mid;
    expect(L.swap).toBeCloseTo((100000 * mid * (5 - 0 - 0.5)) / 100 / 365, -1);
  });
});

describe('借贷与破产', () => {
  it('借款增加现金并形成等额负债；个人净资产 = 净值 − 债务', () => {
    const g = newGame();
    const r = g.borrow(1_000_000, 'bank');
    expect(r.ok).toBe(true);
    const s = summarize(g);
    expect(s.balance).toBe(1_250_000);
    expect(s.loanDebt).toBe(1_000_000);
    expect(s.netWorth).toBeCloseTo(250_000, 6);
  });

  it('累计本金不得超过 1000 万日元；CNY 账户按游戏内汇率换算', () => {
    const g = newGame();
    expect(g.borrow(LOAN_LIMIT_JPY, 'bank').ok).toBe(true);
    expect(g.borrow(1, 'bank').ok).toBe(false);
    const c = newGame({ ccy: 'CNY' });
    const lim = summarize(c).loanLimit;
    expect(lim).toBeCloseTo(LOAN_LIMIT_JPY * c.up.JPY / c.up.CNH, 6);
    expect(c.borrow(lim + 100, 'bank').ok).toBe(false);
    expect(c.borrow(Math.floor(lim), 'bank').ok).toBe(true);
  });

  it('利息按时间计提；还款先息后本；不能动用持仓保证金还款', () => {
    const g = newGame();
    g.borrow(1_000_000, 'consumer'); // 18%
    g.simulate(10 * 86400, 600);
    const loan = g.st.loans[0];
    expect(loan.interest).toBeCloseTo(1_000_000 * 0.18 * 10 / 365, -1);
    const interest = loan.interest;
    expect(g.repay(loan.id, 1000).ok).toBe(true);
    expect(loan.interest).toBeCloseTo(interest - 1000, 6);
    expect(loan.outstanding).toBe(1_000_000);
    // 开大仓后可还款金额受保证金约束
    g.st.account.maxLeverage = 25;
    g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 150_000, source: 'player' });
    const r = g.repay(loan.id, g.st.account.balance);
    expect(r.ok).toBe(false);
  });

  it('全额还款后状态为 repaid', () => {
    const g = newGame();
    g.borrow(100_000, 'bank');
    const l = g.st.loans[0];
    g.simulate(3600, 60);
    expect(g.repay(l.id, l.outstanding + l.interest).ok).toBe(true);
    expect(l.status).toBe('repaid');
    expect(summarize(g).loanDebt).toBe(0);
  });

  it('逾期计罚息，超过宽限期违约并破产', () => {
    const g = newGame();
    g.borrow(100_000, 'shark'); // 7 天 + 宽限 2 天
    g.simulate(8 * 86400, 600);
    expect(g.st.loans[0].status).toBe('overdue');
    g.simulate(2 * 86400, 600);
    expect(g.st.loans[0].status).toBe('defaulted');
    expect(g.st.gameOver?.reason).toBe('default');
  });

  it('资金耗尽且借不到钱时破产', () => {
    const g = newGame({ lev: 1000 });
    g.borrow(LOAN_LIMIT_JPY, 'bank');
    g.order({ sym: 'USDJPY', side: 'buy', type: 'market', units: 60_000_000 > g.st.risk.maxUnitsPerOrder ? g.st.risk.maxUnitsPerOrder : 60_000_000, source: 'player' });
    shift(g, 'JPY', 0.05);
    g.simulate(4, 4);
    expect(g.st.positions.length).toBe(0);
    expect(g.st.gameOver?.reason).toBe('bankrupt');
    expect(summarize(g).netWorth).toBeLessThan(0);
  });
});

describe('模拟时钟', () => {
  it('暂停时不推进', () => {
    const g = newGame();
    const t = g.t;
    g.st.clock.paused = true;
    g.advance(4);
    expect(g.t).toBe(t);
    g.st.clock.paused = false;
    g.st.clock.speed = 60;
    g.advance(4);
    expect(g.t).toBe(t + 240);
  });

  it('PAIR_MAP 中所有货币对均可交易', () => {
    const g = newGame({ lev: 1000 });
    for (const sym of Object.keys(PAIR_MAP)) {
      const r = g.order({ sym, side: 'buy', type: 'market', units: 1000, source: 'player' });
      expect(r.ok, sym).toBe(true);
    }
  });
});
