import { useState } from 'react';
import { api, loadState } from '../api';
import { useS, useT } from '../store';
import { money, simTime } from '../fmt';

export default function GameOverModal() {
  const t = useT();
  const { tick, saveId } = useS();
  const [dismissed, setDismissed] = useState<number | null>(null);
  if (!tick?.gameOver || dismissed === tick.gameOver.t) return null;
  const g = tick.gameOver;
  const s = tick.stats;
  const a = tick.account;
  const reason = g.reason === 'declared' ? t('申请个人破产', '自己破産') : g.reason === 'default' ? t('贷款违约', '債務不履行') : t('资金耗尽，无法再借贷', '資金枯渇・借入不能');
  const winRate = s.trades ? (s.wins / s.trades) * 100 : 0;
  return (
    <div className="modal-back gameover-back">
      <div className="modal gameover">
        <div className="go-title">GAME OVER</div>
        <div className="go-sub">{t('破产', '破産')} —— {reason}</div>
        <div className="go-time">{simTime(g.t, a.ccy)}</div>
        <div className="go-stats">
          <div><span>{t('初始资金', '初期資金')}</span><b>{money(a.initialCapital, a.ccy)}</b></div>
          <div><span>{t('最终个人净资产', '最終個人純資産')}</span><b className="neg">{money(g.netWorth, a.ccy)}</b></div>
          <div><span>{t('最高净值', '最高純資産')}</span><b>{money(s.peakEquity, a.ccy)}</b></div>
          <div><span>{t('最大回撤', '最大ドローダウン')}</span><b>{s.maxDrawdownPct.toFixed(1)}%</b></div>
          <div><span>{t('交易次数 / 胜率', '取引回数 / 勝率')}</span><b>{s.trades} / {winRate.toFixed(1)}%</b></div>
          <div><span>{t('最大单笔盈利', '最大利益')}</span><b className="pos">{money(s.biggestWin, a.ccy, true)}</b></div>
          <div><span>{t('最大单笔亏损', '最大損失')}</span><b className="neg">{money(s.biggestLoss, a.ccy, true)}</b></div>
          <div><span>{t('强制平仓次数', 'ロスカット回数')}</span><b>{s.stopOuts}</b></div>
          <div><span>{t('追证警告次数', 'マージンコール回数')}</span><b>{s.marginCalls}</b></div>
          <div><span>{t('累计借款', '累計借入')}</span><b>{money(s.totalBorrowed, a.ccy)}</b></div>
          <div><span>{t('已付利息', '支払利息')}</span><b>{money(s.totalInterestPaid, a.ccy)}</b></div>
          <div><span>{t('剩余债务', '残債務')}</span><b className="neg">{money(a.liabilities, a.ccy)}</b></div>
        </div>
        <div className="go-quote">{t('「市场永远是对的。错的，是我的杠杆。」', '「相場は常に正しい。間違っていたのは、私のレバレッジだ。」')}</div>
        <div className="ai-row center">
          <button className="btn-primary" onClick={async () => { await api.post(`/api/saves/${saveId}/reset`); await loadState(); }}>{t('重新开局（同设置）', 'やり直す（同じ設定）')}</button>
          <button onClick={async () => { await api.post('/api/unload'); await loadState(); }}>{t('返回标题', 'タイトルへ')}</button>
          <button className="btn-ghost" onClick={() => setDismissed(g.t)}>{t('查看残局', '盤面を見る')}</button>
        </div>
      </div>
    </div>
  );
}
