import { describe, expect, it } from 'vitest';
import { CCYS, EM_CCYS, PAIR_MAP } from '../shared/instruments';
import { Game } from '../server/core/game';
import { summarize, swapPerUnitDay } from '../server/core/account';
import { usdPer } from '../server/core/market';
import { newGame } from './helpers';

function realizedVol(sym: string, seed: number) {
  const g = newGame({ seed, days: 1 });
  g.st.marketSettings.jumpRate = 1;
  const p: number[] = [];
  for (let i = 0; i < 3000; i++) { g.simulate(60, 30); p.push(g.quotes[sym].mid); }
  const r = p.slice(1).map((x, i) => Math.log(x / p[i]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
}

describe('新兴市场与高波动货币', () => {
  it('包含 GBP/NZD、USD/TRY、USD/ZAR、USD/MXN 及其日元交叉盘', () => {
    for (const s of ['GBPJPY', 'GBPAUD', 'GBPNZD', 'USDTRY', 'USDZAR', 'USDMXN', 'TRYJPY', 'ZARJPY', 'MXNJPY']) expect(PAIR_MAP[s], s).toBeTruthy();
    expect(EM_CCYS.every((c) => CCYS.includes(c))).toBe(true);
  });

  it('日元交叉盘与 USD 直盘三角一致', () => {
    const g = newGame();
    g.simulate(3600, 4);
    const q = (s: string) => g.quotes[s].mid;
    expect(q('TRYJPY')).toBeCloseTo(q('USDJPY') / q('USDTRY'), 8);
    expect(q('ZARJPY')).toBeCloseTo(q('USDJPY') / q('USDZAR'), 8);
    expect(q('MXNJPY')).toBeCloseTo(q('USDJPY') / q('USDMXN'), 8);
    const up = usdPer(g.st.market);
    expect(q('GBPNZD')).toBeCloseTo(up.GBP / up.NZD, 10);
  });

  it('波动率：新兴市场 > 澳元交叉 > 欧美', () => {
    const eu = realizedVol('EURUSD', 5), aud = realizedVol('AUDJPY', 5), zar = realizedVol('ZARJPY', 5);
    expect(aud).toBeGreaterThan(eu);
    expect(zar).toBeGreaterThan(aud);
  });

  it('高息货币：TRY/JPY 多头掉期远大于 USD/JPY；空头为大额负掉期', () => {
    const g = newGame();
    const tr = swapPerUnitDay(g.st, 'TRYJPY', g.quotes.TRYJPY.mid);
    const uj = swapPerUnitDay(g.st, 'USDJPY', g.quotes.USDJPY.mid);
    // 以相同名义金额（1 美元）比较
    const perUsdTry = tr.long * g.quotes.USDTRY.mid, perUsdUj = uj.long;
    expect(perUsdTry).toBeGreaterThan(perUsdUj * 3);
    expect(tr.short).toBeLessThan(0);
  });

  it('里拉存在长期贬值漂移：低波动下 60 天平均贬值接近设定值', () => {
    let moves = 0;
    const seeds = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111];
    for (const seed of seeds) {
      const g = newGame({ seed, days: 1 });
      g.st.marketSettings.volMult = 0.2;      // 压低随机波动，突出结构性漂移
      const a = g.quotes.USDTRY.mid;
      g.simulate(60 * 86400, 600);
      moves += Math.log(g.quotes.USDTRY.mid / a);
    }
    const avg = moves / seeds.length;
    const expected = 0.28 * 60 / 365;            // CCY_INFO.TRY.drift = -0.28（年化）
    expect(avg).toBeGreaterThan(expected * 0.3);
    expect(avg).toBeLessThan(expected * 2.5);
  });

  it('旧存档（缺少新货币）可以读取并继续运行', () => {
    const g = newGame({ days: 1 });
    const st = JSON.parse(JSON.stringify(g.serialize()));
    for (const c of EM_CCYS) { delete st.market.f[c]; delete st.economy.econ[c]; }
    const before = st.market.f.USD.x;
    const r = Game.restore(st, []);
    expect(r.st.market.f.USD.x).toBe(before);
    expect(r.quotes.TRYJPY.bid).toBeGreaterThan(0);
    r.simulate(3600, 4);
    expect(Number.isFinite(summarize(r).equity)).toBe(true);
  });
});
