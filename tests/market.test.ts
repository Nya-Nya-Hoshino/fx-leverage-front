import { describe, expect, it } from 'vitest';
import { PAIRS, PAIR_MAP } from '../shared/instruments';
import { TFS, TF_SEC } from '../shared/types';
import { CandleStore, bucketOf } from '../server/core/candles';
import { isMarketOpen, nextOpen, rolloversBetween, START_T, swapDays } from '../server/core/clock';
import { usdPer } from '../server/core/market';
import { Rng } from '../server/core/rng';
import { newGame, shift } from './helpers';

describe('交叉汇率一致性', () => {
  it('所有交叉盘 = 两个 USD 直盘之积/商（无三角套利）', () => {
    const g = newGame({ days: 2 });
    g.st.marketSettings.volMult = 5;
    g.st.marketSettings.jumpRate = 5;
    g.simulate(3 * 3600, 4);
    const up = usdPer(g.st.market);
    for (const p of PAIRS) {
      const mid = g.quotes[p.sym].mid;
      expect(mid).toBeCloseTo(up[p.base] / up[p.quote], 10);
    }
    const q = (s: string) => g.quotes[s].mid;
    expect(q('EURJPY')).toBeCloseTo(q('EURUSD') * q('USDJPY'), 8);
    expect(q('GBPJPY')).toBeCloseTo(q('GBPUSD') * q('USDJPY'), 8);
    expect(q('AUDJPY')).toBeCloseTo(q('AUDUSD') * q('USDJPY'), 8);
    expect(q('EURGBP')).toBeCloseTo(q('EURUSD') / q('GBPUSD'), 10);
    expect(q('CNHJPY')).toBeCloseTo(q('USDJPY') / q('USDCNH'), 8);
  });

  it('Bid < Ask，点差为正，并按报价精度取整', () => {
    const g = newGame();
    for (const p of PAIRS) {
      const q = g.quotes[p.sym];
      expect(q.ask).toBeGreaterThan(q.bid);
      const m = 10 ** p.digits;
      expect(Math.abs(q.bid * m - Math.round(q.bid * m))).toBeLessThan(1e-6);
    }
  });

  it('港元联系汇率保持在窄幅区间', () => {
    const g = newGame({ days: 3 });
    g.simulate(5 * 86400, 30);
    const v = g.quotes.USDHKD.mid;
    expect(v).toBeGreaterThan(7.7);
    expect(v).toBeLessThan(7.9);
  });
});

describe('行情连续性与统计特征', () => {
  it('同一种子产生完全相同的行情', () => {
    const a = newGame({ seed: 7 });
    const b = newGame({ seed: 7 });
    a.simulate(7200, 4); b.simulate(7200, 4);
    expect(a.quotes.USDJPY.bid).toBe(b.quotes.USDJPY.bid);
    expect(a.quotes.EURUSD.ask).toBe(b.quotes.EURUSD.ask);
  });

  it('Tick 收益率呈现肥尾（峰度 > 3）与连续性', () => {
    const g = newGame({ seed: 99, days: 1 });
    const prices: number[] = [];
    for (let i = 0; i < 20000; i++) { g.simulate(4, 4); prices.push(g.quotes.USDJPY.mid); }
    const r = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length;
    const k = r.reduce((a, b) => a + (b - mean) ** 4, 0) / r.length / v ** 2;
    expect(k).toBeGreaterThan(3);
    // 单 Tick 不应出现荒谬跳变（未开启跳跃与新闻冲击放大时 < 0.5%）
    expect(Math.max(...r.map(Math.abs))).toBeLessThan(0.005);
  });
});

