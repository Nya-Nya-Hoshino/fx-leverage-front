import { useState } from 'react';
import type { AiProfilePublic, AiRole } from '../../../shared/types';
import { api, refreshSettings } from '../api';
import { useS, useT } from '../store';

type Tab = 'market' | 'risk' | 'ai' | 'clock';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('market');
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>{t('设置', '設定')}</b>
          <div className="seg small">
            {([['market', t('行情引擎', '相場エンジン')], ['risk', t('风控与交易', 'リスク管理')], ['ai', t('AI 智能体', 'AIエージェント')], ['clock', t('时钟', '時計')]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {tab === 'market' && <MarketTab />}
          {tab === 'risk' && <RiskTab />}
          {tab === 'ai' && <AiTab />}
          {tab === 'clock' && <ClockTab />}
        </div>
      </div>
    </div>
  );
}

function Slider({ label, hint, value, min, max, step, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="slider">
      <div className="slider-head"><span>{label}</span><b>{v}</b></div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} onMouseUp={() => onChange(v)} onTouchEnd={() => onChange(v)} onKeyUp={() => onChange(v)} />
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

function MarketTab() {
  const t = useT();
  const s = useS((x) => x.settings);
  const seed = useS((x) => x.seed);
  if (!s) return null;
  const m = s.marketSettings;
  const upd = async (patch: any) => { await api.post('/api/settings', { market: patch }); await refreshSettings(); };
  return (
    <div className="settings-grid">
      <Slider label={t('波动率倍数', 'ボラティリティ倍率')} hint={t('1 ≈ 真实市场量级，越大越刺激', '1≒現実の水準、大きいほど刺激的')} value={m.volMult} min={0.2} max={6} step={0.1} onChange={(v) => upd({ volMult: v })} />
      <Slider label={t('趋势强度', 'トレンド強度')} value={m.trendStrength} min={0} max={4} step={0.1} onChange={(v) => upd({ trendStrength: v })} />
      <Slider label={t('均值回归强度', '平均回帰の強さ')} value={m.meanReversion} min={0} max={5} step={0.1} onChange={(v) => upd({ meanReversion: v })} />
      <Slider label={t('跳跃/突发频率', 'ジャンプ/突発頻度')} value={m.jumpRate} min={0} max={10} step={0.1} onChange={(v) => upd({ jumpRate: v })} />
      <Slider label={t('黑天鹅（次/模拟年）', 'ブラックスワン（回/年）')} value={m.blackSwanPerYear} min={0} max={100} step={1} onChange={(v) => upd({ blackSwanPerYear: v })} />
      <Slider label={t('周末跳空倍数', '週末の窓倍率')} value={m.gapMult} min={0} max={5} step={0.1} onChange={(v) => upd({ gapMult: v })} />
      <Slider label={t('点差倍数', 'スプレッド倍率')} value={m.spreadMult} min={0.2} max={10} step={0.1} onChange={(v) => upd({ spreadMult: v })} />
      <Slider label={t('新闻冲击倍数', 'ニュース影響倍率')} value={m.newsImpact} min={0} max={5} step={0.1} onChange={(v) => upd({ newsImpact: v })} />
      <label className="chk"><input type="checkbox" checked={m.sessionEffects} onChange={(e) => upd({ sessionEffects: e.target.checked })} /> {t('交易时段效应（亚/欧/美不同波动与点差）', '時間帯効果（東京/欧州/NYで変動・スプレッドが変化）')}</label>
      <div className="muted small">{t('随机种子', '乱数シード')}：{seed}。{t('行情由带种子的数学引擎生成；AI 只调整概率参数，不能直接决定价格，也看不到你的持仓。', '相場はシード付き数理エンジンが生成。AIは確率パラメータを調整するだけで、価格を直接決めたりポジションを見たりはしません。')}</div>
    </div>
  );
}

function RiskTab() {
  const t = useT();
  const s = useS((x) => x.settings);
  const [err, setErr] = useState('');
  if (!s) return null;
  const r = s.risk;
  const upd = async (patch: any) => {
    setErr('');
    try { await api.post('/api/settings', { risk: patch }); await refreshSettings(); } catch (e: any) { setErr(e.message); }
  };
  const numField = (label: string, key: keyof typeof r, hint?: string) => (
    <label>{label}<input type="number" defaultValue={r[key] as number} onBlur={(e) => upd({ [key]: Number(e.target.value) })} />{hint && <small className="muted">{hint}</small>}</label>
  );
  return (
    <div className="settings-grid">
      {numField(t('保证金预警线 (%)', 'マージンコール水準 (%)'), 'marginCallLevel')}
      {numField(t('强制平仓线 (%)', 'ロスカット水準 (%)'), 'stopOutLevel')}
      <label>{t('强平方式', 'ロスカット方式')}
        <select value={r.stopOutMode} onChange={(e) => upd({ stopOutMode: e.target.value })}>
          <option value="all">{t('全部平仓（日本式）', '全決済（国内業者式）')}</option>
          <option value="worst">{t('亏损最大者优先', '損失最大から順に')}</option>
        </select>
      </label>
      <label className="chk"><input type="checkbox" checked={r.negativeBalanceProtection} onChange={(e) => upd({ negativeBalanceProtection: e.target.checked })} /> {t('零截断（负余额保护）', 'ゼロカット（追証なし）')}</label>
      <Slider label={t('滑点强度', 'スリッページ強度')} hint={t('0 = 无滑点', '0 = スリッページなし')} value={r.slippage} min={0} max={5} step={0.1} onChange={(v) => upd({ slippage: v })} />
      {numField(t('1 手 = 单位', '1Lot = 通貨数'), 'lotUnits', t('日本常见 10,000；国际标准 100,000', '国内業者は10,000、海外標準は100,000'))}
      {numField(t('最小交易单位', '最小取引単位'), 'minUnits')}
      {numField(t('单笔最大单位', '1注文の最大単位'), 'maxUnitsPerOrder')}
      {err && <div className="order-msg bad">{err}</div>}
    </div>
  );
}

function ClockTab() {
  const t = useT();
  const tick = useS((x) => x.tick);
  if (!tick) return null;
  const c = tick.clock;
  return (
    <div className="settings-grid">
      <Slider label={t('Tick 间隔（毫秒）', 'Tick間隔（ms）')} hint={t('默认 4000，规格范围 3000~5000', '既定4000、仕様範囲3000〜5000')} value={c.tickMs} min={1000} max={8000} step={250} onChange={(v) => api.post('/api/sim', { tickMs: v })} />
      <label>{t('时间倍速', '時間倍率')}<input type="number" defaultValue={c.speed} onBlur={(e) => api.post('/api/sim', { speed: Number(e.target.value) })} /></label>
      <label className="chk"><input type="checkbox" checked={c.autoSkipWeekend} onChange={(e) => api.post('/api/sim', { autoSkipWeekend: e.target.checked })} /> {t('自动跳过周末（含开盘跳空）', '週末を自動スキップ（窓開けあり）')}</label>
    </div>
  );
}

const EMPTY: Partial<AiProfilePublic> & { apiKey?: string } = {
  name: '', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', maxTokens: 4000, timeoutMs: 90000, jsonMode: true,
  priceIn: 0, priceOut: 0, minIntervalMs: 3000, maxRetries: 2, apiKey: '', extraBody: '',
};

const PRESETS: { label: string; v: Partial<AiProfilePublic> }[] = [
  { label: 'OpenAI', v: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', jsonMode: true } },
  { label: 'Anthropic', v: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', jsonMode: false } },
  { label: 'DeepSeek', v: { provider: 'openai', baseUrl: 'https://api.deepseek.com', jsonMode: true } },
  { label: 'Ollama (local)', v: { provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', jsonMode: false } },
];

function AiTab() {
  const t = useT();
  const { profiles, settings } = useS();
  const [form, setForm] = useState<any>(null);
  const [msg, setMsg] = useState('');
  if (!settings) return null;
  const roles = settings.roles;
  const saveProfile = async () => {
    setMsg('');
    try {
      const body = { ...form, maxTokens: Number(form.maxTokens), timeoutMs: Number(form.timeoutMs), priceIn: Number(form.priceIn), priceOut: Number(form.priceOut), minIntervalMs: Number(form.minIntervalMs), maxRetries: Number(form.maxRetries) };
      if (!body.apiKey) delete body.apiKey;
      await api.post('/api/ai/profiles', body);
      setForm(null);
      await refreshSettings();
    } catch (e: any) { setMsg(e.message); }
  };
  const test = async (id: string) => {
    setMsg(t('测试中……', 'テスト中……'));
    try {
      const r = await api.post(`/api/ai/profiles/${id}/test`);
      setMsg(r.ok ? `OK ${r.latencyMs}ms · ${r.tokensIn}/${r.tokensOut} tok · ${r.sample}` : r.error);
    } catch (e: any) { setMsg(`✗ ${e.message}`); }
  };
  const updRole = async (r: AiRole, patch: any) => { await api.post('/api/settings', { roles: { [r]: patch } }); await refreshSettings(); };
  const roleName: Record<AiRole, [string, string]> = {
    news: [t('AI-1 新闻编辑', 'AI-1 ニュース編集'), t('改写经济指标快讯；周期性判断并发布突发新闻（新闻发布即施加有界冲击）', '経済指標速報を執筆、定期的に突発ニュースを判断・配信（配信と同時に有界ショック）')],
    macro: [t('AI-2 市场决策者', 'AI-2 相場決定者'), t('仅在“AI宏观”市场模式下生效：输出各货币倾向/波动率，由数学引擎生成连续行情', '「AIマクロ」モードでのみ有効：各通貨の傾向・ボラを出力し数理エンジンが連続相場を生成')],
    trader: [t('AI-3 自动交易员', 'AI-3 自動トレーダー'), t('读取K线、指标、新闻与账户，经同一风控下单；未配置时使用本地规则策略', 'チャート・指標・ニュース・口座を読み同じリスク管理で発注。未設定時はローカル戦略')],
  };
  return (
    <div className="ai-tab">
      <h4>{t('角色分配', '役割の割り当て')}</h4>
      <div className="roles">
        {(['news', 'macro', 'trader'] as AiRole[]).map((r) => (
          <div key={r} className="role-card">
            <b>{roleName[r][0]}</b>
            <small className="muted">{roleName[r][1]}</small>
            <label className="chk"><input type="checkbox" checked={roles[r].enabled} onChange={(e) => updRole(r, { enabled: e.target.checked })} /> {t('启用', '有効')}</label>
            <select value={roles[r].profileId ?? ''} onChange={(e) => updRole(r, { profileId: e.target.value || null })}>
              <option value="">{t('（未选择 → 离线降级）', '（未選択 → オフライン代替）')}</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
            </select>
            <label>{t('调用间隔(实时秒)', '呼出間隔(実時間秒)')}<input type="number" defaultValue={roles[r].intervalSec} onBlur={(e) => updRole(r, { intervalSec: Number(e.target.value) })} /></label>
            <label>temperature<input type="number" step="0.1" defaultValue={roles[r].temperature} onBlur={(e) => updRole(r, { temperature: Number(e.target.value) })} /></label>
          </div>
        ))}
      </div>
      <h4>{t('模型配置（OpenAI 兼容 / Anthropic）', 'モデル設定（OpenAI互換 / Anthropic）')} <button className="small" onClick={() => setForm({ ...EMPTY })}>+ {t('新增', '追加')}</button></h4>
      <div className="muted small">{t('API Key 使用 AES-256-GCM 加密保存在本机 data 目录，前端只显示掩码。同一模型可以分配给多个角色。', 'APIキーはAES-256-GCMで暗号化してローカルのdataフォルダに保存。画面にはマスク表示のみ。1つのモデルを複数の役割に使えます。')}</div>
      <table className="grid">
        <thead><tr><th>{t('名称', '名前')}</th><th>{t('协议', 'プロトコル')}</th><th>Base URL</th><th>{t('模型', 'モデル')}</th><th>Key</th><th></th></tr></thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.provider}</td><td className="mono">{p.baseUrl}</td><td>{p.model}</td><td className="mono">{p.hasKey ? p.keyHint : '-'}</td>
              <td className="row-actions">
                <button className="small" onClick={() => test(p.id)}>{t('测试', 'テスト')}</button>
                <button className="small" onClick={() => setForm({ ...p, apiKey: '' })}>{t('编辑', '編集')}</button>
                <button className="small btn-danger" onClick={async () => { if (confirm('Delete?')) { await api.del(`/api/ai/profiles/${p.id}`); await refreshSettings(); } }}>✕</button>
              </td></tr>
          ))}
        </tbody>
      </table>
      {msg && <div className="order-msg">{msg}</div>}
      {form && (
        <div className="profile-form">
          <div className="seg small">{PRESETS.map((p) => <button key={p.label} onClick={() => setForm({ ...form, ...p.v, name: form.name || p.label })}>{p.label}</button>)}</div>
          <div className="settings-grid">
            <label>{t('名称', '名前')}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>{t('协议', 'プロトコル')}<select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}><option value="openai">OpenAI compatible</option><option value="anthropic">Anthropic Messages</option></select></label>
            <label>Base URL<input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></label>
            <label>{t('模型名称', 'モデル名')}<input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></label>
            <label>API Key<input type="password" autoComplete="off" placeholder={form.id ? t('留空则保持不变', '空欄なら変更なし') : ''} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></label>
            <label>max_tokens<input type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: e.target.value })} /></label>
            <label>{t('超时(ms)', 'タイムアウト(ms)')}<input type="number" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })} /></label>
            <label>{t('最小调用间隔(ms)', '最小呼出間隔(ms)')}<input type="number" value={form.minIntervalMs} onChange={(e) => setForm({ ...form, minIntervalMs: e.target.value })} /></label>
            <label>{t('重试次数', 'リトライ回数')}<input type="number" value={form.maxRetries} onChange={(e) => setForm({ ...form, maxRetries: e.target.value })} /></label>
            <label>{t('输入价格/百万token', '入力単価/100万tok')}<input type="number" value={form.priceIn} onChange={(e) => setForm({ ...form, priceIn: e.target.value })} /></label>
            <label>{t('输出价格/百万token', '出力単価/100万tok')}<input type="number" value={form.priceOut} onChange={(e) => setForm({ ...form, priceOut: e.target.value })} /></label>
            <label>{t('额外请求参数 (JSON，合并进请求体)', '追加リクエストパラメータ (JSON)')}<textarea className="mono" placeholder='{"some_param": "value"}' value={form.extraBody ?? ''} onChange={(e) => setForm({ ...form, extraBody: e.target.value })} /></label>
            <label className="chk"><input type="checkbox" checked={form.jsonMode} onChange={(e) => setForm({ ...form, jsonMode: e.target.checked })} /> response_format=json_object</label>
          </div>
          <div className="ai-row"><button className="btn-primary" onClick={saveProfile}>{t('保存配置', '保存')}</button><button onClick={() => setForm(null)}>{t('取消', 'キャンセル')}</button></div>
        </div>
      )}
    </div>
  );
}
