import { useEffect, useMemo, useState } from 'react';
import { useS, useT, tx } from '../store';
import { money } from '../fmt';

/** 全屏演出：强制平仓、重大新闻、盈亏爆发、追证警告 */
export default function Effects() {
  const t = useT();
  const { effects, lang, tick } = useS();
  const status = tick?.account.status;
  const ccy = tick?.account.ccy;
  return (
    <>
      {status === 'margin-call' && <div className="vignette-danger" />}
      {(status === 'insolvent' || status === 'negative') && <div className="vignette-debt" />}
      {effects.map((e) => {
        if (e.kind === 'stopout') return (
          <div key={e.id} className="fx-stopout">
            <div className="fx-stopout-text" data-text="LOSSCUT">LOSSCUT</div>
            <div className="fx-stopout-sub">{t('强制平仓', 'ロスカット')}</div>
            <div className="fx-stopout-detail">{tx(e.text, lang)}</div>
          </div>
        );
        if (e.kind === 'breaking') return (
          <div key={e.id} className="fx-breaking">
            <div className="fx-breaking-label">{t('突发 / 速報', '速報 / BREAKING')}</div>
            <div className="fx-breaking-text">{tx(e.text, lang)}</div>
          </div>
        );
        if (e.kind === 'profit' || e.kind === 'loss') return (
          <div key={e.id} className={`fx-pnl ${e.kind}`}>{money(e.value ?? 0, ccy, true)}</div>
        );
        if (e.kind === 'margin-call') return <div key={e.id} className="fx-margin">{t('⚠ 追加保证金警告', '⚠ マージンコール')}</div>;
        return null;
      })}
    </>
  );
}

export function Toasts() {
  const { toasts, lang } = useS();
  return (
    <div className="toasts">
      {toasts.map((n) => (
        <div key={n.seq} className={`toast lv-${n.level}`}>{tx(n.text, lang)}</div>
      ))}
    </div>
  );
}

type Line = [string, string];

/** 轻小说式陪伴角色：根据账户状态切换台词 */
export function Mascot() {
  const { tick, lang, effects } = useS();
  const [hidden, setHidden] = useState(() => window.innerHeight <= 560); // 手机横屏默认收起
  const [typed, setTyped] = useState('');
  const line: Line | null = useMemo(() => {
    if (!tick) return null;
    const a = tick.account;
    const eq = Math.max(1, a.equity);
    const last = effects[effects.length - 1];
    if (tick.gameOver) return ['……全部结束了。不过，人生还能重来，对吧？', '……全部終わっちゃった。でも、人生はやり直せるよね？'];
    if (last?.kind === 'stopout') return ['强、强平了……！屏幕上的数字一下子全没了……', 'ロ、ロスカット……！画面の数字が一瞬で消えた……'];
    if (last?.kind === 'breaking') return ['速报！点差在扩大，现在下单小心滑点！', '速報！スプレッドが開いてる、今の注文はスリッページに注意！'];
    if (last?.kind === 'profit') return ['利益确定！……这种感觉，会上瘾的吧。', '利確！……この感覚、クセになっちゃうよね。'];
    if (a.status === 'margin-call') return ['维持率要撑不住了！止损，或者补保证金……快决定！', '維持率がもたない！損切りか入金か……早く決めて！'];
    if (a.status === 'insolvent') return ['借来的钱也算进去的话……我们已经资不抵债了。', '借金も含めたら……もう債務超過だよ。'];
    if (a.balance < 0) return ['余额变成负数了……这是欠券商的钱。', '残高がマイナス……業者への借金だよ。'];
    if (a.unrealized < -eq * 0.3) return ['冷静……这只是浮亏，还没确定……对吧？会回来的……吧？', '落ち着いて……まだ含み損、確定じゃない……よね？戻る……よね？'];
    if (a.unrealized > eq * 0.3) return ['好厉害！不过在平仓之前，利润都只是幻觉哦。', 'すごい！でも決済するまで、利益はただの幻だからね。'];
    if (a.effectiveLeverage > 300) return [`有效杠杆 ${a.effectiveLeverage.toFixed(0)} 倍……这个仓位连我都会手抖。`, `実効レバ${a.effectiveLeverage.toFixed(0)}倍……このポジション、私でも手が震える。`];
    if (a.loanDebt > 0) return ['记得贷款的到期日。逾期的话利息会变成 1.5 倍。', 'ローンの返済期限、忘れないでね。延滞すると金利1.5倍だよ。'];
    if (!tick.session.open) return ['周末休市。周一开盘可能会跳空哦。', '週末は休場。月曜の窓開けに注意ね。'];
    if (tick.positions.length === 0) return ['先观察一下行情吧。看看经济日历上有什么重要指标。', 'まずは相場を観察しよう。経済指標カレンダーもチェックしてね。'];
    return ['盯紧维持率。高杠杆的世界，一瞬间就能天堂或地狱。', '維持率から目を離さないで。ハイレバの世界は一瞬で天国か地獄。'];
  }, [tick?.account.status, Math.sign(tick?.account.unrealized ?? 0), tick?.gameOver, effects.length, tick?.positions.length, tick?.session.open, (tick?.account.effectiveLeverage ?? 0) > 300]);
  const text = line ? line[lang === 'ja' ? 1 : 0] : '';
  useEffect(() => {
    let i = 0;
    setTyped('');
    const id = setInterval(() => {
      i++;
      setTyped(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [text]);
  if (!tick) return null;
  if (hidden) return <button className="mascot-show" onClick={() => setHidden(false)}>💬</button>;
  return (
    <div className="mascot">
      <div className="mascot-avatar"><div className="mascot-face">ミ</div></div>
      <div className="mascot-bubble">
        <div className="mascot-name">{lang === 'ja' ? '汐見ミナ' : '汐见美奈'} <small>{lang === 'ja' ? '（トレードの先輩）' : '（交易前辈）'}</small></div>
        <div className="mascot-text">{typed}<span className="caret">▌</span></div>
      </div>
      <button className="mascot-close" onClick={() => setHidden(true)}>×</button>
    </div>
  );
}