describe('K线聚合', () => {
  it('1m/5m/1h K线与 15s K线聚合结果一致（同一价格序列）', () => {
    const g = newGame({ days: 1 });
    g.simulate(3 * 3600, 4);
    for (const big of ['1m', '5m', '1h'] as const) {
      const bars = g.candles.bars('USDJPY', big, 1000);
      const small = g.candles.bars('USDJPY', '15s', 3000);
      const sec = TF_SEC[big];
      for (const b of bars.slice(-5, -1)) {
        const parts = small.filter((s) => s.t >= b.t && s.t < b.t + sec);
        if (parts.length === 0 || parts[0].t !== b.t) continue;
        expect(b.o).toBe(parts[0].o);
        expect(b.c).toBe(parts[parts.length - 1].c);
        expect(b.h).toBe(Math.max(...parts.map((x) => x.h)));
        expect(b.l).toBe(Math.min(...parts.map((x) => x.l)));
        expect(b.v).toBe(parts.reduce((s, x) => s + x.v, 0));
      }
    }
  });

  it('形成中的K线随每个 Tick 实时更新 OHLC', () => {
    const cs = new CandleStore(['USDJPY']);
    const t0 = 1_000_020; // 1m 桶内
    cs.update('USDJPY', t0, 100, 1);
    cs.update('USDJPY', t0 + 4, 101, 1);
    cs.update('USDJPY', t0 + 8, 99.5, 1);
    const f = cs.bars('USDJPY', '1m', 10).at(-1)!;
    expect(f).toMatchObject({ o: 100, h: 101, l: 99.5, c: 99.5, v: 3, t: bucketOf(t0, '1m') });
    for (const tf of TFS) expect(cs.data.USDJPY[tf].forming).not.toBeNull();
  });
});

describe('交易时段与周末', () => {
  it('周五 21:00 UTC 收市、周日 21:00 UTC 开市', () => {
    const fri = START_T + 4 * 86400; // 周五 00:00
    expect(isMarketOpen(fri + 20.9 * 3600)).toBe(true);
    expect(isMarketOpen(fri + 21 * 3600)).toBe(false);
    expect(isMarketOpen(fri + 2 * 86400 + 20 * 3600)).toBe(false);
    expect(nextOpen(fri + 22 * 3600)).toBe(fri + 2 * 86400 + 21 * 3600);
  });

  it('一周 5 次换日、周三三倍掉期（共 7 天）', () => {
    const r = rolloversBetween(START_T, START_T + 7 * 86400);
    expect(r.length).toBe(5);
    expect(r.reduce((s, x) => s + swapDays(x), 0)).toBe(7);
  });

  it('周末跳空：重新开市时价格跳变，点差扩大', () => {
    const g = newGame({ days: 1 });
    g.st.marketSettings.gapMult = 3;
    g.st.clock.autoSkipWeekend = true;
    const fri = START_T + 4 * 86400 + 20.99 * 3600;
    g.simulate(fri - g.t, 30);
    const before = g.quotes.USDJPY.mid;
    const spreadBefore = g.quotes.USDJPY.spread;
    g.simulate(120, 30); // 跨过收市（自动跳过周末）
    expect(g.t).toBeGreaterThan(START_T + 6 * 86400 + 21 * 3600 - 1);
    expect(g.quotes.USDJPY.mid).not.toBe(before);
    expect(g.quotes.USDJPY.spread).toBeGreaterThan(spreadBefore);
  });
});

describe('随机数生成器', () => {
  it('状态可序列化并精确恢复', () => {
    const r = Rng.fromSeed(1);
    for (let i = 0; i < 100; i++) r.next();
    const s = r.getState();
    const a = [r.next(), r.normal(), r.next()];
    const r2 = new Rng(s);
    expect([r2.next(), r2.normal(), r2.next()]).toEqual(a);
  });
});

describe('新闻冲击导致点差扩大', () => {
  it('重大事件 spreadBoost 使相关货币对点差显著扩大', () => {
    const g = newGame();
    const base = g.quotes.USDJPY.spread;
    g.st.market.f.JPY.spreadBoost = 8;
    g.refreshQuotes();
    expect(g.quotes.USDJPY.spread).toBeGreaterThan(base * 5);
    expect(g.quotes.EURUSD.spread).toBeLessThan(base * 5 * (PAIR_MAP.EURUSD.baseSpread / PAIR_MAP.USDJPY.baseSpread) + 1);
    shift(g, 'JPY', 0);
  });
});
