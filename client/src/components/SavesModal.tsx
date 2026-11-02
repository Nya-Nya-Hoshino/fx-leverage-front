import { useEffect, useState } from 'react';
import type { SaveListItem } from '../../../shared/types';
import { api, loadState } from '../api';
import { useS, useT } from '../store';
import { money, simTime } from '../fmt';

export default function SavesModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const saveId = useS((s) => s.saveId);
  const [saves, setSaves] = useState<SaveListItem[]>([]);
  const [msg, setMsg] = useState('');
  const refresh = () => api.get<SaveListItem[]>('/api/saves').then(setSaves);
  useEffect(() => { void refresh(); }, []);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setMsg('…');
    try { await fn(); setMsg(done); await refresh(); } catch (e: any) { setMsg(e.message); }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>{t('存档管理', 'セーブ管理')}</b><button className="btn-ghost" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <div className="ai-row">
            <button className="btn-primary" onClick={() => act(() => api.post('/api/save'), t('已手动保存', '保存しました'))}>{t('立即保存', '今すぐ保存')}</button>
            <button onClick={async () => { await api.post('/api/unload'); onClose(); await loadState(); }}>{t('新建账户 / 返回标题', '新規口座 / タイトルへ')}</button>
            <span className="muted small">{t('每 30 秒自动保存，切换存档前也会自动保存。', '30秒ごとに自動保存。切替前にも自動保存します。')}</span>
          </div>
          {msg && <div className="order-msg">{msg}</div>}
          <div className="save-list">
            {saves.map((s) => (
              <div key={s.id} className={`save-item ${s.id === saveId ? 'current' : ''}`}>
                <div className="save-main">
                  <b>{s.name} {s.id === saveId && <em className="tag-ai">{t('当前', '現在')}</em>}</b>
                  <span className="muted">{s.username} · {s.accountCcy} · {s.maxLeverage}x · {simTime(s.simTime, s.accountCcy)}</span>
                  <span>{t('净值', '純資産')} <b className={s.equity >= 0 ? 'pos' : 'neg'}>{money(s.equity, s.accountCcy)}</b> · {t('个人净资产', '個人純資産')} <b className={s.netWorth >= 0 ? 'pos' : 'neg'}>{money(s.netWorth, s.accountCcy)}</b></span>
                </div>
                <div className="row-actions">
                  {s.id !== saveId && <button className="small" onClick={() => act(async () => { await api.post(`/api/saves/${s.id}/load`); await loadState(); onClose(); }, 'OK')}>{t('读取', '読込')}</button>}
                  <button className="small" onClick={() => confirm(t('重置此存档？账户与行情将重新开始。', 'このセーブをリセットしますか？口座と相場が最初からになります。')) && act(async () => { await api.post(`/api/saves/${s.id}/reset`); await loadState(); }, t('已重置', 'リセットしました'))}>{t('重置', 'リセット')}</button>
                  <button className="small btn-danger" onClick={() => confirm(t('删除此存档？', 'このセーブを削除しますか？')) && act(async () => { await api.del(`/api/saves/${s.id}`); if (s.id === saveId) await loadState(); }, t('已删除', '削除しました'))}>{t('删除', '削除')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
