import { useState } from 'react';
import { api, refreshSettings } from '../api';
import { useS, useT, tx } from '../store';
import { simTime } from '../fmt';
import type { ModalKind } from '../App';
import { Heartbeat, ThemeSelect, TickBar } from './Pulse';

const SPEEDS = [1, 5, 30, 120, 600, 3600];

export default function TopBar({ onOpen }: { onOpen: (m: ModalKind) => void }) {
  const t = useT();
  const { tick, lang, set, saveName, username, connected, settings } = useS();
  const [saved, setSaved] = useState('');
  if (!tick) return null;
  const c = tick.clock;
  const ccy = tick.account.ccy;
  const ses = tick.session;

  const sim = (b: any) => api.post('/api/sim', b).catch((e) => alert(e.message));
  const save = async () => {
    await api.post('/api/save');
    setSaved('✓');
    setTimeout(() => setSaved(''), 1500);
  };
  const setMode = async (auto: boolean) => {
    await api.post('/api/settings', { autoTrader: { enabled: auto } });
    void refreshSettings();
  };
  const setMarketMode = async (m: 'random' | 'ai') => {
    await api.post('/api/settings', { marketMode: m });
  };
  const auto = tick.autoTrader.enabled;
  const risk = tick.regime.risk;
  const sesLabel: Record<string, [string, string]> = {
    closed: ['休市', '休場'], tokyo: ['东京时段', '東京時間'], london: ['伦敦时段', 'ロンドン時間'], newyork: ['纽约时段', 'NY時間'],
    'tokyo-london': ['东京/伦敦', '東京/ロンドン'], 'london-ny': ['伦敦/纽约重叠', 'ロンドン/NY重複'], quiet: ['清淡时段', '閑散時間'],
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">▲▼</span>
        <span className="brand-name">{t('杠杆战线', 'レバレッジ戦線')}</span>
        <span className="brand-sub">{saveName} · {username}</span>
      </div>

      <div className="clock-block">
        <div className="clock">{simTime(c.t, ccy)} <small>{ccy === 'CNY' ? 'CST' : 'JST'}</small></div>
        <div className="sessions">
          <span className={`ses ${ses.asia ? 'on' : ''}`}>TKY</span>
          <span className={`ses ${ses.europe ? 'on' : ''}`}>LDN</span>
          <span className={`ses ${ses.us ? 'on' : ''}`}>NY</span>
          <span className={`ses-label ${ses.open ? '' : 'closed'}`}>{(sesLabel[ses.label] ?? ['', ''])[lang === 'ja' ? 1 : 0]}</span>
        </div>
      </div>

      <div className="speed">
        <button className={`play ${c.paused ? '' : 'on'}`} disabled={!!tick.gameOver} onClick={() => sim({ paused: !c.paused })} title={t('暂停/继续', '一時停止/再開')}>
          {c.paused ? '▶' : '❚❚'}
        </button>
        {SPEEDS.map((s) => (
          <button key={s} className={c.speed === s ? 'on' : ''} onClick={() => sim({ speed: s })}>{s >= 3600 ? '1h/s' : `${s}x`}</button>
        ))}
        {!ses.open && <button className="skip" onClick={() => api.post('/api/sim/skip-weekend')}>{t('跳过周末', '週末スキップ')} ⏭</button>}
      </div>

      <Heartbeat />

      <div className={`regime regime-${tick.regime.kind}`} title={tick.macro?.commentary || ''}>
        <span>{tx(tick.regime.label, lang)}</span>
        <div className="risk-meter" title={t('风险情绪', 'リスクセンチメント')}>
          <div className="risk-fill" style={{ left: `${50 + Math.min(0, risk) * 50}%`, width: `${Math.abs(risk) * 50}%`, background: risk >= 0 ? 'var(--up)' : 'var(--down)' }} />
        </div>
        <small>{risk >= 0 ? 'Risk-ON' : 'Risk-OFF'}</small>
      </div>

      <div className="modes">
        <div className="seg small">
          <button className={!auto ? 'on' : ''} onClick={() => setMode(false)}>{t('手动交易', '手動')}</button>
          <button className={auto ? 'on ai' : ''} onClick={() => setMode(true)}>{t('AI自动交易', 'AI自動売買')}</button>
        </div>
        <div className="seg small">
          <button className={tick.regime.mode === 'random' ? 'on' : ''} onClick={() => setMarketMode('random')}>{t('随机市场', 'ランダム')}</button>
          <button className={tick.regime.mode === 'ai' ? 'on ai' : ''} onClick={() => setMarketMode('ai')}>{t('AI宏观', 'AIマクロ')}</button>
        </div>
        {tick.regime.mode === 'ai' && !settings?.roles.macro.enabled && <span className="warn-chip" title={t('未启用 AI-2，使用本地宏观引擎', 'AI-2未有効、ローカルで代替')}>LOCAL</span>}
      </div>

      <div className="actions">
        <ThemeSelect />
        <span className={`conn ${connected ? 'ok' : 'bad'}`} title={connected ? 'online' : 'offline'}>●</span>
        <button onClick={save}>{t('保存', '保存')}{saved}</button>
        <button onClick={() => onOpen('saves')}>{t('存档', 'セーブ')}</button>
        <button onClick={() => onOpen('settings')}>{t('设置', '設定')}</button>
        <button onClick={() => { const l = lang === 'zh' ? 'ja' : 'zh'; set({ lang: l }); localStorage.setItem('fx.lang', l); }}>{lang === 'zh' ? '日本語' : '中文'}</button>
      </div>
      <TickBar />
    </header>
  );
}
