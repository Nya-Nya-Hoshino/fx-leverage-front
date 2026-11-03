import { memo, useEffect, useRef, useState } from 'react';
import type { Quote } from '../../../shared/types';
import { useS, useT } from '../store';
import { pairLabel, px } from '../fmt';
import { hist } from '../history';
import Sparkline from './Sparkline';

/** 价格变化时短暂闪烁 */
export function Flash({ value, children, className = '' }: { value: number; children: React.ReactNode; className?: string }) {
  const prev = useRef(value);
  const [cls, setCls] = useState('');
  useEffect(() => {
    if (value > prev.current) setCls('flash-up');
    else if (value < prev.current) setCls('flash-down');
    prev.current = value;
    const id = setTimeout(() => setCls(''), 450);
    return () => clearTimeout(id);
  }, [value]);
  return <span className={`${className} ${cls}`}>{children}</span>;
}

const Row = memo(function Row({ q, active, onClick, featured, held, rev }: { q: Quote; active: boolean; onClick: () => void; featured: boolean; held: number; rev: number }) {
  const chg = q.bid - q.open;
  const pct = (chg / q.open) * 100;
  const pts = (hist[q.sym] ?? []).slice(-90);
  const trendUp = pts.length > 1 ? pts[pts.length - 1].v >= pts[0].v : pct >= 0;
  return (
    <div className={`rate-row ${active ? 'active' : ''}`} onClick={onClick} data-rev={rev}>
      <div className="rr-sym">
        <b>{featured && <i className="star">★</i>}{pairLabel(q.sym)}{held ? <em className="held" title="holding">{held}</em> : null}</b>
        <span className={pct >= 0 ? 'up' : 'down'}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
      </div>
      <Sparkline pts={pts} up={trendUp} />
      <div className="rr-px">
        <Flash value={q.bid} className="rr-bid">{px(q.sym, q.bid)}</Flash>
        <Flash value={q.ask} className="rr-ask">{px(q.sym, q.ask)}</Flash>
      </div>
      <span className={`rr-spr ${q.spread > 3 ? 'wide' : ''}`}>{q.spread.toFixed(1)}</span>
    </div>
  );
});

type Group = 'all' | 'major' | 'jpy' | 'usd' | 'cross' | 'em';
const EM = ['TRY', 'ZAR', 'MXN'];

export default function RateBoard() {
  const t = useT();
  const quotes = useS((s) => s.tick?.quotes);
  const positions = useS((s) => s.tick?.positions);
  const clockT = useS((s) => s.tick?.clock.t ?? 0);
  const sym = useS((s) => s.sym);
  const meta = useS((s) => s.meta);
  const set = useS((s) => s.set);
  const [g, setG] = useState<Group>(() => (localStorage.getItem('fx.rb.group') as Group) || 'all');
  if (!quotes || !meta) return null;
  const featured = new Set(meta.pairs.filter((p) => p.featured).map((p) => p.sym));
  const held: Record<string, number> = {};
  for (const p of positions ?? []) held[p.sym] = (held[p.sym] ?? 0) + 1;
  const list = quotes.filter((q) => {
    if (g === 'major') return featured.has(q.sym);
    if (g === 'jpy') return q.sym.endsWith('JPY');
    if (g === 'usd') return q.sym.includes('USD');
    if (g === 'cross') return !q.sym.includes('USD');
    if (g === 'em') return EM.some((c) => q.sym.includes(c));
    return true;
  });
  const groups: [Group, string][] = [['all', t('全部', 'すべて')], ['major', t('主要', '主要')], ['jpy', t('日元', '円')], ['usd', t('美元', 'ドル')], ['cross', t('交叉', 'クロス')], ['em', t('新兴', '新興国')]];
  return (
    <div className="panel rateboard">
      <div className="panel-head">
        <span>{t('汇率看板', 'レート一覧')} <small>{list.length}</small></span>
        <div className="seg small">
          {groups.map(([k, l]) => <button key={k} className={g === k ? 'on' : ''} onClick={() => { setG(k); localStorage.setItem('fx.rb.group', k); }}>{l}</button>)}
        </div>
      </div>
      <div className="rate-head"><span>{t('货币对 / 日涨跌', '通貨ペア / 前日比')}</span><span>{t('走势', '推移')}</span><span>BID / ASK</span><span>SP</span></div>
      <div className="rate-list">
        {list.map((q) => (
          <Row key={q.sym} q={q} rev={clockT} featured={featured.has(q.sym)} held={held[q.sym] ?? 0} active={q.sym === sym}
            onClick={() => { set({ sym: q.sym }); localStorage.setItem('fx.sym', q.sym); }} />
        ))}
      </div>
    </div>
  );
}
