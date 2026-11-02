import { useEffect, useRef, useState } from 'react';
import { useS, useT } from '../store';
import { money } from '../fmt';

/** 数字快速跳动（tween），变化时闪烁颜色 */
export function Rolling({ value, ccy, sign = false, className = '' }: { value: number; ccy: any; sign?: boolean; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    const start = performance.now();
    const a = from.current, b = value;
    if (a === b) return;
    setFlash(b > a ? 'roll-up' : 'roll-down');
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 600);
      const jitter = k < 1 ? (Math.random() - 0.5) * Math.abs(b - a) * 0.15 * (1 - k) : 0;
      setShown(a + (b - a) * k + jitter);
      if (k < 1) raf = requestAnimationFrame(step);
      else { from.current = b; setTimeout(() => setFlash(''), 200); }
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = b; };
  }, [value]);
  return <span className={`${className} ${flash}`}>{money(shown, ccy, sign)}</span>;
}

export default function AccountPanel() {
  const t = useT();
  const tick = useS((s) => s.tick);
  const risk = useS((s) => s.settings?.risk);
  const curve = useS((s) => s.curve);
  const lang = useS((s) => s.lang);
  if (!tick || !risk) return null;
  const a = tick.account;
  const ml = a.marginLevel;
  const mlPct = ml === null ? 100 : Math.max(0, Math.min(100, ((ml - risk.stopOutLevel) / (Math.max(400, risk.marginCallLevel * 4) - risk.stopOutLevel)) * 100));
  const mlCls = ml === null ? 'safe' : ml <= risk.stopOutLevel * 1.3 ? 'critical' : ml <= risk.marginCallLevel ? 'danger' : ml <= risk.marginCallLevel * 2 ? 'warn' : 'safe';
  const statusText: Record<string, [string, string]> = {
    normal: ['正常', '正常'], 'margin-call': ['追加保证金警告', 'マージンコール'], negative: ['余额为负（欠券商）', '口座残高マイナス'],
    insolvent: ['资不抵债', '債務超過'], bankrupt: ['已破产', '破産'], 'stop-out': ['强平', 'ロスカット'],
  };
  const pts = curve.slice(-200);
  const lo = Math.min(...pts.map((p) => Math.min(p.equity, p.netWorth)), 0);
  const hi = Math.max(...pts.map((p) => Math.max(p.equity, p.netWorth)), 1);
  const path = (k: 'equity' | 'netWorth') => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / Math.max(1, pts.length - 1)) * 100},${40 - ((p[k] - lo) / (hi - lo || 1)) * 38}`).join(' ');
  const zeroY = 40 - ((0 - lo) / (hi - lo || 1)) * 38;

  return (
    <div className={`panel account-panel status-${a.status}`}>
      <div className="panel-head">
        <span>{t('账户资产', '口座状況')} <small>{a.ccy} · {t('最高', '最大')} {a.maxLeverage}x</small></span>
        <span className={`status-badge st-${a.status}`}>{statusText[a.status]?.[lang === 'ja' ? 1 : 0]}</span>
      </div>
      <div className="equity-big">
        <small>{t('净值（有效保证金）', '純資産（有効証拠金）')}</small>
        <Rolling value={a.equity} ccy={a.ccy} className={a.equity >= a.initialCapital ? 'pos' : 'neg'} />
      </div>
      <div className="pnl-big">
        <small>{t('浮动盈亏', '評価損益')}</small>
        <Rolling value={a.unrealized} ccy={a.ccy} sign className={a.unrealized >= 0 ? 'pos' : 'neg'} />
      </div>
      <div className="margin-bar">
        <div className="mb-label"><span>{t('保证金维持率', '証拠金維持率')}</span><b className={mlCls}>{ml === null ? '---' : `${ml.toFixed(1)}%`}</b></div>
        <div className="mb-track">
          <div className={`mb-fill ${mlCls}`} style={{ width: `${mlPct}%` }} />
          <div className="mb-mark" style={{ left: '0%' }} title="stop-out" />
        </div>
        <div className="mb-legend"><span>{t('强平', 'LC')} {risk.stopOutLevel}%</span><span>{t('预警', '警告')} {risk.marginCallLevel}%</span></div>
      </div>
      <div className="kv">
        <div><span>{t('账户余额', '口座残高')}</span><b className={a.balance < 0 ? 'neg' : ''}>{money(a.balance, a.ccy)}</b></div>
        <div><span>{t('已用保证金', '必要証拠金')}</span><b>{money(a.usedMargin, a.ccy)}</b></div>
        <div><span>{t('可用保证金', '発注可能額')}</span><b className={a.freeMargin < 0 ? 'neg' : ''}>{money(a.freeMargin, a.ccy)}</b></div>
        <div><span>{t('实际有效杠杆', '実効レバレッジ')}</span><b className={a.effectiveLeverage > 100 ? 'neg' : ''}>{Number.isFinite(a.effectiveLeverage) ? a.effectiveLeverage.toFixed(1) : '∞'}x</b></div>
        <div><span>{t('已实现盈亏', '実現損益')}</span><b className={a.realized >= 0 ? 'pos' : 'neg'}>{money(a.realized, a.ccy, true)}</b></div>
        <div><span>{t('累计掉期', '累計スワップ')}</span><b className={a.totalSwap >= 0 ? 'pos' : 'neg'}>{money(a.totalSwap, a.ccy, true)}</b></div>
        <div><span>{t('贷款负债', '借入残高')}</span><b className={a.loanDebt > 0 ? 'neg' : ''}>{money(a.loanDebt, a.ccy)}</b></div>
        <div><span>{t('总负债', '負債合計')}</span><b className={a.liabilities > 0 ? 'neg' : ''}>{money(a.liabilities, a.ccy)}</b></div>
        <div className="kv-strong"><span>{t('个人净资产', '個人純資産')}</span><b className={a.netWorth >= 0 ? 'pos' : 'neg'}>{money(a.netWorth, a.ccy)}</b></div>
      </div>
      <svg className="spark" viewBox="0 0 100 42" preserveAspectRatio="none">
        <line x1="0" x2="100" y1={zeroY} y2={zeroY} style={{ stroke: "var(--line)" }} strokeDasharray="2 2" />
        <path d={path('netWorth')} style={{ stroke: "var(--ai)" }} strokeWidth="0.8" fill="none" vectorEffect="non-scaling-stroke" />
        <path d={path('equity')} style={{ stroke: "var(--pos)" }} strokeWidth="1.2" fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="spark-legend"><span className="c-eq">— {t('净值', '純資産')}</span><span className="c-nw">— {t('个人净资产', '個人純資産')}</span></div>
    </div>
  );
}
