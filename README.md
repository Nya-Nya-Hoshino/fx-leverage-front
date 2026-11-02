# 杠杆战线 FX Leverage Front

一款全架空、多 AI 驱动的外汇保证金交易（FX）模拟游戏：Bid/Ask 双向报价、最高 3000 倍（可自定义更高）杠杆、浮动盈亏、追证与强平、负余额、借贷与破产。

> ⚠️ 所有行情、新闻、经济数据均为虚拟生成，不连接任何真实交易所，不涉及真实资金。

- 下载（Windows 安装版 / 免安装 ZIP / Android APK）：[Releases](https://github.com/Nya-Nya-Hoshino/fx-leverage-front/releases/latest)
- 网站与网页版：[fx-leverage-front-site](https://github.com/Nya-Nya-Hoshino/fx-leverage-front-site)（GitHub Pages，`play/` 为浏览器内可玩版本）
- 灵感来自漫画《FX戦士くるみちゃん》，与原作无关；不含任何原作素材。

## 一键启动

| 系统 | 方式 |
|---|---|
| Windows | 双击 `start.bat`（首次会自动 `npm install` 和构建前端），浏览器打开 http://127.0.0.1:8787 |
| macOS / Linux | `sh start.sh` |

手动方式：

```bash
npm install
npm run build
npm start
```

开发模式（前端热更新，访问 http://127.0.0.1:5173）：

```bash
npm run dev
```

环境要求：Node.js（需要内置 `node:sqlite` 模块；本项目在 **Node v26.13.0** 上验证）。无需任何原生编译依赖。

`npm start` 通过 `scripts/serve.mjs` 启动服务，并设置 `NODE_USE_ENV_PROXY=1`，使 Node 内置 fetch 遵循 `HTTPS_PROXY` / `NO_PROXY` 环境变量（需要代理访问 AI API 的网络环境下必需）。

## 桌面版 / 安卓版

| 产物 | 位置 | 说明 |
|---|---|---|
| Windows 安装包 | `release/FX-Leverage-Front-Setup-<版本>.exe` | 可选安装目录，创建桌面快捷方式 |
| Windows 免安装版 | `release/FX-Leverage-Front-Portable-<版本>.exe` | 单文件，双击即玩 |
| 安卓横屏 App | `release/FX-Leverage-Front-<版本>-debug.apk` | 安卓 7.0+，锁定横屏、全屏沉浸、屏幕常亮 |

**桌面版（Electron）**：主进程内运行与 `npm start` 完全相同的服务端（SQLite 存档），存档位于 `%APPDATA%\FX Leverage Front\data`。AI 请求走 Chromium 网络栈，自动使用系统代理。F11 全屏，F12 开发者工具。也可以把 `ai.local.json` 放进该 data 目录，启动时自动导入 AI 配置。

```bash
npm run dist:desktop     # 生成安装包 + 免安装版到 release/
```

**安卓版（Capacitor）**：手机上没有 Node，所以整个游戏引擎（行情、撮合、风控、借贷、AI 调度）直接运行在 WebView 内，完全离线可玩；存档保存在应用私有的 IndexedDB 中（操作后约 1 秒、每 10 秒、切到后台时自动保存）。AI 请求通过 Capacitor 原生 HTTP 发出（不受浏览器 CORS 限制）。手机横屏（屏高 ≤ 560px）时界面自动切换为精简布局：上方工具栏、左侧图表/行情/交易/新闻/资产视图、右侧下单栏、底部导航。

```bash
# 需要 JDK 21 与 Android SDK（platforms;android-36）
set JAVA_HOME=...\jdk-21
set ANDROID_HOME=...\android-sdk
npm run dist:android                 # debug APK（可直接侧载安装）
npm run dist:android -- --release    # release APK（需在 android/app/build.gradle 中配置签名）
npm run preview:mobile               # 在浏览器中预览安卓离线版（http://127.0.0.1:4174，可用开发者工具切换为手机横屏尺寸）
```

## 演示存档 / 测试

```bash
npm run demo        # 生成「演示存档 Demo」：1000 倍 JPY 账户，含持仓、挂单、贷款和本地 AI 交易员记录
npm test            # 49 项自动化测试
npm run typecheck   # TypeScript 类型检查
npm run mock-llm    # 启动本地模拟 LLM（OpenAI 兼容，http://127.0.0.1:8790/v1），无需真实 Key 即可体验三个 AI 角色
```

## 玩法速览

1. 首次进入开立模拟账户：用户名、本位币（JPY ¥250,000 / CNY ¥12,000）、账户最高杠杆（1/25/100/500/1000/3000 或自定义架空倍率）、市场模式。
2. 左侧汇率看板选择货币对；中间 K 线（15s～1d，MA/布林带/RSI/MACD，水平线/趋势线，新手提示）；右侧 BUY/SELL 速攻下单。
3. 顶栏控制时间：暂停 / 1x～3600x 加速；周末休市可自动或手动跳过（开盘有跳空）。
4. 底部标签：持仓（平仓、部分平仓、修改止盈止损/追踪止损、加仓）、挂单、成交记录、AI 交易员、经济日历、宏观/掉期表、借贷、资产曲线、AI 日志。
5. 维持率 ≤100% 追证警告，≤50% 强制平仓（阈值可配置）。跳空可能导致余额为负——你欠券商钱了。
6. 可以向虚拟银行借款（累计本金上限 1000 万日元，CNY 账户按游戏内汇率换算），逾期 1.5 倍罚息，超过宽限期违约即破产。
7. 「手动交易 / AI 自动交易」与「随机市场 / AI 宏观」可随时切换，共享同一个市场引擎。

## 架构

```
shared/            前后端共享：类型、货币与货币对定义、技术指标
server/
  core/rng.ts        可序列化的带种子随机数（sfc32）
  core/clock.ts      模拟时钟、交易时段、周末休市、换日
  core/market.ts     数学行情引擎（货币强弱因子模型）
  core/candles.ts    K 线聚合（所有周期由同一 Bid 序列逐 Tick 更新）
  core/economy.ts    经济状态、经济日历、数据公布、突发事件、本地新闻模板
  core/account.ts    账户结算：盈亏、保证金、净值、维持率、掉期
  core/execution.ts  订单执行/撮合：市价、限价、止损单、止盈止损、追踪止损、部分平仓、滑点
  core/risk.ts       风控：追证、强平、负余额/零截断
  core/loans.ts      借贷：借款、计息、先息后本还款、逾期、违约
  core/game.ts       主循环（子步：事件 → 价格 → 报价 → K线 → 掉期/利息 → 触发单 → 风控）
  ai/llm.ts          OpenAI 兼容 / Anthropic 客户端：超时、重试、限流、JSON 提取、Schema 校验
  ai/schemas.ts      三个 AI 角色的 zod Schema
  ai/agents.ts       提示词构建、AI 输出 → 引擎指令（有界）、交易执行器
  ai/localTrader.ts  本地规则交易员（离线降级）
  db.ts              SQLite（node:sqlite）存档、K线、AI 配置
  keystore.ts        API Key 的 AES-256-GCM 本地加密
  runtime.ts         运行时：Tick 定时器、AI 调度、自动保存、WebSocket 推送
  index.ts           HTTP API + WebSocket
client/            React + TypeScript + lightweight-charts 前端
tests/             vitest 自动化测试
```

### 行情引擎

- 每种货币一个对数强弱因子 `x_c`，货币对中间价 = `exp(s_base − s_quote)`，**交叉汇率天然满足三角一致性**。
- 因子演化 = 随机趋势(OU) + 宏观漂移 + 均值回归 + 风险情绪共同因子（日元/瑞郎避险、澳纽加风险偏好）+ 欧洲区块因子 + GARCH 式波动聚集 + 亚/欧/美时段波动 + 市场状态（常态/趋势/震荡/恐慌/低流动性/闪崩）+ 冲击队列 + 泊松跳跃。
- 港元强挂钩美元，人民币/新元/台币/韩元部分挂钩。
- 默认每 4 秒（实时）一个 Tick；加速时按子步推进，止损、强平都在子步内判定，因此跳空会以更差价格成交。
- 点差 = 基础点差 × 时段流动性 × 市场状态 × 新闻冲击 × 周末开盘扩大。
- 行情随机数与成交（滑点）随机数分离：**玩家的下单行为不会改变行情路径**。
- 成交量为模拟 Tick Volume（界面已标注）。

### 两种市场模式

- **纯随机市场**：本地状态机切换市场状态，本地宏观生成器周期性给出各货币倾向。可调波动率、趋势强度、均值回归、跳跃频率、黑天鹅概率、跳空、点差、新闻冲击。
- **AI 宏观市场**：AI-2 周期性输出结构化 JSON（市场状态、风险情绪、各货币 bias/volatility、期限），引擎将其作为概率倾向（叠加 0.3～1.3 倍随机兑现、12% 完全不兑现）。AI-2 的输入中**没有任何持仓信息**。AI 失败或过期时本地引擎自动接管。

### 三个 AI 角色

| 角色 | 职责 | 离线降级 |
|---|---|---|
| AI-1 新闻编辑 | 指标公布时改写快讯；周期性判断并发布突发新闻（发布同时由引擎施加**有界**冲击，新闻是行情的原因而非事后解释） | 本地新闻模板 + 本地突发事件生成器 |
| AI-2 市场决策者 | 读取经济状态与新闻，输出宏观倾向与波动参数 | 本地宏观生成器 |
| AI-3 自动交易员 | 读取 K 线、指标、新闻、账户与持仓，输出开/平/改单决策；全部经 `Game.order()` 与玩家相同的保证金检查、点差、滑点、强平 | 本地规则策略（趋势/均值回归/突破/马丁赌徒） |

AI 配置：设置 → AI 智能体。支持 OpenAI 兼容接口（OpenAI、DeepSeek、Ollama、各类中转等）与 Anthropic Messages 协议；同一模型可分配给多个角色。也可以复制 `config/ai.example.json` 为 `config/ai.local.json`，服务启动时自动导入。API Key 以 AES-256-GCM 加密存于 `data/`，前端只显示掩码，错误信息会脱敏。

推理（思考）型模型的输出 token 包含思考过程，默认 `max_tokens` 为 4000、超时 90 秒。实测 DeepSeek `deepseek-flash`（默认思考深度 high）：AI-2 宏观约 8 秒 / 1.2k 输出 token，AI-1 新闻约 3～5 秒，AI-3 交易员约 22 秒 / 3.9k 输出 token。如需调整服务商特有参数（例如思考深度），在模型配置的「额外请求参数」中填写 JSON 对象，它会原样合并进请求体；参数名请以服务商文档为准。

### 交易计算

- 多头以 Ask 开仓、按 Bid 平仓；空头以 Bid 开仓、按 Ask 平仓。
- 盈亏（报价货币）按中间价换算为账户本位币；CNY 账户使用 CNH 汇率。
- 保证金 = 本位币名义金额 ÷ 账户最高杠杆；净值 = 余额 + 未实现盈亏（含掉期）；维持率 = 净值 ÷ 已用保证金 × 100%。
- 掉期 = 名义 × (基础货币利率 − 报价货币利率 ∓ 0.5% 业者加点) / 365，UTC 21:00 换日，周三 3 倍；利率随央行决议变化。
- 个人净资产 = 交易账户净值 − 贷款本息。

### 存档

SQLite 数据库 `data/fxsim.db`：存档状态（行情因子、随机数生成器状态、模拟时钟、经济日历、账户、持仓、挂单、贷款、成交、新闻、AI 配置与调度累计）+ 每个周期最近 3000 根 K 线。每 30 秒自动保存，切换存档/退出前也会保存。所有修改类请求必须携带当前存档 ID（`x-save-id`），存档切换后旧请求和迟到的 AI 结果都会被拒绝，防止串号。测试验证了「保存 → 恢复 → 继续运行」与不中断运行逐 Tick 完全一致。

## 测试覆盖

`tests/market.test.ts`、`tests/trading.test.ts`、`tests/persistence-ai.test.ts`：交叉汇率一致性、肥尾与连续性、K 线聚合、时段/周末/换日、跳空、多空结算、跨币种换算、CNY 账户、保证金/维持率、3000 倍杠杆、强平（全部/最差优先）、负余额与零截断、限价/止损单、跳空穿越止损、止盈、追踪止损、掉期、借贷上限/计息/还款/逾期/违约、破产、存档确定性恢复、SQLite 多存档隔离、API Key 加密、AI 重试/超时/脱敏/Schema 校验/Anthropic 协议、AI 失败降级、AI 订单风控。

## 配置项

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `FXSIM_PORT` | 8787 | 服务端口 |
| `FXSIM_HOST` | 127.0.0.1 | 监听地址 |
| `FXSIM_DATA` | `./data` | 数据目录 |
| `MOCK_LLM_PORT` | 8790 | 模拟 LLM 端口 |
