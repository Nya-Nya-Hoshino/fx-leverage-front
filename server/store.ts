// 持久化接口：桌面/服务端使用 SQLite（db.ts），安卓离线版使用浏览器 IndexedDB（client/src/local/memstore.ts）。
import type { Candle, SaveListItem, TF } from '../shared/types';
import type { GameState } from './core/state';

export interface ProfileRow {
  id: string; name: string; provider: 'openai' | 'anthropic'; base_url: string; api_key_enc: string; model: string;
  max_tokens: number; timeout_ms: number; json_mode: number; price_in: number; price_out: number;
  min_interval_ms: number; max_retries: number; extra_json: string;
}

export type ClosedBar = { sym: string; tf: TF; c: Candle };

export interface GameStore {
  listSaves(): SaveListItem[];
  loadState(id: string): GameState | null;
  writeSave(st: GameState, summary: { equity: number; netWorth: number; status: string }, bars: ClosedBar[], trimBefore: { sym: string; tf: TF; t: number }[]): void;
  loadCandles(id: string): ClosedBar[] | Promise<ClosedBar[]>;
  deleteSave(id: string): void;
  getMeta(k: string): string | null;
  setMeta(k: string, v: string): void;
  listProfiles(): ProfileRow[];
  upsertProfile(p: ProfileRow): void;
  deleteProfile(id: string): void;
}

/** API Key 加解密 */
export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(enc: string): string;
}

export function keyHint(plain: string): string {
  if (!plain) return '';
  return plain.length <= 8 ? '****' : `${plain.slice(0, 3)}****${plain.slice(-4)}`;
}

/** WebSocket 或安卓内置传输的最小接口 */
export interface ClientLike {
  readyState: number;
  send(data: string): void;
}
