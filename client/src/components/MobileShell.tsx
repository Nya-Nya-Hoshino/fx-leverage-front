import { useState } from 'react';
import { api, refreshSettings } from '../api';
import { useS, useT, tx } from '../store';
import { money, simTime } from '../fmt';
import RateBoard from './RateBoard';
import ChartPanel from './ChartPanel';
import OrderPanel from './OrderPanel';
import AccountPanel, { Rolling } from './AccountPanel';
import BottomTabs from './BottomTabs';
import NewsPanel from './NewsPanel';
import type { ModalKind } from '../App';
import { ThemeSelect, TickBar } from './Pulse';

type View = 'chart' | 'rates' | 'trade' | 'news' | 'account';
const SPEEDS = [1, 5, 30, 120, 600, 3600];

/** 手机横屏布局：上方精简工具栏，左侧主视图，右侧下单栏，底部导航 */
export default function MobileShell({ onOpen }: { onOpen: (m: ModalKind) => void }) {
  const t = useT();
  const { tick, lang, set, settings } = useS();
  const [view, setView] = useState<View>('chart');
  if (!tick || !settings) return null;
  const c = tick.clock;
  const a = tick.account;
  const ml = a.marginLevel;
  const risk = settings.risk;
  const mlCls = ml === null ? 'safe' : ml <= risk.stopOutLevel * 1.3 ? 'critical' : ml <= risk.marginCallLevel ? 'danger' : ml <= risk.marginCallLevel * 2 ? 'warn' : 'safe';
  const sim = (b: any) => api.post('/api/sim', b).catch((e) => alert(e.message));
  const auto = tick.autoTrader.enabled;

  return (
    <div className="mobile">
      <header className="m-top">
        <span className="brand-mark">▲▼</span>
        <span className="m-clock">{simTime(c.t, a.ccy).slice(5)}</span>
        <span className={`ses-label ${tick.session.open ? '' : 'closed'}`}>{tick.session.open ? tx(tick.regime.label, lang) : t('休市', '休場')}</span>
        <button className={`play ${c.paused ? '' : 'on'}`} disabled={!!tick.gameOver} onClick={() => sim({ paused: !c.paused })}>{c.paused ? '▶' : '❚❚'}</button>
        <select value={c.speed} onChange={(e) => sim({ speed: Number(e.target.value) })}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s >= 3600 ? '1h/s' : `${s}x`}</option>)}
        </select>
        {!tick.session.open && <button onClick={() => api.post('/api/sim/skip-weekend')}>⏭</button>}
        <button className={auto ? 'on ai' : ''} onClick={async () => { await api.post('/api/settings', { autoTrader: { enabled: !auto } }); void refreshSettings(); }}>{auto ? 'AI●' : 'AI'}</button>
        <span className="m-spacer" />
        <button onClick={() => api.post('/api/save')}>{t('存', '保存')}</button>
        <button onClick={() => onOpen('saves')}>{t('档', 'データ')}</button>
        <ThemeSelect />
        <button onClick={() => onOpen('settings')}>⚙</button>
        <button onClick={() => { const l = lang === 'zh' ? 'ja' : 'zh'; set({ lang: l }); localStorage.setItem('fx.lang', l); }}>{lang === 'zh' ? '日' : '中'}</button>
        <TickBar />
      </header>

      <div className="m-body">
        <main className="m-main">
          {view === 'chart' && <ChartPanel />}
          {view === 'rates' && <div onClick={() => setView('chart')}><RateBoard /></div>}
          {view === 'trade' && <BottomTabs />}
          {view === 'news' && <NewsPanel />}
          {view === 'account' && <AccountPanel />}
        </main>
        <aside className="m-side">
          <div className="m-acct" onClick={() => setView('account')}>
            <div><small>{t('净值', '純資産')}</small><Rolling value={a.equity} ccy={a.ccy} className={a.equity >= a.initialCapital ? 'pos' : 'neg'} /></div>
            <div><small>{t('浮盈亏', '評価損益')}</small><Rolling value={a.unrealized} ccy={a.ccy} sign className={a.unrealized >= 0 ? 'pos' : 'neg'} /></div>
            <div><small>{t('维持率', '維持率')}</small><b className={`mb-${mlCls}`}>{ml === null ? '---' : `${ml.toFixed(0)}%`}</b></div>
            {a.loanDebt > 0 && <div><small>{t('负债', '借入')}</small><b className="neg">{money(a.loanDebt, a.ccy)}</b></div>}
          </div>
          <OrderPanel />
        </aside>
      </div>

      <nav className="m-nav">
        {([
          ['chart', t('图表', 'チャート')], ['rates', t('行情', 'レート')], ['trade', `${t('交易', '取引')}${tick.positions.length ? ` (${tick.positions.length})` : ''}`],
          ['news', t('新闻', 'ニュース')], ['account', t('资产', '資産')],
        ] as [View, string][]).map(([k, l]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
        ))}
      </nav>
    </div>
  );
}
