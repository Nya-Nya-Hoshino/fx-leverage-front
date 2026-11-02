// 服务端启动：HTTP + WebSocket。命令行（server/index.ts）与桌面版 Electron 主进程共用。
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { TFS } from '../shared/types';
import { Db } from './db';
import { KeyStore } from './keystore';
import { Runtime } from './runtime';
import { createApi } from './api';
import { LlmClient, type FetchLike } from './ai/llm';

export interface ServerOptions {
  dataDir: string;
  distDir: string | null;
  port: number;            // 0 = 随机可用端口
  host: string;
  aiConfigFile?: string;   // 可选：config/ai.local.json
  fetchImpl?: FetchLike;   // 桌面版传入 Electron net.fetch（遵循系统代理）
  log?: (msg: string) => void;
  demo?: boolean;          // 录制演示用的调试接口
}

export interface RunningServer {
  url: string;
  port: number;
  server: Server;
  runtime: Runtime;
  shutdown(): void;
}

export function importAiConfig(rt: Runtime, db: Db, file: string, log: (m: string) => void) {
  if (!existsSync(file)) return;
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    const names = new Set(db.listProfiles().map((p) => p.name));
    for (const p of cfg.profiles ?? []) {
      if (names.has(p.name)) continue;
      rt.saveProfile({
        name: p.name, provider: p.provider ?? 'openai', baseUrl: p.baseUrl, apiKey: p.apiKey ?? '', model: p.model,
        maxTokens: p.maxTokens ?? 4000, timeoutMs: p.timeoutMs ?? 90000, jsonMode: p.jsonMode ?? true,
        priceIn: p.priceIn ?? 0, priceOut: p.priceOut ?? 0, minIntervalMs: p.minIntervalMs ?? 3000, maxRetries: p.maxRetries ?? 2,
        extraBody: p.extraBody ? JSON.stringify(p.extraBody) : '',
      });
      log(`[ai] 已从 ${file} 导入配置：${p.name}`);
    }
  } catch (e) {
    log(`[ai] 读取 ${file} 失败：${(e as Error).message}`);
  }
}

export function startServer(o: ServerOptions): Promise<RunningServer> {
  const log = o.log ?? ((m: string) => console.log(m));
  mkdirSync(o.dataDir, { recursive: true });
  const db = new Db(join(o.dataDir, 'fxsim.db'));
  const keys = new KeyStore(join(o.dataDir, '.secret.key'));
  const rt = new Runtime(db, keys, new LlmClient(o.fetchImpl));
  if (o.aiConfigFile) importAiConfig(rt, db, o.aiConfigFile, log);
  const api = createApi(rt, db, { demo: o.demo });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.all(/^\/api\//, async (req, res) => {
    const [status, body] = await api.handle({
      method: req.method, path: req.path, query: req.query as Record<string, string>, body: req.body,
      saveId: req.header('x-save-id') ?? null,
    });
    res.status(status).json(body);
  });
  if (o.distDir && existsSync(o.distDir)) {
    app.use(express.static(o.distDir));
    app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(join(o.distDir!, 'index.html')));
  }

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    rt.clients.set(ws, { sym: 'USDJPY', tf: '1m', lastBarT: Infinity });
    ws.send(JSON.stringify({ type: 'hello', saveId: rt.game?.st.saveId ?? null }));
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (m.type === 'sub' && typeof m.sym === 'string' && TFS.includes(m.tf)) {
          if (m.saveId && rt.game && m.saveId !== rt.game.st.saveId) return;
          rt.subscribe(ws, m.sym, m.tf, Number(m.since) || 0);
        }
      } catch { /* ignore */ }
    });
    ws.on('close', () => rt.clients.delete(ws));
  });

  let closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    try { rt.shutdown(); } catch (e) { log(String(e)); }
    try { db.close(); } catch { /* ignore */ }
    server.close();
  };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host, async () => {
      const port = (server.address() as AddressInfo).port;
      const url = `http://${o.host === '0.0.0.0' ? '127.0.0.1' : o.host}:${port}`;
      const last = db.getMeta('lastSave');
      if (last && db.loadState(last)) {
        try { await rt.load(last); log(`  已自动载入上次存档：${rt.game?.st.name}`); } catch (e) { log(`自动载入失败 ${e}`); }
      }
      resolve({ url, port, server, runtime: rt, shutdown });
    });
  });
}
