import { useState } from 'react';
import type { OrderType, Side } from '../../../shared/types';
import { PAIR_MAP } from '../../../shared/instruments';
import { api } from '../api';
import { useS, useT, tx } from '../store';
import { acctMkt, convQ, money, pairLabel, px } from '../fmt';
import { Flash } from './RateBoard';

const QUICK = [0.1, 0.5, 1, 5, 10, 50, 100];

export default function OrderPanel() {
  const t = useT();
  const { tick, sym, settings, lang } = useS();
  const [lots, setLots] = useState('1');
  const [type, setType] = useState<OrderType>('market');
  const [price, setPrice] = useState('');
  const [useSl, setUseSl] = useState(false);
  const [useTp, setUseTp] = useState(false);
  const [slPips, setSlPips] = useState('20');
  const [tpPips, setTpPips] = useState('40');
  const [trail, setTrail] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!tick || !settings) return null;
  const q = tick.quotes.find((x) => x.sym === sym)!;
  const p = PAIR_MAP[sym];
  const lot = settings.risk.lotUnits;
  const units = Math.round((Number(lots) || 0) * lot);
  const quotes = Object.fromEntries(tick.quotes.map((x) => [x.sym, x]));
  const acc = tick.account;
  const am = acctMkt(acc.ccy);
  const notional = units * convQ(quotes, p.base, am);
  const reqMargin = notional / acc.maxLeverage;
  const pipValue = units * p.pip * convQ(quotes, p.quote, am);
  const effLev = acc.equity > 0 ? (acc.notional + notional) / acc.equity : Infinity;
  const lossToStop = (acc.equity - (acc.usedMargin + reqMargin) * (settings.risk.stopOutLevel / 100)) / Math.max(1e-9, pipValue);
  const swap = tick.swaps[sym];

  const send = async (side: Side) => {
    setMsg(null);
    const entry = type === 'market' ? (side === 'buy' ? q.ask : q.bid) : Number(price);
    const dir = side === 'buy' ? 1 : -1;
    const body: any = { sym, side, type, units };
    if (type !== 'market') body.price = Number(price);
    if (useSl) body.sl = entry - dir * Number(slPips) * p.pip;
    if (useTp) body.tp = entry + dir * Number(tpPips) * p.pip;
    if (trail) body.trailPips = Number(trail);
    try {
      const r = await api.post('/api/order', body);
      if (r.ok) setMsg({ ok: true, text: r.positionId ? `${t('成交', '約定')} @ ${px(sym, r.price)}${r.slippagePips ? ` (${t('滑点', 'スリッページ')} ${r.slippagePips}p)` : ''}` : t('挂单已受理', '注文を受け付けました') });
      else setMsg({ ok: false, text: tx(r.message, lang) || r.error });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };

  const closeAll = async () => {
    if (!tick.positions.some((x) => x.sym === sym)) return;
    if (!confirm(t(`全部平仓 ${pairLabel(sym)}？`, `${pairLabel(sym)} を全決済しますか？`))) return;
    await api.post('/api/close-all', { sym });
  };

  return (
    <div className="panel order-panel">
      <div className="panel-head"><span>{t('下单', '注文')} · {pairLabel(sym)}</span>
        <div className="seg small">
          {(['market', 'limit', 'stop'] as OrderType[]).map((k) => (
            <button key={k} className={type === k ? 'on' : ''} onClick={() => { setType(k); if (k !== 'market' && !price) setPrice(String(q.bid)); }}>
              {k === 'market' ? t('市价', '成行') : k === 'limit' ? t('限价', '指値') : t('止损单', '逆指値')}
            </button>
          ))}
        </div>
      </div>

      <div className="speed-order">
        <button className="sell-btn" onClick={() => send('sell')} disabled={!!tick.gameOver}>
          <span>{t('卖出 SELL', '売 SELL')}</span>
          <Flash value={q.bid} className="big-px">{px(sym, q.bid)}</Flash>
        </button>
        <div className="spread-box"><small>SP</small><b>{q.spread.toFixed(1)}</b></div>
        <button className="buy-btn" onClick={() => send('buy')} disabled={!!tick.gameOver}>
          <span>{t('买入 BUY', '買 BUY')}</span>
          <Flash value={q.ask} className="big-px">{px(sym, q.ask)}</Flash>
        </button>
      </div>

      <div className="form-row">
        <label>{t('手数', '数量(Lot)')} <small>1{t('手', 'Lot')}={lot.toLocaleString()}</small></label>
        <input className="num-input" value={lots} onChange={(e) => setLots(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>
      <div className="quick-lots">
        {QUICK.map((v) => <button key={v} onClick={() => setLots(String(v))}>{v}</button>)}
        <button title={t('按可用保证金计算最大手数', '有効証拠金から最大数量')} onClick={() => setLots(String(Math.max(0, Math.floor((acc.freeMargin / Math.max(1e-9, reqMargin / Math.max(1, Number(lots) || 1))) * 0.95 * 10) / 10)))}>MAX</button>
      </div>

      {type !== 'market' && (
        <div className="form-row">
          <label>{t('挂单价格', '注文価格')}</label>
          <input className="num-input" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
      )}
      <div className="form-row">
        <label><input type="checkbox" checked={useSl} onChange={(e) => setUseSl(e.target.checked)} /> {t('止损(pips)', '損切り(pips)')}</label>
        <input className="num-input" disabled={!useSl} value={slPips} onChange={(e) => setSlPips(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>
      <div className="form-row">
        <label><input type="checkbox" checked={useTp} onChange={(e) => setUseTp(e.target.checked)} /> {t('止盈(pips)', '利確(pips)')}</label>
        <input className="num-input" disabled={!useTp} value={tpPips} onChange={(e) => setTpPips(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>
      <div className="form-row">
        <label>{t('追踪止损(pips)', 'トレール(pips)')}</label>
        <input className="num-input" placeholder={t('不使用', 'なし')} value={trail} onChange={(e) => setTrail(e.target.value.replace(/[^\d.]/g, ''))} />
      </div>

      <div className="order-calc">
        <div><span>{t('数量', '取引数量')}</span><b>{units.toLocaleString()} {p.base}</b></div>
        <div><span>{t('名义金额', '想定元本')}</span><b>{money(notional, acc.ccy)}</b></div>
        <div><span>{t('所需保证金', '必要証拠金')}</span><b className={reqMargin > acc.freeMargin ? 'neg' : ''}>{money(reqMargin, acc.ccy)}</b></div>
        <div><span>{t('1 pip 价值', '1pipの価値')}</span><b>{money(pipValue, acc.ccy)}</b></div>
        <div><span>{t('下单后有效杠杆', '発注後の実効レバ')}</span><b className={effLev > 100 ? 'neg' : ''}>{Number.isFinite(effLev) ? effLev.toFixed(1) : '∞'}x</b></div>
        <div><span>{t('距强平约', 'ロスカットまで約')}</span><b className={lossToStop < 30 ? 'neg' : ''}>{Number.isFinite(lossToStop) ? Math.max(0, lossToStop).toFixed(1) : '-'} pips</b></div>
        {swap && <div><span>{t('掉期/手/日 买|卖', 'スワップ/Lot/日 買|売')}</span><b><span className={swap.long >= 0 ? 'pos' : 'neg'}>{money(swap.long, acc.ccy, true)}</span> | <span className={swap.short >= 0 ? 'pos' : 'neg'}>{money(swap.short, acc.ccy, true)}</span></b></div>}
      </div>
      {msg && <div className={`order-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>}
      <button className="btn-danger wide" onClick={closeAll}>{t(`全部平仓 ${pairLabel(sym)}`, `${pairLabel(sym)} 全決済`)}</button>
    </div>
  );
}
