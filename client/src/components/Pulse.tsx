import { useEffect } from 'react';
import { useS, useT, type ThemePref } from '../store';
import { applyTheme } from '../theme';

/**
 * 心跳：根据仓位风险计算“心率”。无持仓 ≈ 62 BPM；浮亏比例越大、维持率越接近强平线，心跳越快。
 * 同时把节拍写入 CSS 变量 --beat，供净值数字、风险条等元素同步脉动。
 */
export function useBpm() {
  const tick = useS((s) => s.tick);
  const stopOut = useS((s) => s.settings?.risk.stopOutLevel ?? 50);
  if (!tick || !tick.positions.length) return { bpm: 62, level: 'calm' as const };
  const a = tick.account;
  const eq = Math.max(1, Math.abs(a.equity));
  const swing = Math.min(1, Math.abs(a.unrealized) / eq);
  const ml = a.marginLevel ?? 1000;
  const danger = Math.max(0, Math.min(1, (400 - ml) / (400 - stopOut)));
  const lev = Math.min(1, a.effectiveLeverage / 500);
  const bpm = Math.round(68 + swing * 50 + danger * 70 + lev * 20);
  return { bpm: Math.min(185, bpm), level: danger > 0.7 ? 'critical' as const : danger > 0.35 || swing > 0.3 ? 'tense' as const : 'active' as const };
}

export function Heartbeat() {
  const { bpm, level } = useBpm();
  const inPos = useS((s) => (s.tick?.positions.length ?? 0) > 0);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--beat', `${(60 / bpm).toFixed(3)}s`);
    root.classList.toggle('in-position', inPos);
    root.dataset.tension = level;
  }, [bpm, inPos, level]);
  return (
    <div className={`heartbeat hb-${level}`} title="Heart rate">
      <svg viewBox="0 0 120 24" preserveAspectRatio="none">
        <path className="hb-base" d="M0 12 H120" />
        <path className="hb-wave" d="M0 12 H34 L40 12 L44 4 L48 20 L52 9 L56 12 H120" />
      </svg>
      <span className="hb-num"><b>{bpm}</b> BPM</span>
    </div>
  );
}

/** Tick 倒计时进度条：每个行情 Tick 重新开始 */
export function TickBar() {
  const t = useS((s) => s.tick?.clock.t);
  const tickMs = useS((s) => s.tick?.clock.tickMs ?? 4000);
  const paused = useS((s) => s.tick?.clock.paused);
  return <div className={`tickbar ${paused ? 'paused' : ''}`}><i key={t} style={{ animationDuration: `${tickMs}ms` }} /></div>;
}

export function ThemeSelect() {
  const t = useT();
  const theme = useS((s) => s.theme);
  return (
    <select className="theme-select" value={theme} onChange={(e) => applyTheme(e.target.value as ThemePref)} title={t('主题', 'テーマ')}>
      <option value="system">{t('◐ 跟随系统', '◐ システム')}</option>
      <option value="light">{t('☀ 浅色', '☀ ライト')}</option>
      <option value="dark">{t('● 深色', '● ダーク')}</option>
      <option value="navy">{t('◆ 深蓝紫', '◆ ネイビー')}</option>
    </select>
  );
}
