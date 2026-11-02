// LLM 客户端：OpenAI 兼容 Chat Completions 与 Anthropic Messages 两种协议。
// 异步调用、超时、指数退避重试、按配置限流、JSON 提取与 Schema 校验、用量统计。
// API Key 只存在于服务端内存，任何错误信息都会先脱敏再返回。
import type { ZodType } from 'zod';

export interface AiProfile {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  jsonMode: boolean;
  priceIn: number;
  priceOut: number;
  minIntervalMs: number;
  maxRetries: number;
  /** 合并进请求体的额外参数（JSON 文本），例如推理深度等服务商特有字段 */
  extraBody?: string;
}

export interface LlmResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export class LlmError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

function redact(s: string, key: string) {
  let out = s;
  if (key && key.length > 4) out = out.split(key).join('***');
  return out.replace(/(sk-|sk-ant-)[A-Za-z0-9_\-]{8,}/g, '$1***').slice(0, 500);
}

function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, '') + path;
}

export type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class LlmClient {
  private last = new Map<string, number>();
  private chains = new Map<string, Promise<unknown>>();

  constructor(private fetchImpl: FetchLike = (u, i) => fetch(u, i) as any) {}

  /** 同一配置串行 + 最小间隔限流 */
  private schedule<T>(profile: AiProfile, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(profile.id) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(async () => {
      const wait = (this.last.get(profile.id) ?? 0) + profile.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.last.set(profile.id, Date.now());
      }
    });
    this.chains.set(profile.id, run);
    return run;
  }

  async chat(profile: AiProfile, system: string, user: string, temperature: number, signal?: AbortSignal): Promise<LlmResult> {
    return this.schedule(profile, async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= profile.maxRetries; attempt++) {
        if (signal?.aborted) throw new LlmError('aborted', false);
        try {
          return await this.once(profile, system, user, temperature, signal);
        } catch (e) {
          lastErr = e;
          if (e instanceof LlmError && !e.retryable) throw e;
          if (attempt < profile.maxRetries) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
        }
      }
      throw lastErr instanceof Error ? lastErr : new LlmError(String(lastErr), false);
    });
  }

  private async once(p: AiProfile, system: string, user: string, temperature: number, outer?: AbortSignal): Promise<LlmResult> {
    if (!p.apiKey && !/localhost|127\.0\.0\.1/.test(p.baseUrl)) throw new LlmError('未配置 API Key', false);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), p.timeoutMs);
    const onAbort = () => ctl.abort();
    outer?.addEventListener('abort', onAbort);
    const t0 = Date.now();
    try {
      let url: string, headers: Record<string, string>, body: any;
      if (p.provider === 'anthropic') {
        url = joinUrl(p.baseUrl, /\/v1$/.test(p.baseUrl.replace(/\/+$/, '')) ? '/messages' : '/v1/messages');
        headers = { 'content-type': 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' };
        body = { model: p.model, max_tokens: p.maxTokens, system, temperature, messages: [{ role: 'user', content: user }] };
      } else {
        url = joinUrl(p.baseUrl, '/chat/completions');
        headers = { 'content-type': 'application/json' };
        if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
        body = {
          model: p.model, temperature, max_tokens: p.maxTokens,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        };
        if (p.jsonMode) body.response_format = { type: 'json_object' };
      }
      if (p.extraBody && p.extraBody.trim()) {
        let extra: unknown;
        try { extra = JSON.parse(p.extraBody); } catch { throw new LlmError('额外请求参数不是合法 JSON', false); }
        if (extra && typeof extra === 'object' && !Array.isArray(extra)) body = { ...body, ...(extra as object) };
      }
      let res;
      try {
        // 原生 HTTP 层（安卓）可能忽略 signal，因此再用定时器兜底
        const aborted = new Promise<never>((_, rej) => ctl.signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true }));
        res = await Promise.race([this.fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal }), aborted]);
      } catch (e: any) {
        throw new LlmError(ctl.signal.aborted ? `请求超时（${p.timeoutMs}ms）` : `网络错误：${redact(String(e?.message ?? e) + (e?.cause ? ` (${e.cause.code ?? e.cause.message ?? e.cause})` : ""), p.apiKey)}`, true);
      }
      const txt = await res.text();
      if (!res.ok) {
        const retry = res.status === 429 || res.status >= 500;
        throw new LlmError(`HTTP ${res.status}: ${redact(txt, p.apiKey)}`, retry);
      }
      let j: any;
      try { j = JSON.parse(txt); } catch { throw new LlmError('响应不是合法 JSON', true); }
      let text = '';
      let tin = 0, tout = 0;
      if (p.provider === 'anthropic') {
        text = (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        tin = j.usage?.input_tokens ?? 0;
        tout = j.usage?.output_tokens ?? 0;
      } else {
        text = j.choices?.[0]?.message?.content ?? '';
        tin = j.usage?.prompt_tokens ?? 0;
        tout = j.usage?.completion_tokens ?? 0;
      }
      if (!text) throw new LlmError('模型返回空内容', true);
      return { text, tokensIn: tin, tokensOut: tout, latencyMs: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
  }
}

/** 从模型输出中提取第一个完整 JSON 对象 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf('{');
  if (start < 0) throw new Error('输出中没有 JSON 对象');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(src.slice(start, i + 1));
    }
  }
  throw new Error('JSON 对象不完整');
}

export interface JsonCallResult<T> {
  data: T;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  attempts: number;
}

/** 调用并按 Schema 校验；校验失败时把错误反馈给模型再试一次 */
export async function callJson<T>(
  client: LlmClient, profile: AiProfile, system: string, user: string, schema: ZodType<T>, temperature: number, signal?: AbortSignal,
): Promise<JsonCallResult<T>> {
  let tin = 0, tout = 0, lat = 0;
  let prompt = user;
  let lastErr = '';
  for (let i = 0; i < 2; i++) {
    const r = await client.chat(profile, system, prompt, temperature, signal);
    tin += r.tokensIn; tout += r.tokensOut; lat += r.latencyMs;
    try {
      const raw = extractJson(r.text);
      const parsed = schema.safeParse(raw);
      if (parsed.success) return { data: parsed.data, tokensIn: tin, tokensOut: tout, latencyMs: lat, attempts: i + 1 };
      lastErr = parsed.error.issues.slice(0, 5).map((x) => `${x.path.join('.')}: ${x.message}`).join('; ');
    } catch (e: any) {
      lastErr = String(e?.message ?? e);
    }
    prompt = `${user}\n\n上一次输出未通过校验：${lastErr}\n请只输出一个符合要求的 JSON 对象。`;
  }
  const err = new LlmError(`JSON 校验失败：${lastErr}`, false) as LlmError & { usage?: { tin: number; tout: number } };
  err.usage = { tin, tout };
  throw err;
}
