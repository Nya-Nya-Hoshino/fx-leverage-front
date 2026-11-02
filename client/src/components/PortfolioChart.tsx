import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { FEATURED } from '../../../shared/instruments';
import { useS, useT } from '../store';
import { money, pairLabel, tzOffset } from '../fmt';
import { hist } from '../history';
import { cssVar, SERIES_COLORS } from '../theme';

/**
 * 持仓货币对综合走势：把正在交易（持仓/挂单）的货币对归一化为涨跌幅（%），叠加在同一张实时图上。
 * 开启「按持仓方向」时，空头持仓的曲线取反，曲线向上即代表对自己有利。
 */
export default function PortfolioChart() {
  const t = useT();
  const tick = useS((s) => s.tick);
  const themeRev = useS((s) => s.themeRev);
  const [dirAdj, setDirAdj] = useState(() => localStorage.getItem('fx.pf.dir') !== '0');
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());

  const positions = tick?.positions ?? [];
  const traded = [...new Set([...positions.map((p) => p.sym), ...(tick?.orders ?? []).map((o) => o.sym)])];
  const syms = traded.length ? traded : FEATURED;
  const dirOf = (sym: string) => {
    if (!dirAdj) return 1;
    let net = 0;
    for (const p of positions) if (p.sym === sym) net += p.side === 'buy' ? p.units : -p.units;
    return net < 0 ? -1 : 1;
  };

  useEffect(() => {
    const c = createChart(el.current!, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--chart-text'), fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--chart-grid') } },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` },
      handleScroll: false, handleScale: false,
      autoSize: true,
    });
    chart.current = c;
    return () => { c.remove(); chart.current = null; series.current.clear(); };
  }, []);

  useEffect(() => {
    chart.current?.applyOptions({ layout: { textColor: cssVar('--chart-text') }, grid: { horzLines: { color: cssVar('--chart-grid') } } });
  }, [themeRev]);

  useEffect(() => {
    const c = chart.current;
    if (!c || !tick) return;
    const off = tzOffset(tick.account.ccy);
    for (const [s, ser] of series.current) if (!syms.includes(s)) { c.removeSeries(ser); series.current.delete(s); }
    syms.forEach((s, i) => {
      let ser = series.current.get(s);
      const color = SERIES_COLORS[i % SERIES_COLORS.length];
      if (!ser) {
        ser = c.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3 });
        series.current.set(s, ser);
      } else ser.applyOptions({ color });
      const pts = (hist[s] ?? []).slice(-240);
      if (!pts.length) return;
      const base = pts[0].v, k = dirOf(s);
      ser.setData(pts.map((p) => ({ time: (p.t + off) as UTCTimestamp, value: ((p.v / base) - 1) * 100 * k })));
    });
    const zero = series.current.get(syms[0]);
    if (zero && !(zero as any).__zero) { zero.createPriceLine({ price: 0, color: cssVar('--line'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' }); (zero as any).__zero = true; }
    c.timeScale().fitContent();
  }, [tick, dirAdj, syms.join(',')]);

  const ccy = tick?.account.ccy;
  return (
    <div className="panel portfolio">
      <div className="panel-head">
        <span>{t('持仓综合走势', 'ポジション総合推移')} {!traded.length && <small>{t('（无持仓·主要货币对）', '（建玉なし・主要通貨）')}</small>}</span>
        <label className="chk mini" title={t('空头曲线取反：向上=对你有利', '売りは反転表示：上昇＝有利')}>
          <input type="checkbox" checked={dirAdj} onChange={(e) => { setDirAdj(e.target.checked); localStorage.setItem('fx.pf.dir', e.target.checked ? '1' : '0'); }} />
          {t('按持仓方向', '建玉方向')}
        </label>
      </div>
      <div className="pf-legend">
        {syms.map((s, i) => {
          const pts = hist[s] ?? [];
          const chg = pts.length > 1 ? ((pts[pts.length - 1].v / pts[Math.max(0, pts.length - 240)].v) - 1) * 100 * dirOf(s) : 0;
          const pnl = positions.filter((p) => p.sym === s).reduce((a, p) => a + p.pnl, 0);
          const has = positions.some((p) => p.sym === s);
          return (
            <span key={s} className="pf-chip">
              <i style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {pairLabel(s)} <b className={chg >= 0 ? 'pos' : 'neg'}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</b>
              {has && <b className={pnl >= 0 ? 'pos' : 'neg'}>{money(pnl, ccy, true)}</b>}
            </span>
          );
        })}
      </div>
      <div ref={el} className="pf-chart" />
    </div>
  );
}
