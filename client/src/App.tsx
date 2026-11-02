import { useEffect, useState } from 'react';
import { useS } from './store';
import Welcome from './components/Welcome';
import TopBar from './components/TopBar';
import RateBoard from './components/RateBoard';
import ChartPanel from './components/ChartPanel';
import OrderPanel from './components/OrderPanel';
import AccountPanel from './components/AccountPanel';
import BottomTabs from './components/BottomTabs';
import NewsPanel, { NewsTicker } from './components/NewsPanel';
import Effects, { Toasts, Mascot } from './components/Effects';
import SettingsModal from './components/SettingsModal';
import SavesModal from './components/SavesModal';
import GameOverModal from './components/GameOverModal';
import MobileShell from './components/MobileShell';
import Split from './components/Split';
import PortfolioChart from './components/PortfolioChart';

/** 手机横屏（矮屏）使用精简布局 */
function useCompact() {
  const calc = () => window.innerHeight <= 560 && window.innerWidth > window.innerHeight;
  const [c, setC] = useState(calc);
  useEffect(() => {
    const f = () => setC(calc());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return c;
}

export type ModalKind = null | 'settings' | 'saves';

export default function App() {
  const active = useS((s) => s.active);
  const hasTick = useS((s) => !!s.tick);
  const lang = useS((s) => s.lang);
  const [modal, setModal] = useState<ModalKind>(null);
  const compact = useCompact();

  useEffect(() => {
    document.documentElement.lang = lang === 'ja' ? 'ja' : 'zh-CN';
  }, [lang]);

  if (!active || !hasTick) return <Welcome />;
  if (compact) return (
    <div className="app compact">
      <MobileShell onOpen={setModal} />
      <Effects />
      <Toasts />
      <Mascot />
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'saves' && <SavesModal onClose={() => setModal(null)} />}
      <GameOverModal />
    </div>
  );
  return (
    <div className="app">
      <TopBar onOpen={setModal} />
      <Mood />
      <Split id="cols" dir="h" className="main" initial={[19, 59, 22]} min={[230, 480, 280]}>
        <Split id="left" dir="v" initial={[44, 24, 32]} min={[150, 120, 110]}>
          <RateBoard />
          <PortfolioChart />
          <NewsPanel />
        </Split>
        <Split id="center" dir="v" initial={[62, 38]} min={[260, 150]}>
          <ChartPanel />
          <BottomTabs />
        </Split>
        <Split id="right" dir="v" initial={[56, 44]} min={[220, 200]}>
          <OrderPanel />
          <AccountPanel />
        </Split>
      </Split>
      <NewsTicker />
      <Effects />
      <Toasts />
      <Mascot />
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'saves' && <SavesModal onClose={() => setModal(null)} />}
      <GameOverModal />
    </div>
  );
}

/** 氛围层：根据浮动盈亏在背景上铺一层极淡的色调（盈利偏绿、亏损偏红），随心跳轻微呼吸 */
function Mood() {
  const a = useS((s) => s.tick?.account);
  if (!a) return null;
  const k = Math.min(1, Math.abs(a.unrealized) / Math.max(1, Math.abs(a.equity)) * 3);
  const cls = a.unrealized >= 0 ? 'mood-pos' : 'mood-neg';
  return <div className={`mood ${cls}`} style={{ opacity: a.unrealized === 0 ? 0 : 0.25 + k * 0.75 }} />;
}
