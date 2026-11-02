import { memo } from 'react';
import type { Pt } from '../history';

/** 迷你折线：最后一个点带呼吸圆点，面积渐变按涨跌着色 */
export default memo(function Sparkline({ pts, w = 72, h = 22, up }: { pts: Pt[]; w?: number; h?: number; up: boolean }) {
  if (pts.length < 2) return <svg className="sparkline" width={w} height={h} />;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
  const span = hi - lo || hi * 1e-6 || 1;
  const n = pts.length - 1;
  const xy = pts.map((p, i) => [(i / n) * (w - 4) + 1, h - 3 - ((p.v - lo) / span) * (h - 6)] as const);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const [lx, ly] = xy[xy.length - 1];
  const cls = up ? 'sp-up' : 'sp-down';
  return (
    <svg className={`sparkline ${cls}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path className="sp-area" d={`${d}L${lx.toFixed(1)},${h}L1,${h}Z`} />
      <path className="sp-line" d={d} />
      <circle className="sp-dot" cx={lx} cy={ly} r="2" />
    </svg>
  );
});
