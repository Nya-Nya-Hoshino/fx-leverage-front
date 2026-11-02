import { useEffect, useState } from 'react';
import type { AccountCcy, MarketMode, SaveListItem } from '../../../shared/types';
import { api, loadMeta, loadState } from '../api';
import { useS, useT } from '../store';
import { money, simTime } from '../fmt';
import { ThemeSelect } from './Pulse';

const CAPITAL: Record<AccountCcy, number> = { JPY: 250000, CNY: 12000 };

export default function Welcome() {
  const t = useT();
  const { meta, lang, set } = useS();
  const [saves, setSaves] = useState<SaveListItem[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [f, setF] = useState({ username: '', name: '', accountCcy: 'JPY' as AccountCcy, maxLeverage: 1000, custom: '', marketMode: 'random' as MarketMode, seed: '' });

  const refresh = () => api.get<SaveListItem[]>('/api/saves').then(setSaves).catch(() => undefined);
  useEffect(() => { void refresh(); }, []);

  const create = async () => {
    setErr('');
    const lev = f.custom ? Number(f.custom) : f.maxLeverage;
    if (!f.username.trim()) return setErr(t('请输入用户名', 'ユーザー名を入力してください'));
    if (!(lev >= 1)) return setErr(t('杠杆倍率无效', 'レバレッジが無効です'));
    setBusy(t('正在开立账户并生成历史行情……', '口座開設中・過去チャート生成中……'));
    try {
      await api.post('/api/saves', {
        username: f.username.trim(), name: f.name.trim() || `${f.username.trim()} ${t('的账户', 'の口座')}`,
        accountCcy: f.accountCcy, maxLeverage: lev, marketMode: f.marketMode, ...(f.seed ? { seed: Number(f.seed) } : {}),
      });
      await loadMeta();
      await loadState();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  };

  const load = async (id: string) => {
    setBusy(t('读取存档中……', 'セーブデータ読込中……'));
    try {
      await api.post(`/api/saves/${id}/load`);
      await loadState();
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const del = async (id: string) => {
    if (!confirm(t('确定删除此存档？此操作不可恢复。', 'このセーブデータを削除しますか？元に戻せません。'))) return;
    await api.del(`/api/saves/${id}`);
    void refresh();
  };

  return (
    <div className="welcome">
      <div className="welcome-bg" />
      <div className="welcome-inner">
        <div className="logo-block">
          <div className="logo-kicker">FX LEVERAGE FRONT</div>
          <h1>{t('杠杆战线', 'レバレッジ戦線')}</h1>
          <p className="tagline">{t('架空外汇保证金交易模拟 —— 3000 倍杠杆、浮亏、强平、负债与 AI 市场', '架空FX証拠金取引シミュレーター ―― 3000倍レバ、含み損、ロスカット、借金とAI相場')}</p>
          <p className="disclaimer">{t('※ 全部为虚拟数据，不连接任何真实交易所，不涉及真实资金。', '※ すべて架空データです。実在の取引所や実際の資金とは一切関係ありません。')}</p>
          <div className="lang-switch">
            <button className={lang === 'zh' ? 'on' : ''} onClick={() => { set({ lang: 'zh' }); localStorage.setItem('fx.lang', 'zh'); }}>中文</button>
            <button className={lang === 'ja' ? 'on' : ''} onClick={() => { set({ lang: 'ja' }); localStorage.setItem('fx.lang', 'ja'); }}>日本語</button>
            <ThemeSelect />
          </div>
        </div>

        <div className="welcome-cards">
          <div className="card">
            <h2>{t('开立模拟账户', 'デモ口座を開設')}</h2>
            <label>{t('用户名', 'ユーザー名')}<input value={f.username} maxLength={24} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder={t('例如：杠杆战士', '例：レバ戦士')} /></label>
            <label>{t('存档名称（可选）', 'セーブ名（任意）')}<input value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <div className="field">
              <span>{t('账户本位币', '口座通貨')}</span>
              <div className="seg">
                {(['JPY', 'CNY'] as AccountCcy[]).map((c) => (
                  <button key={c} className={f.accountCcy === c ? 'on' : ''} onClick={() => setF({ ...f, accountCcy: c })}>
                    {c} <small>{money(CAPITAL[c], c)}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>{t('账户最高杠杆', '口座の最大レバレッジ')}</span>
              <div className="seg wrap">
                {(meta?.leverageOptions ?? [1, 25, 100, 500, 1000, 3000]).map((l) => (
                  <button key={l} className={!f.custom && f.maxLeverage === l ? 'on' : ''} onClick={() => setF({ ...f, maxLeverage: l, custom: '' })}>{l}x</button>
                ))}
                <input className="custom-lev" placeholder={t('自定义(架空)', 'カスタム(架空)')} value={f.custom} onChange={(e) => setF({ ...f, custom: e.target.value.replace(/[^\d.]/g, '') })} />
              </div>
              <small className="hint">{t('最高杠杆决定保证金比例（保证金 = 名义金额 ÷ 杠杆）。实际风险取决于你下多大的仓位。', '最大レバは必要証拠金率を決めるだけ（証拠金＝想定元本÷レバ）。実際のリスクは建玉の大きさ次第。')}</small>
            </div>
            <div className="field">
              <span>{t('市场模式', '相場モード')}</span>
              <div className="seg">
                <button className={f.marketMode === 'random' ? 'on' : ''} onClick={() => setF({ ...f, marketMode: 'random' })}>{t('纯随机市场', 'ランダム相場')}</button>
                <button className={f.marketMode === 'ai' ? 'on' : ''} onClick={() => setF({ ...f, marketMode: 'ai' })}>{t('AI 宏观市场', 'AIマクロ相場')}</button>
              </div>
              <small className="hint">{t('AI 宏观模式需在设置中配置 API；未配置时自动由本地宏观引擎驱动。', 'AIマクロはAPI設定が必要。未設定時はローカルのマクロエンジンで動作。')}</small>
            </div>
            <label>{t('随机种子（可选）', '乱数シード（任意）')}<input value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value.replace(/\D/g, '') })} /></label>
            <button className="btn-primary big" disabled={!!busy} onClick={create}>{t('开户并开始交易', '口座開設して取引開始')}</button>
          </div>

          <div className="card">
            <h2>{t('读取存档', 'セーブデータ')}</h2>
            {saves.length === 0 && <p className="muted">{t('暂无存档。可以运行 npm run demo 生成演示存档。', 'セーブデータはありません。npm run demo でデモデータを作成できます。')}</p>}
            <div className="save-list">
              {saves.map((s) => (
                <div key={s.id} className={`save-item ${s.status}`}>
                  <div className="save-main" onClick={() => load(s.id)}>
                    <b>{s.name}</b>
                    <span className="muted">{s.username} · {s.accountCcy} · {s.maxLeverage}x · {simTime(s.simTime, s.accountCcy)}</span>
                    <span>{t('净值', '純資産')} <b className={s.equity >= 0 ? 'pos' : 'neg'}>{money(s.equity, s.accountCcy)}</b> · {t('个人净资产', '個人純資産')} <b className={s.netWorth >= 0 ? 'pos' : 'neg'}>{money(s.netWorth, s.accountCcy)}</b> {s.status === 'bankrupt' && <em className="tag-bad">{t('已破产', '破産')}</em>}</span>
                  </div>
                  <button className="btn-ghost" onClick={() => del(s.id)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
        {busy && <div className="busy">{busy}</div>}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
