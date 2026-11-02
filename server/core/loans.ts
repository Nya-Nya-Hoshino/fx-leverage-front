// 虚拟银行借贷：借款、计息、还款（先息后本）、到期提醒、逾期罚息、违约。
import type { I18nText, Loan, LoanPlan } from '../../shared/types';
import { loanDebt, loanLimit, summarize } from './account';
import { fmtMoney, type ExecCtx } from './execution';

const YEAR = 365 * 86400;

export const LOAN_PLANS: LoanPlan[] = [
  { id: 'bank', apr: 0.06, termDays: 60, graceDays: 7 },
  { id: 'consumer', apr: 0.18, termDays: 30, graceDays: 5 },
  { id: 'shark', apr: 1.2, termDays: 7, graceDays: 2 },
];

export const PLAN_NAME: Record<string, I18nText> = {
  bank: { zh: '樱花银行 信用贷款', ja: 'さくら銀行 フリーローン' },
  consumer: { zh: '速借消费金融', ja: 'スピード消費者金融' },
  shark: { zh: '暗巷金融（架空高利贷）', ja: '路地裏ファイナンス（架空ヤミ金）' },
};

export const PENALTY_MULT = 1.5;

export interface LoanResult { ok: boolean; message?: I18nText; loanId?: string; paid?: number }

function moneyRound(ctx: ExecCtx, v: number) {
  return ctx.st.account.ccy === 'JPY' ? Math.round(v) : Math.round(v * 100) / 100;
}

export function borrow(ctx: ExecCtx, amount: number, planId: string): LoanResult {
  const st = ctx.st;
  if (st.gameOver) return { ok: false, message: { zh: '游戏已结束', ja: 'ゲームオーバーです' } };
  const plan = LOAN_PLANS.find((p) => p.id === planId);
  if (!plan) return { ok: false, message: { zh: '无效的贷款方案', ja: '無効なローンプランです' } };
  amount = moneyRound(ctx, amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: { zh: '借款金额无效', ja: '借入金額が無効です' } };
  if (st.loans.some((l) => l.status === 'defaulted')) return { ok: false, message: { zh: '已有违约记录，银行拒绝放贷', ja: '延滞・債務不履行の記録があり融資を断られました' } };
  const limit = loanLimit(ctx);
  const debt = loanDebt(st);
  if (debt.principal + amount > limit + 1e-6) {
    return { ok: false, message: { zh: `超出借贷上限（剩余额度 ${fmtMoney(Math.max(0, limit - debt.principal))}）`, ja: `借入上限を超えています（残り枠 ${fmtMoney(Math.max(0, limit - debt.principal))}）` } };
  }
  const loan: Loan = {
    id: ctx.nextId('l'), planId, principal: amount, outstanding: amount, interest: 0, apr: plan.apr,
    takenAt: ctx.t, dueAt: ctx.t + plan.termDays * 86400, status: 'active', paidInterest: 0,
  };
  st.loans.push(loan);
  st.account.balance += amount;
  st.stats.totalBorrowed += amount;
  st.stats.maxLoanPrincipal = Math.max(st.stats.maxLoanPrincipal, debt.principal + amount);
  ctx.notify('info', 'loan', { zh: `借入 ${fmtMoney(amount)}（${PLAN_NAME[planId].zh}，年利率 ${(plan.apr * 100).toFixed(0)}%）`, ja: `${fmtMoney(amount)} を借入（${PLAN_NAME[planId].ja}、年利 ${(plan.apr * 100).toFixed(0)}%）` });
  return { ok: true, loanId: loan.id };
}

/** 可用于还款的现金：不能超过余额，也不能动用持仓所需保证金 */
export function repayable(ctx: ExecCtx): number {
  const s = summarize(ctx);
  return Math.max(0, Math.min(ctx.st.account.balance, s.freeMargin));
}

export function repay(ctx: ExecCtx, loanId: string, amount: number): LoanResult {
  const loan = ctx.st.loans.find((l) => l.id === loanId);
  if (!loan || loan.status === 'repaid') return { ok: false, message: { zh: '找不到该贷款', ja: '該当するローンがありません' } };
  if (loan.status === 'defaulted') return { ok: false, message: { zh: '该贷款已违约，进入破产程序', ja: 'このローンは債務不履行となり破産手続き中です' } };
  const due = loan.outstanding + loan.interest;
  amount = Math.min(moneyRound(ctx, amount), due);
  if (due - amount < 0.01) amount = due;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: { zh: '还款金额无效', ja: '返済金額が無効です' } };
  if (amount > repayable(ctx) + 1e-6) return { ok: false, message: { zh: '可用现金不足（需保留持仓保证金）', ja: '返済可能な現金が不足しています（必要証拠金は拘束）' } };
  const toInterest = Math.min(amount, loan.interest);
  loan.interest -= toInterest;
  loan.paidInterest += toInterest;
  loan.outstanding -= amount - toInterest;
  ctx.st.stats.totalInterestPaid += toInterest;
  ctx.st.account.balance -= amount;
  if (loan.outstanding < 0.005 && loan.interest < 0.005) {
    loan.outstanding = 0; loan.interest = 0; loan.status = 'repaid';
    ctx.notify('success', 'loan-repaid', { zh: `贷款已全部还清（${PLAN_NAME[loan.planId].zh}）`, ja: `ローンを完済しました（${PLAN_NAME[loan.planId].ja}）` });
  }
  return { ok: true, loanId, paid: amount };
}

/** 计息与到期管理。返回 true 表示发生违约 */
export function accrueLoans(ctx: ExecCtx, dt: number): boolean {
  let defaulted = false;
  for (const l of ctx.st.loans) {
    if (l.status === 'repaid' || l.status === 'defaulted') continue;
    const apr = l.status === 'overdue' ? l.apr * PENALTY_MULT : l.apr;
    l.interest += (l.outstanding * apr * dt) / YEAR;
    const plan = LOAN_PLANS.find((p) => p.id === l.planId)!;
    if (!l.remindedDue && ctx.t >= l.dueAt - 86400 && ctx.t < l.dueAt) {
      l.remindedDue = true;
      ctx.notify('warn', 'loan-due', { zh: `贷款将于 24 小时内到期：应还 ${fmtMoney(l.outstanding + l.interest)}`, ja: `ローン返済期限まで24時間：返済額 ${fmtMoney(l.outstanding + l.interest)}` });
    }
    if (l.status === 'active' && ctx.t >= l.dueAt) {
      l.status = 'overdue';
      ctx.notify('danger', 'loan-overdue', { zh: `贷款逾期！开始按 ${PENALTY_MULT} 倍利率计收罚息，宽限期 ${plan.graceDays} 天`, ja: `ローン延滞！金利が${PENALTY_MULT}倍の遅延損害金に。猶予 ${plan.graceDays} 日` }, true);
    }
    if (l.status === 'overdue' && ctx.t >= l.dueAt + plan.graceDays * 86400) {
      l.status = 'defaulted';
      defaulted = true;
      ctx.notify('danger', 'loan-default', { zh: '贷款违约！债权人申请强制执行……', ja: '債務不履行！債権者が強制執行を申し立てました……' }, true);
    }
  }
  return defaulted;
}
