import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, TF, TickMessage } from '../../../shared/types';
import { TFS } from '../../../shared/types';
import { PAIR_MAP } from '../../../shared/instruments';
import { bollinger, macd, rsi, sma } from '../../../shared/indicators';
import { api, setChartHooks, subscribeBars } from '../api';
import { useS, useT } from '../store';
import { pairLabel, px, tzOffset } from '../fmt';
import { alpha, cssVar } from '../theme';

/** 图表配色：取自当前主题的 CSS 变量 */
const C = {
  get bg() { return cssVar('--chart-bg'); }, get grid() { return cssVar('--chart-grid'); }, get text() { return cssVar('--chart-text'); },
  get border() { return cssVar('--line'); }, get up() { return cssVar('--up'); }, get down() { return cssVar('--down'); },
  get pos() { return cssVar('--pos'); }, get warn() { return cssVar('--warn'); }, get ai() { return cssVar('--ai'); },
  ma1: '#d9a53a', ma2: '#9b7fd4', bb: '#3fa8b5', draw: '#d9a53a',
};

type Ind = { ma: boolean; bb: boolean; rsi: boolean; macd: boolean };

export default function ChartPanel() {
  const t = useT();
  const sym = useS((s) => s.sym);
  const tf = useS((s) => s.tf);
  const saveId = useS((s) => s.saveId);
  const themeRev = useS((s) => s.themeRev);
  const set = useS((s) => s.set);
  const tick = useS((s) => s.tick);
  const ccy = tick?.account.ccy;

  const [ind, setInd] = useState<Ind>(() => {
    try { return JSON.parse(localStorage.getItem('fx.ind') || '') as Ind; } catch { return { ma: true, bb: false, rsi: true, macd: false }; }
  });
  const [draw, setDraw] = useState<'none' | 'hline' | 'trend'>('none');

  const mainEl = useRef<HTMLDivElement>(null);
  const rsiEl = useRef<HTMLDivElement>(null);
  const macdEl = useRef<HTMLDivElement>(null);
  const r = useRef<{
    chart?: IChartApi; candle?: ISeriesApi<'Candlestick'>; vol?: ISeriesApi<'Histogram'>;
    ma1?: ISeriesApi<'Line'>; ma2?: ISeriesApi<'Line'>; bbU?: ISeriesApi<'Line'>; bbM?: ISeriesApi<'Line'>; bbL?: ISeriesApi<'Line'>;
    rsiChart?: IChartApi; rsiS?: ISeriesApi<'Line'>; macdChart?: IChartApi; macdL?: ISeriesApi<'Line'>; macdS?: ISeriesApi<'Line'>; macdH?: ISeriesApi<'Histogram'>;
    bars: Candle[]; posLines: IPriceLine[]; drawings: { kind: 'hline' | 'trend'; line?: IPriceLine; series?: ISeriesApi<'Line'> }[];
    pending: { t: number; p: number } | null; sym: string; tf: TF; off: number; ind: Ind; draw: string;
  }>({ bars: [], posLines: [], drawings: [], pending: null, sym, tf, off: 0, ind, draw: 'none' });

  r.current.sym = sym;
  r.current.tf = tf;
  r.current.ind = ind;
  r.current.draw = draw;
  r.current.off = tzOffset(ccy);

  // 创建图表
  useEffect(() => {
    const base = {
      layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.border },
      timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false, rightOffset: 8 },
      autoSize: true,
    } as const;
    const chart = createChart(mainEl.current!, base);
    const candle = chart.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down });
    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, color: C.grid, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    const line = (color: string, w: 1 | 2 = 1) => chart.addLineSeries({ color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const rsiChart = createChart(rsiEl.current!, { ...base, timeScale: { ...base.timeScale, visible: false } });
    const rsiS = rsiChart.addLineSeries({ color: '#f472b6', lineWidth: 1, priceLineVisible: false });
    rsiS.createPriceLine({ price: 70, color: alpha(C.up, 0.35), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
    rsiS.createPriceLine({ price: 30, color: alpha(C.down, 0.35), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
    const macdChart = createChart(macdEl.current!, { ...base, timeScale: { ...base.timeScale, visible: false } });
    const macdH = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    const macdL = macdChart.addLineSeries({ color: '#60a5fa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const macdS = macdChart.addLineSeries({ color: '#fbbf24', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    Object.assign(r.current, {
      chart, candle, vol, ma1: line(C.ma1), ma2: line(C.ma2), bbU: line(C.bb), bbM: line('#4fd1c588'), bbL: line(C.bb),
      rsiChart, rsiS, macdChart, macdL, macdS, macdH,
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      rsiChart.timeScale().setVisibleLogicalRange(range);
      macdChart.timeScale().setVisibleLogicalRange(range);
    });
    chart.subscribeClick((param) => {
      const st = r.current;
      if (st.draw === 'none' || !param.point || param.time === undefined) return;
      const price = candle.coordinateToPrice(param.point.y);
      if (price === null) return;
      if (st.draw === 'hline') {
        st.drawings.push({ kind: 'hline', line: candle.createPriceLine({ price, color: C.draw, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }) });
        setDraw('none');
      } else if (st.draw === 'trend') {
        const tt = param.time as number;
        if (!st.pending) { st.pending = { t: tt, p: price }; return; }
        if (st.pending.t !== tt) {
          const s = chart.addLineSeries({ color: C.draw, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
          const pts = [{ time: st.pending.t as UTCTimestamp, value: st.pending.p }, { time: tt as UTCTimestamp, value: price }].sort((a, b) => a.time - b.time);
          s.setData(pts);
          st.drawings.push({ kind: 'trend', series: s });
        }
        st.pending = null;
        setDraw('none');
      }
    });
    return () => { chart.remove(); rsiChart.remove(); macdChart.remove(); };
  }, []);

  const toTime = (tt: number) => (tt + r.current.off) as UTCTimestamp;

  const renderIndicators = () => {
    const st = r.current;
    const bars = st.bars;
    const closes = bars.map((b) => b.c);
    const times = bars.map((b) => toTime(b.t));
    const ser = (vals: (number | null)[]) => vals.slice(0, times.length).map((v, i) => (v === null ? { time: times[i] } : { time: times[i], value: v }));
    const empty: { time: UTCTimestamp }[] = [];
    st.ma1!.setData(st.ind.ma ? ser(sma(closes, 20)) : empty);
    st.ma2!.setData(st.ind.ma ? ser(sma(closes, 75)) : empty);
    if (st.ind.bb) {
      const b = bollinger(closes, 20, 2);
      st.bbU!.setData(ser(b.up)); st.bbM!.setData(ser(b.mid)); st.bbL!.setData(ser(b.dn));
    } else { st.bbU!.setData(empty); st.bbM!.setData(empty); st.bbL!.setData(empty); }
    if (st.ind.rsi) st.rsiS!.setData(ser(rsi(closes, 14)));
    if (st.ind.macd) {
      const m = macd(closes);
      st.macdL!.setData(ser(m.line)); st.macdS!.setData(ser(m.signal));
      st.macdH!.setData(m.hist.map((v, i) => (v === null ? { time: times[i] } : { time: times[i], value: v, color: v >= 0 ? alpha(C.up, 0.6) : alpha(C.down, 0.6) })));
    }
  };

  const setAll = () => {
    const st = r.current;
    const p = PAIR_MAP[st.sym];
    st.candle!.applyOptions({ priceFormat: { type: 'price', precision: p.digits, minMove: 10 ** -p.digits } });
    st.candle!.setData(st.bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    st.vol!.setData(st.bars.map((b) => ({ time: toTime(b.t), value: b.v, color: b.c >= b.o ? alpha(C.up, 0.25) : alpha(C.down, 0.25) })));
    renderIndicators();
  };

  const loadBars = async () => {
    const st = r.current;
    const res = await api.get(`/api/candles?sym=${st.sym}&tf=${st.tf}&limit=1500`);
    if (res.sym !== r.current.sym || res.tf !== r.current.tf) return;
    st.bars = res.bars;
    for (const d of st.drawings) { if (d.line) st.candle!.removePriceLine(d.line); if (d.series) st.chart!.removeSeries(d.series); }
    st.drawings = [];
    setAll();
    st.chart!.timeScale().scrollToRealTime();
    const last = st.bars[st.bars.length - 1];
    subscribeBars(st.sym, st.tf, last ? last.t : 0);
  };

  const onBars = (m: TickMessage) => {
    const st = r.current;
    if (!m.bars || m.bars.sym !== st.sym || m.bars.tf !== st.tf || !st.candle) return;
    let structural = false;
    for (const b of m.bars.bars) {
      const last = st.bars[st.bars.length - 1];
      if (last && last.t === b.t) st.bars[st.bars.length - 1] = b;
      else if (!last || b.t > last.t) { st.bars.push(b); structural = true; }
      else continue;
      st.candle.update({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c });
      st.vol!.update({ time: toTime(b.t), value: b.v, color: b.c >= b.o ? alpha(C.up, 0.25) : alpha(C.down, 0.25) });
    }
    if (st.bars.length > 3000) { st.bars = st.bars.slice(-2500); setAll(); return; }
    if (structural || true) renderIndicators();
  };

  useEffect(() => {
    setChartHooks(() => void loadBars(), onBars);
    void loadBars();
  }, [sym, tf, saveId, ccy]);

  useEffect(() => {
    localStorage.setItem('fx.ind', JSON.stringify(ind));
    if (r.current.candle) renderIndicators();
  }, [ind]);

  // 主题切换：重新着色全部图表
  useEffect(() => {
    const st = r.current;
    if (!st.chart) return;
    const opt = { layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text }, grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } }, rightPriceScale: { borderColor: C.border }, timeScale: { borderColor: C.border } };
    st.chart.applyOptions(opt); st.rsiChart!.applyOptions(opt); st.macdChart!.applyOptions(opt);
    st.candle!.applyOptions({ upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down });
    if (st.bars.length) setAll();
  }, [themeRev]);

  // 持仓 / 挂单价格线
  useEffect(() => {
    const st = r.current;
    if (!st.candle || !tick) return;
    for (const l of st.posLines) st.candle.removePriceLine(l);
    st.posLines = [];
    const lot = useS.getState().settings?.risk.lotUnits ?? 10000;
    for (const p of tick.positions.filter((x) => x.sym === sym)) {
      const col = p.side === 'buy' ? C.up : C.down;
      st.posLines.push(st.candle.createPriceLine({ price: p.openPrice, color: col, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${p.side === 'buy' ? 'L' : 'S'} ${(p.units / lot).toFixed(1)} ${p.pnl >= 0 ? '+' : ''}${Math.round(p.pnl)}` }));
      if (p.sl) st.posLines.push(st.candle.createPriceLine({ price: p.sl, color: C.warn, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'SL' }));
      if (p.tp) st.posLines.push(st.candle.createPriceLine({ price: p.tp, color: C.pos, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'TP' }));
    }
    for (const o of tick.orders.filter((x) => x.sym === sym)) {
      st.posLines.push(st.candle.createPriceLine({ price: o.price, color: C.ai, lineWidth: 1, lineStyle: LineStyle.LargeDashed, axisLabelVisible: true, title: `${o.type.toUpperCase()} ${o.side}` }));
    }
    const q = tick.quotes.find((x) => x.sym === sym);
    if (q) st.posLines.push(st.candle.createPriceLine({ price: q.ask, color: alpha(C.up, 0.45), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'ASK' }));
  }, [tick, sym]);

  const q = tick?.quotes.find((x) => x.sym === sym);
  const toggle = (k: keyof Ind) => setInd({ ...ind, [k]: !ind[k] });

  return (
    <div className="panel chart-panel">
      <div className="chart-toolbar">
        <span className="chart-sym">{pairLabel(sym)}</span>
        {q && <span className="chart-q"><b className="down-c">{px(sym, q.bid)}</b> / <b className="up-c">{px(sym, q.ask)}</b> <small>SP {q.spread.toFixed(1)}</small></span>}
        <div className="seg small">
          {TFS.map((x) => (
            <button key={x} className={tf === x ? 'on' : ''} onClick={() => { set({ tf: x }); localStorage.setItem('fx.tf', x); }}>{x}</button>
          ))}
        </div>
        <div className="seg small">
          {(['ma', 'bb', 'rsi', 'macd'] as (keyof Ind)[]).map((k) => (
            <button key={k} className={ind[k] ? 'on' : ''} onClick={() => toggle(k)}>{k.toUpperCase()}</button>
          ))}
        </div>
        <div className="seg small">
          <button className={draw === 'hline' ? 'on' : ''} onClick={() => setDraw(draw === 'hline' ? 'none' : 'hline')} title={t('点击图表画水平线', 'チャートをクリックして水平線')}>─ {t('水平线', '水平線')}</button>
          <button className={draw === 'trend' ? 'on' : ''} onClick={() => { r.current.pending = null; setDraw(draw === 'trend' ? 'none' : 'trend'); }} title={t('点击两点画趋势线', '2点クリックでトレンドライン')}>╱ {t('趋势线', 'トレンドライン')}</button>
          <button onClick={() => { const st = r.current; for (const d of st.drawings) { if (d.line) st.candle!.removePriceLine(d.line); if (d.series) st.chart!.removeSeries(d.series); } st.drawings = []; }}>{t('清除', '消去')}</button>
        </div>
        {draw !== 'none' && <span className="draw-hint">{draw === 'hline' ? t('点击图表放置水平线', 'クリックで水平線') : t('依次点击两点', '2点をクリック')}</span>}
        <span className="vol-note">{t('成交量为模拟 Tick Volume', '出来高は模擬ティックボリューム')}</span>
      </div>
      <div className="chart-stack">
        <div ref={mainEl} className="chart-main" />
        <div ref={rsiEl} className="chart-sub" style={{ display: ind.rsi ? 'block' : 'none' }}><span className="sub-label">RSI 14</span></div>
        <div ref={macdEl} className="chart-sub" style={{ display: ind.macd ? 'block' : 'none' }}><span className="sub-label">MACD 12 26 9</span></div>
      </div>
    </div>
  );
}
