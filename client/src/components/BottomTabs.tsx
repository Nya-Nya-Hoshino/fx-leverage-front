import { Fragment, useState } from 'react';
import type { AiRole, RiskProfile, TF, TraderStrategy } from '../../../shared/types';
import { TFS } from '../../../shared/types';

import { api, refreshSettings } from '../api';
import { useS, useT, tx } from '../store';
import { money, num, pairLabel, px, simTime } from '../fmt';
import { Rolling } from './AccountPanel';

type Tab = 'positions' | 'orders' | 'history' | 'ai' | 'calendar' | 'econ' | 'loans' | 'equity' | 'ailog';

export default function BottomTabs() {
  const t = useT();
  const tick = useS((s) => s.tick);
  const [tab, setTab] = useState<Tab>('positions');
  if (!tick) return null;
  const tabs: [Tab, string][] = [
    ['positions', `${t('持仓', 'ポジション')} (${tick.positions.length})`],
    ['orders', `${t('挂单', '注文中')} (${tick.orders.length})`],
    ['history', t('成交记录', '約定履歴')],
    ['ai', `${t('AI交易员', 'AIトレーダー')}${tick.autoTrader.enabled ? ' ●' : ''}`],
    ['calendar', t('经济日历', '経済指標')],
    ['econ', t('宏观/掉期', 'マクロ/スワップ')],
    ['loans', `${t('借贷', '借入')}${tick.account.loanDebt > 0 ? ' !' : ''}`],
    ['equity', t('资产曲线', '資産推移')],
    ['ailog', t('AI日志', 'AIログ')],
  ];
  return (
    <div className="panel bottom-tabs">
      <div className="tabs">
        {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <div className="tab-body">
        {tab === 'positions' && <Positions />}
        {tab === 'orders' && <Orders />}
        {tab === 'history' && <History />}
        {tab === 'ai' && <AiTrader />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'econ' && <Econ />}
        {tab === 'loans' && <Loans />}
        {tab === 'equity' && <EquityCurve />}
        {tab === 'ailog' && <AiLog />}
      </div>
    </div>
  );
}

function Positions() {
  const t = useT();
  const { tick, settings, lang } = useS();
  const [edit, setEdit] = useState<string | null>(null);
  const [form, setForm] = useState({ sl: '', tp: '', trail: '', partial: '' });
  const [err, setErr] = useState('');
  if (!tick || !settings) return null;
  const lot = settings.risk.lotUnits;
  const ccy = tick.account.ccy;
  const close = async (id: string, units?: number) => {
    setErr('');
    const r = await api.post(`/api/positions/${id}/close`, units ? { units } : {});
    if (!r.ok) setErr(tx(r.message, lang) || r.error);
  };
  const add = async (p: any) => {
    const r = await api.post('/api/order', { sym: p.sym, side: p.side, type: 'market', units: p.units });
    if (!r.ok) setErr(tx(r.message, lang) || r.error);
  };
  const saveEdit = async (id: string) => {
    const r = await api.post(`/api/positions/${id}/modify`, {
      sl: form.sl ? Number(form.sl) : null, tp: form.tp ? Number(form.tp) : null, trailPips: form.trail ? Number(form.trail) : null,
    });
    if (!r.ok) setErr(tx(r.message, lang) || r.error); else setEdit(null);
  };
  if (!tick.positions.length) return <div className="empty">{t('暂无持仓。点击右侧 BUY / SELL 开仓。', 'ポジションはありません。右側の BUY / SELL で新規注文。')}</div>;
  const total = tick.positions.reduce((s, p) => s + p.pnl, 0);
  return (
    <div>
      {err && <div className="order-msg bad">{err}</div>}
      <table className="grid">
        <thead><tr>
          <th>{t('货币对', '通貨ペア')}</th><th>{t('方向', '売買')}</th><th>{t('手数', 'Lot')}</th><th>{t('开仓价', '約定価格')}</th><th>{t('现价', '評価レート')}</th>
          <th>pips</th><th>{t('浮动盈亏', '評価損益')}</th><th>{t('掉期', 'スワップ')}</th><th>SL</th><th>TP</th><th>{t('保证金', '証拠金')}</th><th>{t('来源', '発注元')}</th><th></th>
        </tr></thead>
        <tbody>
          {tick.positions.map((p) => (
            <Fragment key={p.id}>
              <tr key={p.id} className={p.pnl >= 0 ? 'row-pos' : 'row-neg'}>
                <td>{pairLabel(p.sym)}</td>
                <td className={p.side === 'buy' ? 'up' : 'down'}>{p.side === 'buy' ? t('买', '買') : t('卖', '売')}</td>
                <td>{num(p.units / lot, p.units % lot ? 1 : 0)}</td>
                <td>{px(p.sym, p.openPrice)}</td>
                <td>{px(p.sym, p.current)}</td>
                <td className={p.pips >= 0 ? 'pos' : 'neg'}>{p.pips.toFixed(1)}</td>
                <td><Rolling value={p.pnl} ccy={ccy} sign className={p.pnl >= 0 ? 'pos b' : 'neg b'} /></td>
                <td className={p.swap >= 0 ? 'pos' : 'neg'}>{money(p.swap, ccy, true)}</td>
                <td>{px(p.sym, p.sl)}{p.trailPips ? <small> T{p.trailPips}</small> : null}</td>
                <td>{px(p.sym, p.tp)}</td>
                <td>{money(p.margin, ccy)}</td>
                <td>{p.source === 'ai' ? <span className="tag-ai">AI</span> : t('玩家', '手動')}</td>
                <td className="row-actions">
                  <button className="btn-danger small" onClick={() => close(p.id)}>{t('平仓', '決済')}</button>
                  <button className="small" onClick={() => { setEdit(edit === p.id ? null : p.id); setForm({ sl: p.sl ? String(p.sl) : '', tp: p.tp ? String(p.tp) : '', trail: p.trailPips ? String(p.trailPips) : '', partial: '' }); }}>{t('修改', '変更')}</button>
                  <button className="small" onClick={() => add(p)} title={t('同方向同数量加仓', '同方向・同数量で追加')}>+{t('加仓', '追加')}</button>
                </td>
              </tr>
              {edit === p.id && (
                <tr key={p.id + '-e'} className="edit-row"><td colSpan={13}>
                  SL <input value={form.sl} onChange={(e) => setForm({ ...form, sl: e.target.value })} />
                  TP <input value={form.tp} onChange={(e) => setForm({ ...form, tp: e.target.value })} />
                  {t('追踪', 'トレール')}(pips) <input value={form.trail} onChange={(e) => setForm({ ...form, trail: e.target.value })} />
                  <button className="small" onClick={() => saveEdit(p.id)}>{t('保存', '保存')}</button>
                  <span className="sep" />
                  {t('部分平仓(手)', '一部決済(Lot)')} <input value={form.partial} onChange={(e) => setForm({ ...form, partial: e.target.value })} />
                  <button className="small btn-danger" onClick={() => { const u = Math.round(Number(form.partial) * lot); if (u > 0) void close(p.id, u); }}>{t('部分平仓', '一部決済')}</button>
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={6}>{t('合计', '合計')}</td><td><Rolling value={total} ccy={ccy} sign className={total >= 0 ? 'pos b' : 'neg b'} /></td><td colSpan={6}>
          <button className="btn-danger small" onClick={() => confirm(t('确定全部平仓？', '全ポジションを決済しますか？')) && api.post('/api/close-all', {})}>{t('全部平仓', '全決済')}</button>
        </td></tr></tfoot>
      </table>
    </div>
  );
}

function Orders() {
  const t = useT();
  const tick = useS((s) => s.tick);
  const lot = useS((s) => s.settings?.risk.lotUnits ?? 10000);
  if (!tick) return null;
  if (!tick.orders.length) return <div className="empty">{t('暂无挂单', '注文中の注文はありません')}</div>;
  return (
    <table className="grid">
      <thead><tr><th>{t('货币对', '通貨ペア')}</th><th>{t('方向', '売買')}</th><th>{t('类型', '種類')}</th><th>{t('价格', '価格')}</th><th>{t('手数', 'Lot')}</th><th>SL</th><th>TP</th><th>{t('时间', '時刻')}</th><th></th></tr></thead>
      <tbody>
        {tick.orders.map((o) => (
          <tr key={o.id}>
            <td>{pairLabel(o.sym)}</td><td className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? t('买', '買') : t('卖', '売')}</td>
            <td>{o.type === 'limit' ? t('限价', '指値') : t('止损单', '逆指値')}</td><td>{px(o.sym, o.price)}</td><td>{num(o.units / lot, 1)}</td>
            <td>{px(o.sym, o.sl)}</td><td>{px(o.sym, o.tp)}</td><td>{simTime(o.createdAt, tick.account.ccy)}</td>
            <td><button className="small" onClick={() => api.post(`/api/orders/${o.id}/cancel`)}>{t('取消', '取消')}</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ACTION: Record<string, [string, string]> = {
  open: ['开仓', '新規'], close: ['平仓', '決済'], partial: ['部分平仓', '一部決済'], sl: ['止损', '損切り'], tp: ['止盈', '利確'],
  trail: ['追踪止损', 'トレール'], stopout: ['强平', 'ロスカット'], 'fill-limit': ['限价成交', '指値約定'], 'fill-stop': ['止损单成交', '逆指値約定'],
};

function History() {
  const t = useT();
  const { trades, tick, lang, settings } = useS();
  if (!tick) return null;
  const lot = settings?.risk.lotUnits ?? 10000;
  const list = [...trades].reverse().slice(0, 300);
  if (!list.length) return <div className="empty">{t('暂无成交', '約定履歴はありません')}</div>;
  return (
    <table className="grid">
      <thead><tr><th>{t('时间', '時刻')}</th><th>{t('货币对', '通貨ペア')}</th><th>{t('类型', '区分')}</th><th>{t('方向', '売買')}</th><th>{t('手数', 'Lot')}</th><th>{t('价格', '価格')}</th><th>{t('滑点', 'スリッページ')}</th><th>{t('掉期', 'スワップ')}</th><th>{t('已实现盈亏', '実現損益')}</th><th>{t('余额', '残高')}</th><th>{t('来源', '発注元')}</th></tr></thead>
      <tbody>
        {list.map((r) => {
          const isOpen = r.action === 'open' || r.action.startsWith('fill');
          return (
            <tr key={r.id} className={r.action === 'stopout' ? 'row-stopout' : ''}>
              <td>{simTime(r.t, tick.account.ccy)}</td><td>{pairLabel(r.sym)}</td><td>{ACTION[r.action]?.[lang === 'ja' ? 1 : 0] ?? r.action}</td>
              <td className={r.side === 'buy' ? 'up' : 'down'}>{r.side === 'buy' ? t('买', '買') : t('卖', '売')}</td>
              <td>{num(r.units / lot, 1)}</td><td>{px(r.sym, r.price)}</td><td>{r.slippagePips ? `${r.slippagePips}p` : '-'}</td>
              <td>{isOpen ? '-' : money(r.swap, tick.account.ccy, true)}</td>
              <td className={isOpen ? '' : r.pnl >= 0 ? 'pos b' : 'neg b'}>{isOpen ? '-' : money(r.pnl, tick.account.ccy, true)}</td>
              <td>{money(r.balanceAfter, tick.account.ccy)}</td>
              <td>{r.source === 'ai' ? <span className="tag-ai">AI</span> : t('玩家', '手動')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AiTrader() {
  const t = useT();
  const { tick, settings, profiles, aiLog, lang } = useS();
  const [busy, setBusy] = useState(false);
  if (!tick || !settings) return null;
  const a = settings.autoTrader;
  const role = settings.roles.trader;
  const upd = async (patch: any) => { await api.post('/api/settings', { autoTrader: patch }); await refreshSettings(); };
  const updRole = async (patch: any) => { await api.post('/api/settings', { roles: { trader: patch } }); await refreshSettings(); };
  const logs = aiLog.filter((x) => x.role === 'trader').slice().reverse().slice(0, 60);
  const allPairs = useS.getState().meta?.pairs.map((p) => p.sym) ?? [];
  return (
    <div className="ai-trader">
      <div className="ai-controls">
        <div className="ai-row">
          <button className={`btn-big-toggle ${a.enabled ? 'on' : ''}`} onClick={() => upd({ enabled: !a.enabled })}>
            {a.enabled ? t('■ 停止 AI 自动交易', '■ AI自動売買を停止') : t('▶ 启动 AI 自动交易', '▶ AI自動売買を開始')}
          </button>
          <button disabled={busy} onClick={async () => { setBusy(true); try { await api.post('/api/ai/trader/run-now'); } finally { setBusy(false); } }}>{busy || tick.aiBusy.trader ? t('思考中…', '思考中…') : t('立即看盘一次', '今すぐ分析')}</button>
          <button className="btn-danger" onClick={() => api.post('/api/close-all', { source: 'ai' })}>{t('平掉全部 AI 持仓', 'AIポジション全決済')}</button>
        </div>
        <div className="ai-grid">
          <label>{t('交易模型', '売買モデル')}
            <select value={role.enabled && role.profileId ? role.profileId : ''} onChange={(e) => updRole(e.target.value ? { enabled: true, profileId: e.target.value } : { enabled: false })}>
              <option value="">{t('本地规则策略（离线）', 'ローカル戦略（オフライン）')}</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
            </select>
          </label>
          <label>{t('策略', '戦略')}
            <select value={a.strategy} onChange={(e) => upd({ strategy: e.target.value as TraderStrategy })}>
              <option value="trend">{t('趋势跟随', 'トレンドフォロー')}</option><option value="meanrev">{t('均值回归', '逆張り')}</option>
              <option value="breakout">{t('突破', 'ブレイクアウト')}</option><option value="gambler">{t('赌徒(马丁)', 'ギャンブラー(マーチン)')}</option>
            </select>
          </label>
          <label>{t('风险偏好', 'リスク許容度')}
            <select value={a.risk} onChange={(e) => upd({ risk: e.target.value as RiskProfile })}>
              <option value="conservative">{t('保守', '保守的')}</option><option value="balanced">{t('均衡', 'バランス')}</option>
              <option value="aggressive">{t('激进', '積極的')}</option><option value="degenerate">{t('梭哈', '全力')}</option>
            </select>
          </label>
          <label>{t('周期', '時間足')}<select value={a.tf} onChange={(e) => upd({ tf: e.target.value as TF })}>{TFS.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>{t('单笔最大手数', '1回の最大Lot')}<input type="number" defaultValue={a.maxLotsPerOrder} onBlur={(e) => upd({ maxLotsPerOrder: Number(e.target.value) })} /></label>
          <label>{t('最大持仓数', '最大ポジション数')}<input type="number" defaultValue={a.maxPositions} onBlur={(e) => upd({ maxPositions: Number(e.target.value) })} /></label>
          <label>{t('有效杠杆上限', '実効レバ上限')}<input type="number" defaultValue={a.maxEffectiveLeverage} onBlur={(e) => upd({ maxEffectiveLeverage: Number(e.target.value) })} /></label>
          <label>{t('看盘间隔(秒)', '分析間隔(秒)')}<input type="number" defaultValue={role.intervalSec} onBlur={(e) => updRole({ intervalSec: Number(e.target.value) })} /></label>
          <label className="chk"><input type="checkbox" checked={a.requireStopLoss} onChange={(e) => upd({ requireStopLoss: e.target.checked })} /> {t('强制止损', '損切り必須')}</label>
        </div>
        <div className="pair-picks">
          {allPairs.map((s) => (
            <button key={s} className={a.pairs.includes(s) ? 'on' : ''} onClick={() => upd({ pairs: a.pairs.includes(s) ? a.pairs.filter((x) => x !== s) : [...a.pairs, s] })}>{pairLabel(s)}</button>
          ))}
        </div>
        <textarea placeholder={t('给 AI 的策略补充说明（可选）', 'AIへの戦略メモ（任意）')} defaultValue={a.notes} onBlur={(e) => upd({ notes: e.target.value })} />
        <div className="muted small">{t('AI 订单与玩家订单使用同一套保证金检查、点差、滑点与强平规则。你可以随时手动平仓或修改 AI 持仓。', 'AIの注文もプレイヤーと同じ証拠金チェック・スプレッド・スリッページ・ロスカットが適用されます。いつでも手動で介入できます。')}</div>
      </div>
      <div className="ai-log-list">
        {logs.length === 0 && <div className="empty">{t('尚无决策记录', '判断ログはまだありません')}</div>}
        {logs.map((l) => (
          <div key={l.id} className={`ai-log ${l.ok ? '' : 'bad'}`}>
            <div className="ai-log-head"><span className={`tag-${l.engine}`}>{l.engine === 'ai' ? 'AI' : 'LOCAL'}</span> {simTime(l.t, tick.account.ccy)} {l.latencyMs ? <small>{l.latencyMs}ms · {l.tokensIn}/{l.tokensOut} tok</small> : null}</div>
            <div className="ai-log-sum">{l.summary}</div>
            {l.detail && <div className="muted small">{l.detail}</div>}
            {l.actions?.map((x, i) => <div key={i} className={`ai-act ${x.ok ? 'ok' : 'bad'}`}>{x.ok ? '✓' : '✗'} {x.text} → {x.result}</div>)}
          </div>
        ))}
      </div>

    </div>
  );
}

function Calendar() {
  const t = useT();
  const { tick, lang } = useS();
  if (!tick) return null;
  const names: Record<string, [string, string]> = {
    CPI: ['CPI', 'CPI'], NFP: ['非农', '雇用統計'], UNEMP: ['失业率', '失業率'], GDP: ['GDP', 'GDP'], PMI: ['PMI', 'PMI'],
    RETAIL: ['零售销售', '小売売上高'], RATE: ['利率决议', '政策金利'], TRADE: ['贸易收支', '貿易収支'], SENTI: ['消费者信心', '消費者信頼感'],
  };
  return (
    <table className="grid">
      <thead><tr><th>{t('时间', '時刻')}</th><th>{t('货币', '通貨')}</th><th>{t('指标', '指標')}</th><th>{t('重要度', '重要度')}</th><th>{t('前值', '前回')}</th><th>{t('预期', '予想')}</th><th>{t('结果', '結果')}</th><th>{t('意外', 'サプライズ')}</th></tr></thead>
      <tbody>
        {tick.calendar.map((e) => (
          <tr key={e.id} className={e.released ? 'released' : e.t - tick.clock.t < 3600 ? 'soon' : ''}>
            <td>{simTime(e.t, tick.account.ccy)}</td><td>{e.ccy}</td><td>{names[e.kind][lang === 'ja' ? 1 : 0]}</td>
            <td className="stars">{'★'.repeat(e.importance)}{'☆'.repeat(3 - e.importance)}</td>
            <td>{e.previous}{e.unit}</td><td>{e.forecast}{e.unit}</td>
            <td className="b">{e.actual === null ? '-' : `${e.actual}${e.unit}`}</td>
            <td className={e.surprise === null ? '' : e.surprise > 0.5 ? 'pos' : e.surprise < -0.5 ? 'neg' : ''}>{e.surprise === null ? '-' : e.surprise.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Econ() {
  const t = useT();
  const tick = useS((s) => s.tick);
  if (!tick) return null;
  const ccy = tick.account.ccy;
  return (
    <div className="two-col">
      <table className="grid">
        <thead><tr><th>{t('货币', '通貨')}</th><th>{t('政策利率', '政策金利')}</th><th>{t('通胀', 'インフレ')}</th><th>{t('失业率', '失業率')}</th><th>GDP</th><th>PMI</th><th>{t('景气', '景況感')}</th><th>{t('央行立场', '中銀スタンス')}</th></tr></thead>
        <tbody>
          {tick.econ.map((e) => (
            <tr key={e.ccy}><td className="b">{e.ccy}</td><td>{e.rate.toFixed(2)}%</td><td>{e.inflation.toFixed(2)}%</td><td>{e.unemployment.toFixed(1)}%</td><td>{e.gdp.toFixed(1)}%</td><td>{e.pmi.toFixed(1)}</td>
              <td className={e.sentiment >= 0 ? 'pos' : 'neg'}>{e.sentiment.toFixed(2)}</td><td>{e.stance > 0.2 ? t('鹰', 'タカ') : e.stance < -0.2 ? t('鸽', 'ハト') : t('中性', '中立')} ({e.stance.toFixed(2)})</td></tr>
          ))}
        </tbody>
      </table>
      <table className="grid">
        <thead><tr><th>{t('货币对', '通貨ペア')}</th><th>{t('买入掉期/手/日', '買スワップ/Lot/日')}</th><th>{t('卖出掉期/手/日', '売スワップ/Lot/日')}</th></tr></thead>
        <tbody>
          {Object.entries(tick.swaps).map(([s, v]) => (
            <tr key={s}><td>{pairLabel(s)}</td><td className={v.long >= 0 ? 'pos' : 'neg'}>{money(v.long, ccy, true)}</td><td className={v.short >= 0 ? 'pos' : 'neg'}>{money(v.short, ccy, true)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Loans() {
  const t = useT();
  const { tick, meta, lang, repayable } = useS();
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState('bank');
  const [repay, setRepay] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  if (!tick || !meta) return null;
  const a = tick.account;
  const doBorrow = async () => {
    setMsg('');
    const r = await api.post('/api/loans/borrow', { amount: Number(amount), planId: plan });
    setMsg(r.ok ? t('借款成功', '借入完了') : tx(r.message, lang) || r.error);
    const rr = await api.get('/api/loans/repayable'); useS.setState({ repayable: rr.repayable });
  };
  const doRepay = async (id: string, amt: number) => {
    setMsg('');
    const r = await api.post(`/api/loans/${id}/repay`, { amount: amt });
    setMsg(r.ok ? `${t('已还款', '返済')} ${money(r.paid, a.ccy)}` : tx(r.message, lang) || r.error);
    if (r.repayable !== undefined) useS.setState({ repayable: r.repayable });
  };
  const loans = tick.loans.filter((l) => l.status !== 'repaid');
  return (
    <div className="loans">
      <div className="loan-form">
        <div className="loan-summary">
          <div><span>{t('贷款上限', '借入上限')}</span><b>{money(a.loanLimit, a.ccy)}</b></div>
          <div><span>{t('未偿本金', '借入元本残高')}</span><b className="neg">{money(a.loanPrincipal, a.ccy)}</b></div>
          <div><span>{t('剩余额度', '借入可能額')}</span><b>{money(a.loanAvailable, a.ccy)}</b></div>
          <div><span>{t('可用于还款', '返済に使える現金')}</span><b>{money(repayable, a.ccy)}</b></div>
        </div>
        <div className="seg">
          {meta.loanPlans.map((p) => (
            <button key={p.id} className={plan === p.id ? 'on' : ''} onClick={() => setPlan(p.id)}>
              {tx(p.name, lang)}<br /><small>{t('年利率', '年利')} {(p.apr * 100).toFixed(0)}% · {p.termDays}{t('天', '日')}</small>
            </button>
          ))}
        </div>
        <div className="ai-row">
          <input placeholder={t('借款金额', '借入金額')} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          {[0.1, 0.25, 0.5, 1].map((k) => <button key={k} className="small" onClick={() => setAmount(String(Math.floor(a.loanAvailable * k)))}>{k * 100}%</button>)}
          <button className="btn-primary" onClick={doBorrow}>{t('借款', '借りる')}</button>
        </div>
        <div className="muted small">{t('借款会增加账户现金，同时形成等额负债。个人净资产 = 交易账户净值 − 贷款本息。逾期按 1.5 倍利率计罚息，超过宽限期即违约破产。', '借入金は口座の現金を増やし、同額の負債になります。個人純資産＝口座純資産−借入元利。延滞は1.5倍の遅延損害金、猶予期間を過ぎると債務不履行で破産。')}</div>
        {msg && <div className="order-msg">{msg}</div>}
      </div>
      <table className="grid">
        <thead><tr><th>{t('方案', 'プラン')}</th><th>{t('本金', '元本')}</th><th>{t('未偿', '残高')}</th><th>{t('应计利息', '未払利息')}</th><th>{t('年利率', '年利')}</th><th>{t('到期', '期限')}</th><th>{t('状态', '状態')}</th><th>{t('还款', '返済')}</th></tr></thead>
        <tbody>
          {loans.length === 0 && <tr><td colSpan={8} className="empty">{t('无未偿贷款', '借入はありません')}</td></tr>}
          {loans.map((l) => {
            const due = l.outstanding + l.interest;
            const left = l.dueAt - tick.clock.t;
            return (
              <tr key={l.id} className={l.status !== 'active' ? 'row-stopout' : left < 86400 ? 'soon' : ''}>
                <td>{tx(meta.loanPlans.find((p) => p.id === l.planId)?.name, lang)}</td>
                <td>{money(l.principal, a.ccy)}</td><td>{money(l.outstanding, a.ccy)}</td><td className="neg">{money(l.interest, a.ccy)}</td>
                <td>{(l.apr * 100).toFixed(0)}%{l.status === 'overdue' ? ' ×1.5' : ''}</td>
                <td>{simTime(l.dueAt, a.ccy)}<br /><small>{left > 0 ? `${(left / 86400).toFixed(1)}${t('天后', '日後')}` : t('已逾期', '期限超過')}</small></td>
                <td>{l.status}</td>
                <td className="row-actions">
                  <input style={{ width: 90 }} value={repay[l.id] ?? ''} onChange={(e) => setRepay({ ...repay, [l.id]: e.target.value.replace(/[^\d.]/g, '') })} />
                  <button className="small" onClick={() => doRepay(l.id, Number(repay[l.id]))}>{t('还款', '返済')}</button>
                  <button className="small" onClick={() => doRepay(l.id, due)}>{t('全额', '全額')}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bankrupt-zone">
        <button className="btn-danger small" onClick={() => confirm(t('确定申请个人破产？游戏将结束。', '自己破産を申し立てますか？ゲームが終了します。')) && api.post('/api/bankrupt')}>{t('申请个人破产', '自己破産を申し立てる')}</button>
      </div>
    </div>
  );
}

function EquityCurve() {
  const t = useT();
  const { curve, tick } = useS();
  if (!tick || curve.length < 2) return <div className="empty">{t('数据不足', 'データ不足')}</div>;
  const W = 1000, H = 220;
  const lo = Math.min(...curve.map((p) => Math.min(p.equity, p.netWorth)), 0);
  const hi = Math.max(...curve.map((p) => Math.max(p.equity, p.netWorth)));
  const t0 = curve[0].t, t1 = curve[curve.length - 1].t;
  const x = (tt: number) => ((tt - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - 10 - ((v - lo) / (hi - lo || 1)) * (H - 20);
  const path = (k: 'equity' | 'netWorth') => curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const init = tick.account.initialCapital;
  return (
    <div className="equity-curve">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} style={{ stroke: "var(--neg)", opacity: 0.4 }} strokeDasharray="4 4" />
        <line x1="0" x2={W} y1={y(init)} y2={y(init)} style={{ stroke: "var(--line)" }} strokeDasharray="4 4" />
        <path d={path('netWorth')} style={{ stroke: "var(--ai)" }} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d={path('equity')} style={{ stroke: "var(--pos)" }} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="spark-legend">
        <span className="c-eq">— {t('交易账户净值', '口座純資産')}</span><span className="c-nw">— {t('个人净资产（扣除贷款）', '個人純資産（借入控除後）')}</span>
        <span>{t('最高', '最高')} {money(hi, tick.account.ccy)} · {t('最低', '最低')} {money(lo, tick.account.ccy)} · {t('最大回撤', '最大DD')} {tick.stats.maxDrawdownPct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function AiLog() {
  const t = useT();
  const { aiLog, tick } = useS();
  const [role, setRole] = useState<AiRole | 'all'>('all');
  if (!tick) return null;
  const roleName: Record<AiRole, string> = { news: t('AI-1 新闻编辑', 'AI-1 ニュース編集'), macro: t('AI-2 市场决策', 'AI-2 相場決定'), trader: t('AI-3 交易员', 'AI-3 トレーダー') };
  const list = aiLog.filter((x) => role === 'all' || x.role === role).slice().reverse().slice(0, 120);
  return (
    <div className="ai-log-tab">
      <div className="usage">
        {(['news', 'macro', 'trader'] as AiRole[]).map((r) => {
          const u = tick.aiUsage[r];
          return <div key={r} className="usage-card"><b>{roleName[r]}</b> {tick.aiBusy[r] ? <span className="busy-dot">●</span> : null}
            <span>{t('调用', '呼出')} {u.calls} · {t('失败', '失敗')} {u.fails}</span><span>tok {u.tokensIn}/{u.tokensOut} · {t('费用', '費用')} {u.cost.toFixed(4)}</span></div>;
        })}
        {tick.macro && <div className="usage-card wide"><b>{t('当前宏观指令', '現在のマクロ指令')}</b> <span>{tick.macro.source === 'ai' ? 'AI' : 'LOCAL'} · {t('有效至', '有効期限')} {simTime(tick.macro.until, tick.account.ccy)}</span><span>{tick.macro.commentary !== 'local' ? tick.macro.commentary : ''}</span></div>}
      </div>
      <div className="seg small">
        {(['all', 'news', 'macro', 'trader'] as const).map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r === 'all' ? t('全部', 'すべて') : roleName[r]}</button>)}
      </div>
      <div className="ai-log-list">
        {list.length === 0 && <div className="empty">{t('暂无日志。在设置中配置 AI 后，此处会显示每次调用。', 'ログはありません。設定でAIを構成するとここに表示されます。')}</div>}
        {list.map((l) => (
          <div key={l.id} className={`ai-log ${l.ok ? '' : 'bad'}`}>
            <div className="ai-log-head"><span className={`tag-${l.engine}`}>{l.engine === 'ai' ? 'AI' : 'LOCAL'}</span> {roleName[l.role]} · {simTime(l.t, tick.account.ccy)} {l.latencyMs ? <small>{l.latencyMs}ms · {l.tokensIn}/{l.tokensOut} tok</small> : null}</div>
            <div className="ai-log-sum">{l.summary}</div>
            {l.detail && <div className="muted small">{l.detail}</div>}
            {l.actions?.map((x, i) => <div key={i} className={`ai-act ${x.ok ? 'ok' : 'bad'}`}>{x.ok ? '✓' : '✗'} {x.text} → {x.result}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}


