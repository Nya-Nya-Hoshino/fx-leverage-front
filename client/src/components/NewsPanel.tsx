import { useState } from 'react';
import { useS, useT, tx } from '../store';
import { simTime } from '../fmt';

export default function NewsPanel() {
  const t = useT();
  const { news, lang, tick } = useS();
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'major'>('all');
  if (!tick) return null;
  const list = news.filter((n) => filter === 'all' || n.importance >= 3).slice().reverse().slice(0, 80);
  return (
    <div className="panel news-panel">
      <div className="panel-head">
        <span>{t('AI 新闻 · 快讯', 'AIニュース・速報')}</span>
        <div className="seg small">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{t('全部', 'すべて')}</button>
          <button className={filter === 'major' ? 'on' : ''} onClick={() => setFilter('major')}>{t('重大', '重要')}</button>
        </div>
      </div>
      <div className="news-list">
        {list.map((n) => (
          <div key={n.id} className={`news-item imp${n.importance} kind-${n.kind}`} onClick={() => setOpen(open === n.id ? null : n.id)}>
            <div className="news-meta">
              <span>{simTime(n.t, tick.account.ccy, false)}</span>
              <span className={`news-kind k-${n.kind}`}>{n.kind === 'breaking' ? t('突发', '速報') : n.kind === 'release' ? t('指标', '指標') : n.kind === 'preview' ? t('前瞻', '予告') : t('市场', '市況')}</span>
              {n.ccys.map((c) => <span key={c} className="ccy-chip">{c}</span>)}
              {n.source === 'ai' && <span className="tag-ai">AI</span>}
            </div>
            <div className="news-title">{tx(n.title, lang)}</div>
            {open === n.id && <div className="news-body">{tx(n.body, lang)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function NewsTicker() {
  const { news, lang } = useS();
  const items = news.slice(-10).reverse();
  return (
    <div className="ticker">
      <span className="ticker-label">NEWS</span>
      <div className="ticker-track">
        <div className="ticker-move" key={items[0]?.id}>
          {[...items, ...items].map((n, i) => (
            <span key={i} className={`ticker-item imp${n.importance}`}>{n.importance >= 3 ? '◆ ' : '· '}{tx(n.title, lang)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
