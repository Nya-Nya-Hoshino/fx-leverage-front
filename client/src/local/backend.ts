// 离线后端：在 WebView 内运行与服务端完全相同的行情/撮合/AI 运行时，供安卓 App 使用。
import { Runtime } from '../../../server/runtime';
import { createApi, type ApiRequest } from '../../../server/api';
import type { ClientLike, SecretBox } from '../../../server/store';
import type { TF } from '../../../shared/types';
import { MemStore } from './memstore';

/**
 * 应用私有存储中的 API Key 混淆（设备随机密钥异或 + Base64）。
 * 安卓应用数据目录对其他应用不可见；这一层只防止明文直接出现在存储文件中。
 */
class DeviceBox implements SecretBox {
  private key: Uint8Array;
  constructor() {
    let k = localStorage.getItem('fx.devkey');
    if (!k) {
      const b = crypto.getRandomValues(new Uint8Array(32));
      k = btoa(String.fromCharCode(...b));
      localStorage.setItem('fx.devkey', k);
    }
    this.key = Uint8Array.from(atob(k), (c) => c.charCodeAt(0));
  }
  private xor(b: Uint8Array) {
    return b.map((x, i) => x ^ this.key[i % this.key.length]);
  }
  encrypt(plain: string) {
    if (!plain) return '';
    return btoa(String.fromCharCode(...this.xor(new TextEncoder().encode(plain))));
  }
  decrypt(enc: string) {
    if (!enc) return '';
    try { return new TextDecoder().decode(this.xor(Uint8Array.from(atob(enc), (c) => c.charCodeAt(0)))); } catch { return ''; }
  }
}

export interface LocalBackend {
  handle(req: ApiRequest): Promise<[number, unknown]>;
  subscribe(sym: string, tf: TF, since: number): void;
}

export async function startLocal(onMessage: (m: any) => void): Promise<LocalBackend> {
  const store = await MemStore.open();
  const rt = new Runtime(store, new DeviceBox());
  rt.autosaveMs = 10_000; // 移动端可能被系统直接杀掉，缩短自动保存间隔
  const api = createApi(rt, store);
  const client: ClientLike = { readyState: 1, send: (s) => onMessage(JSON.parse(s)) };
  rt.clients.set(client, { sym: 'USDJPY', tf: '1m', lastBarT: Infinity });

  const last = store.getMeta('lastSave');
  if (last && store.loadState(last)) {
    try { await rt.load(last); } catch (e) { console.error('auto load failed', e); }
  }
  // 切到后台或关闭时立即保存
  const persist = () => { try { rt.persist(); } catch (e) { console.error(e); } void store.flush(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
  window.addEventListener('pagehide', persist);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  queueMicrotask(() => onMessage({ type: 'hello', saveId: rt.game?.st.saveId ?? null }));
  return {
    handle: async (req) => {
      const r = await api.handle(req);
      // 玩家操作后约 1 秒内落盘
      if (req.method !== 'GET' && rt.game) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { if (rt.game) rt.persist(); }, 1000);
      }
      return r;
    },
    subscribe: (sym, tf, since) => rt.subscribe(client, sym, tf, since),
  };
}
