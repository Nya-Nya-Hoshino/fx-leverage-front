// 风控：保证金维持率预警、强制平仓（ロスカット）、负余额处理。
import { closePosition, fmtMoney, type ExecCtx } from './execution';
import { positionPnl, summarize } from './account';

export function checkRisk(ctx: ExecCtx): boolean {
  const st = ctx.st;
  const acc = st.account;
  if (st.positions.length === 0) { acc.marginCallActive = false; return false; }
  const s = summarize(ctx);
  if (s.marginLevel === null) return false;
  const r = st.risk;

  if (s.marginLevel <= r.stopOutLevel) {
    if (!ctx.marketOpen()) return false;
    const before = s.equity;
    ctx.notify('danger', 'stopout', {
      zh: `强制平仓！保证金维持率 ${s.marginLevel.toFixed(1)}% ≤ ${r.stopOutLevel}%`,
      ja: `ロスカット発動！証拠金維持率 ${s.marginLevel.toFixed(1)}% ≤ ${r.stopOutLevel}%`,
    }, true);
    if (r.stopOutMode === 'all') {
      for (const pos of [...st.positions]) closePosition(ctx, pos.id, null, 'stopout');
    } else {
      // 亏损最大的持仓优先平仓，直至维持率恢复
      while (st.positions.length > 0) {
        const worst = [...st.positions].sort((a, b) => (positionPnl(ctx, a) + a.swap) - (positionPnl(ctx, b) + b.swap))[0];
        closePosition(ctx, worst.id, null, 'stopout');
        const s2 = summarize(ctx);
        if (s2.marginLevel === null || s2.marginLevel > r.stopOutLevel * 1.5) break;
      }
    }
    st.stats.stopOuts++;
    acc.marginCallActive = false;
    const after = summarize(ctx);
    ctx.notify('danger', 'stopout-result', {
      zh: `强平完成：净值 ${Math.round(before).toLocaleString()} → ${Math.round(after.equity).toLocaleString()}`,
      ja: `ロスカット完了：純資産 ${Math.round(before).toLocaleString()} → ${Math.round(after.equity).toLocaleString()}`,
    });
    handleNegative(ctx);
    return true;
  }

  if (s.marginLevel <= r.marginCallLevel) {
    if (!acc.marginCallActive) {
      acc.marginCallActive = true;
      st.stats.marginCalls++;
      ctx.notify('warn', 'margin-call', {
        zh: `追加保证金警告：维持率 ${s.marginLevel.toFixed(1)}%（强平线 ${r.stopOutLevel}%）`,
        ja: `マージンコール：維持率 ${s.marginLevel.toFixed(1)}%（ロスカット水準 ${r.stopOutLevel}%）`,
      }, true);
    }
  } else if (s.marginLevel > r.marginCallLevel * 1.2) {
    acc.marginCallActive = false;
  }
  return false;
}

/** 强平后账户余额为负：零截断（若开启）或形成对券商的欠款 */
export function handleNegative(ctx: ExecCtx) {
  const st = ctx.st;
  const acc = st.account;
  if (acc.balance >= 0 || st.positions.length > 0) return;
  if (st.risk.negativeBalanceProtection) {
    const owed = -acc.balance;
    acc.balance = 0;
    ctx.notify('warn', 'zero-cut', { zh: `零截断：券商承担了 ${fmtMoney(owed)} 的亏损`, ja: `ゼロカット：業者が ${fmtMoney(owed)} の損失を負担しました` });
  } else {
    ctx.notify('danger', 'negative-balance', {
      zh: `账户余额为负（${fmtMoney(acc.balance)}）！你欠券商钱了，需要入金（可借贷）补足。`,
      ja: `口座残高がマイナス（${fmtMoney(acc.balance)}）！業者への不足金が発生。入金（借入）で補填が必要です。`,
    }, true);
  }
}
