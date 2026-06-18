# AI 交易教练（AI Habit Advisor）设计 v1.0

> 状态：已批准 v1.0（2026-06-18）
> 目的：在盲训工作台新增第 4 个模块"AI 交易教练"，解析用户训练记录，输出结构化的交易习惯诊断报告
> 范围：盲训子系统（macOS Electron App）
> 关联：[docs/behavior-event-design.md](../../behavior-event-design.md)（`behavior_event` 表是 v2 依赖，本 spec 不依赖）

---

## 0. 决策汇总

| 维度 | 选择 |
| --- | --- |
| Agent 内核 | 云端 LLM（智谱 GLM-4.7，Anthropic messages 兼容格式） |
| 交互形态 | 一次性报告卡（不支持多轮对话） |
| LLM 输入 | 当前 profile 的 8 个习惯指标 + Top-3 代表性会话（含股票代码） |
| 计算分工 | 本地预先算指标（永远可看）→ LLM 做自然语言点评（按需触发） |
| LLM 配置 | 设置页可填 endpoint / apiKey / model，存 `app_preferences` |
| 历史对比 | 做。每次"生成诊断"写一行 `habits_profile`，UI 展示趋势 |
| 股票代码 | 已结束的 session（`status='finished'`）允许向 LLM 发送代码与名称 |

---

## 1. 架构

四层，每层单一职责，可独立测试。

```
┌─ UI 层 ────────────────────────────────────────────────┐
│ App.tsx 新增第 4 个 AppModule 'agent'                   │
│ → components/trading/AIHabitAdvisor.tsx                  │
└─────────────────────────────────────────────────────────┘
                       ↓ 调用
┌─ 服务层 ───────────────────────────────────────────────┐
│ main/services/habit-analyzer.ts  本地算 8 个习惯指标     │
│ main/services/ai-advisor.ts      拼 prompt + 调 LLM      │
└─────────────────────────────────────────────────────────┘
                       ↓ 读写
┌─ 数据层 ───────────────────────────────────────────────┐
│ blindDb.ts: 新增 habits_profile / ai_reports 两张表     │
└─────────────────────────────────────────────────────────┘
                       ↓ IPC
┌─ 桥接层 ───────────────────────────────────────────────┐
│ preload: electronAPI.agent.*                            │
│ ipc/blind.ts: agent:* 一组 IPC handler                  │
└─────────────────────────────────────────────────────────┘
```

**分层理由**：
- 本地指标（`habit-analyzer`）与 LLM 调用（`ai-advisor`）解耦 → 没 key / 没网时本地指标仍可看
- 指标算法是纯函数，可单元测试，不依赖 IPC / DB / 网络
- LLM 调用可独立 mock，验证 prompt 拼接与 JSON 解析

---

## 2. 本地习惯指标（MVP 8 个）

### 2.1 指标清单

| # | 名称 | 类型 | 算法（输入：`trade_actions` + `session_reviews`） |
| --- | --- | --- | --- |
| 1 | **追涨率** (chase_high_rate) | 入场 | 统计每笔 buy 的 `price` 相对于其前 N=5 根（同 session）的 max(close) 的偏离比例；当偏离 ≥ 3% 计为追高。`chase_high_rate = 追高买入笔数 / 总买入笔数` |
| 2 | **倒金字塔加仓** (inverse_pyramid_rate) | 入场 | 对每个 session 内的多笔 buy（按 `bar_index` 升序），若后续 buy 的 `price` 高于首笔 buy，计为倒金字塔。`inverse_pyramid_rate = 倒金字塔加仓 session 数 / 有多笔 buy 的 session 数` |
| 3 | **止损纪律** (stop_loss_discipline) | 出场 | 对每笔 buy 后浮亏 ≥ `stop_loss_threshold`（默认 -7%，可在偏好里调）的情况，统计是否在亏损达到阈值后的 5 根 bar 内 sell。`stop_loss_discipline = 实际止损笔数 / 应止损笔数`（无 sell 的视为未执行） |
| 4 | **盈亏比** (profit_loss_ratio) | 出场 | `avg(盈利单 realized_pnl) / abs(avg(亏损单 realized_pnl))`。直接从 `trade_actions` 按 `realized_pnl` 符号聚合 |
| 5 | **止盈过早/过晚** (profit_taking_timing) | 出场 | 对比盈利单平均持仓 bars 与亏损单平均持仓 bars 的比值。`> 1.3` 为"拿得住盈利"，`< 0.8` 为"赚一点就跑" |
| 6 | **持仓节奏** (avg_holding_bars) | 节奏 | 所有已平仓交易的平均持仓 bar 数，直接读 `session_reviews.avg_holding_bars` 加权平均 |
| 7 | **单笔仓位占比** (avg_position_ratio) | 风控 | 每笔 buy 的 `amount / 当时的 current_capital`，取中位数。current_capital 用 session 的 `initial_capital` + 已实现盈亏累计 |
| 8 | **结果组** (result_group) | 结果 | 复合字段：`win_rate` / `avg_pnl_pct` / `max_drawdown_pct` / `max_loss_streak`（连损场次）。前三个直接读 `session_reviews`，连损场次在 `training_sessions` 按 `started_at` 排序后用 SQL 窗口算 |

### 2.2 计算实现

```typescript
// main/services/habit-analyzer.ts
export interface HabitIndicators {
  chase_high_rate: number         // 0..1
  inverse_pyramid_rate: number    // 0..1
  stop_loss_discipline: number    // 0..1
  profit_loss_ratio: number       // > 0
  profit_taking_timing: number    // 比值
  avg_holding_bars: number
  avg_position_ratio: number      // 0..1
  result_group: {
    win_rate: number
    avg_pnl_pct: number
    max_drawdown_pct: number
    max_loss_streak: number
  }
}

export interface HabitProfile {
  profile_id: string
  computed_at: number             // 秒
  session_count: number
  indicators: HabitIndicators
}
```

**核心函数**：

```typescript
// 纯函数，输入 trade_actions 数组 + session_reviews 数组，输出指标
export function computeHabitIndicators(
  actions: TradeActionRow[],
  reviews: SessionReviewRow[],
  sessions: SessionRow[],
  config?: { lookbackBars?: number; chaseHighThreshold?: number; stopLossThreshold?: number }
): HabitIndicators
```

**为什么纯函数**：脱离 DB / IPC 即可单元测试；mock 一组 actions 就能验证追涨率算法是否正确。

### 2.3 K 线依赖

指标 1（追涨率）、指标 3（止损纪律）需要知道每根 bar 的价格。**约束**：盲训只用 `kline_daily`（参见 [AGENTS.md §2.1](../../../AGENTS.md)），`trade_actions.price` 已经记录了成交价，但"前 5 根高点"需要 join `kline_daily`。

**关键挑战**：盲训训练中存在 mask（股价/板块被遮蔽），且 `bar_index` 与 `kline_daily` 行号不一定严格对齐（取决于 session 起点选取）。因此**不能用 OFFSET 反查第 N 根 K 线**，而应：

1. 先从 `training_sessions` 拿到 session 的样本起点（需要 `samples` 表或 `started_at` 反推）
2. 按 session 起点日期 + `bar_index` 反推该笔交易对应的 `trade_date` 窗口
3. 用日期窗口（`trade_date BETWEEN start_date AND end_date`）join `kline_daily`

参考实现思路（伪代码，具体 SQL 在实现阶段决定）：

```typescript
// 在 habit-analyzer.ts 内
function getBuyBarPrices(actions: TradeActionRow[], sessions: SessionRow[]): Map<sessionId_barIndex, {prevHigh: number, prevLow: number}> {
  // 1. 对每个 session，查 kline_daily 取其训练区间内的 OHLC
  // 2. 按 bar_index 映射到 K 线行
  // 3. 对每笔 buy，取其 bar_index 前 N=5 根的 max(close) 作为 prev_high
}
```

> 实现时如果 session 起点信息缺失（`samples` 表未持久化起点），可降级为：直接用 `trade_actions.price` 序列的局部 max（前 5 笔 buy 的最高价），牺牲精度但保证可算。降级路径需在代码注释中标明。

---

## 3. 数据库新增

在 `blindDb.ts` 的 `initBlindTables` 内追加（带 IF NOT EXISTS，幂等）：

```sql
CREATE TABLE IF NOT EXISTS habits_profile (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  session_count INTEGER NOT NULL,
  indicators_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (profile_id) REFERENCES training_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_habits_profile_pid_time ON habits_profile(profile_id, computed_at DESC);

CREATE TABLE IF NOT EXISTS ai_reports (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  habit_profile_id TEXT NOT NULL,
  report_json TEXT NOT NULL,
  raw_response TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  duration_ms INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (profile_id) REFERENCES training_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (habit_profile_id) REFERENCES habits_profile(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_reports_pid_time ON ai_reports(profile_id, created_at DESC);
```

**字段说明**：
- `habits_profile.indicators_json`：完整 `HabitIndicators` JSON，历史对比就靠它
- `ai_reports.habit_profile_id`：报告基于哪次指标快照，**同 `habit_profile_id` 二次打开页面直接读缓存**，不重跑 LLM
- `ai_reports.raw_response`：LLM 原始返回（含 reasoning text），便于排查解析失败
- `ai_reports.error`：失败也存一行，UI 显示"上次失败原因"，重试按钮才覆盖

**迁移**：用现有 `initBlindTables` 的 `CREATE TABLE IF NOT EXISTS` 模式即可，无需 `ALTER TABLE`。

---

## 4. LLM 调用（ai-advisor）

### 4.1 配置读取

复用 `src/main/index.ts:82-90` 已有的 `aichat:getDefaultConfig` 逻辑，但**优先级反转**：

```
读取顺序：
1. app_preferences.ai_advisor_config（设置页存的）
2. 环境变量 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL
3. 内置默认 DEFAULT_AI_ENDPOINT + 'glm-4.7'
```

预加载检查函数 `getAiAdvisorConfig()` 返回 `{ endpoint, apiKey, model, ready: boolean }`。

### 4.2 Prompt 拼接

```typescript
// main/services/ai-advisor.ts
export interface AdvisorPromptPayload {
  profile: HabitProfile
  representativeSessions: RepresentativeSession[]   // Top-3
}

export interface RepresentativeSession {
  stock_code: string
  stock_name: string
  interval_type: string
  realized_pnl_pct: number
  total_trades: number
  trade_win_rate: number
  actions: Array<{                          // 只发动作，不发原始 K 线
    bar_index: number
    action_type: 'buy' | 'sell' | 'hold' | 'skip'
    price?: number
    shares?: number
    realized_pnl?: number
  }>
}
```

**Top-3 选择规则**：1 场最大盈利 + 2 场最大亏损（按 `realized_pnl_pct`），让 LLM 同时讲好案例与坏案例。

**系统提示（固化）**：

```
你是一位资深 A 股交易教练，专门帮助散户改进交易习惯。
你将收到用户的盲训统计数据（基于真实历史 K 线的模拟盘训练，盲训中股价与板块信息被遮蔽）。
你的任务是基于这些指标与代表性交易记录，识别用户的交易优缺点与不良习惯，
给出具体可执行的改善建议。

请严格输出 JSON，结构如下：
{
  "strengths": [
    {"indicator": "盈亏比", "value": "1.8", "evidence": "优于 1.5 的健康线", "comment": "..."}
  ],
  "weaknesses": [
    {"indicator": "追涨率", "value": "42%", "evidence": "高于 30% 健康线", "comment": "..."}
  ],
  "bad_habits": [
    {
      "name": "突破即追入",
      "severity": "high | medium | low",
      "trigger": "看到突破信号立即追入，未等回踩",
      "evidence_session": "中远海控（如有代码则引用）",
      "fix": "等回踩 ±2% 或量能确认后再入"
    }
  ],
  "action_plan": [
    {"priority": 1, "action": "...", "rationale": "...", "expected_impact": "..."}
  ]
}
不要输出 JSON 以外的内容。
```

**用户提示**（注入 payload）：

```
[JSON.stringify(AdvisorPromptPayload)]
```

### 4.3 调用与解析

- **endpoint**：Anthropic messages 兼容（`POST {endpoint}` with `x-api-key` / `anthropic-version` header），与现有 `aichat:getDefaultConfig` 指向智谱的方式一致
- **超时**：30 秒
- **流式**：v1 不做，一次性返回（报告卡场景足够）
- **JSON 解析**：
  1. 尝试直接 `JSON.parse(content)`
  2. 失败则正则提取 `{...}`（处理 LLM 偶尔包裹 markdown 代码块的情况）
  3. 仍失败 → 降级为"原始文本报告"，`report_json = { fallback_text: content }`，`error = 'json_parse_failed'`

### 4.4 隐私护栏（最终版）

**发送**：
- 8 个习惯指标（比例、比值、bars 数）
- Top-3 代表性 session 的：股票代码、股票名称、动作序列（bar_index / action_type / price / shares / realized_pnl）
- session 级统计（胜率、盈亏%）

**不发送**：
- 原始 K 线 OHLC 数据
- 初始资金绝对值（只发比例与盈亏%）
- 用户机器信息、profile 名（profile_id 用 hash 后的别名）
- 任何未结束（`status != 'finished'`）的 session

**风险提示**：用户首次配置 API key 时弹一次确认："AI 教练将向 [endpoint] 发送你的脱敏训练记录（含已结束 session 的股票代码与动作序列）。确认继续？"

---

## 5. UI 页面

### 5.1 模块挂载

`App.tsx`：

```typescript
type AppModule = 'overview' | 'blind' | 'data' | 'agent'   // 新增 agent

MODULE_GROUPS '人的训练' 分组下追加：
{
  id: 'agent',
  label: 'AI 交易教练',
  category: '习惯诊断',
  summary: '解析训练记录，识别交易优缺点与不良习惯，给出改善计划。',
  outcome: '把统计指标变成可执行的实战改进清单。',
  focus: ['习惯指标', 'AI 诊断', '改善计划']
}
```

### 5.2 页面结构

`components/trading/AIHabitAdvisor.tsx`：

```
┌─ AI 交易教练 ─────────────────────────────────────────┐
│ [趋势：追涨率 ▼8% 胜率 ▲3% 盈亏比 ▲0.2（vs 上次）]    │
│ [生成诊断] [重新生成]                                  │
│                                                        │
│ ┌─ 习惯指标（本地，永远可看）──────────────────────┐ │
│ │ 8 个数字卡 + 雷达图（追涨率/止损/盈亏比/节奏/…）  │ │
│ │ 每张卡右上角：与上次对比箭头（▲▼）                │ │
│ └─────────────────────────────────────────────────┘ │
│                                                        │
│ ┌─ AI 诊断报告（云端，需配置 + 联网）──────────────┐ │
│ │ [报告生成于 2026-06-18 14:23 · glm-4.7 · 4.2k tok]│
│ │                                                    │
│ │ ✅ 优点                                             │
│ │   · 盈亏比 1.8 — 优于 1.5 健康线                   │
│ │   · 止损纪律 78% — 在该水平算自律                  │
│ │                                                    │
│ │ ⚠️ 缺点                                             │
│ │   · 追涨率 42% — 高于健康线 30%                    │
│ │                                                    │
│ │ 🎯 改善计划（优先级排序）                          │
│ │   1. 等回踩 ±2% 再入 — 避免追在最高 5%            │
│ │   2. 单笔仓位 ≤ 20% — 当前中位数 35%              │
│ │                                                    │
│ │ [报告完整 JSON 折叠展示]                           │
│ └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

**状态分支**：
- 未配置 API key → 顶部红条 + "去设置"按钮，本地指标区域仍渲染
- 数据不足（profile session 数 < 3）→ 整页空状态"先训练至少 3 场再来诊断"
- 加载中 → 报告区骨架屏 + 进度文案"正在分析你的 28 场训练…"
- 失败 → 错误卡片 + 重试按钮，**不丢本地指标**

### 5.3 设置页配置入口

AI 助手配置独立成小组件 `components/trading/blind-workbench/AiAdvisorSettings.tsx`，挂载点有两处（实现时二选一，倾向后者）：

1. （备选）`BlindTrainingWorkbench.tsx` 现有设置抽屉里追加"AI 助手"分组
2. （推荐）`AIHabitAdvisor.tsx` 页面顶部内联一个"配置"按钮，点击展开配置面板

推荐理由：用户从 AI 教练页发现"未配置"时，不必跳到另一个模块去配置。配置面板内容：

```
AI 助手
┌──────────────────────────────────┐
│ Endpoint: [https://...]           │
│ API Key:  [•••••••••••]           │
│ Model:    [glm-4.7         ]      │
│ [测试连接]    [保存]               │
└──────────────────────────────────┘
```

- 保存到 `app_preferences.ai_advisor_config`（复用现有 `db:getPreference` / `db:savePreference`）
- "测试连接"发一个最小 messages 请求验证 200

---

## 6. IPC 设计

在 `src/main/ipc/blind.ts` 追加：

| Channel | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `agent:getConfig` | — | `{ endpoint, model, ready }`（**不返回 apiKey** 给渲染进程） | UI 判断是否配置就绪 |
| `agent:saveConfig` | `{ endpoint, apiKey, model }` | `{ success }` | 写 `app_preferences` |
| `agent:testConnection` | — | `{ ok, latencyMs, error? }` | 发最小请求验证 |
| `agent:analyzeHabits` | `{ profileId, force?: boolean }` | `PlatformResult<HabitProfile>` | 算指标，写 `habits_profile`，返回（不调 LLM） |
| `agent:generateReport` | `{ profileId, habitProfileId?, force?: boolean }` | `PlatformResult<AiReport>` | 缓存命中则直接返回；否则调 LLM，写 `ai_reports` |
| `agent:listReports` | `{ profileId, limit? }` | `AiReport[]` | 历史报告列表 |
| `agent:getHabitHistory` | `{ profileId, limit? }` | `HabitProfile[]` | 历史指标，画趋势线 |

preload 在 `electronAPI` 下加 `agent` 命名空间：

```typescript
agent: {
  getConfig: () => invoke('agent:getConfig'),
  saveConfig: (config) => invoke('agent:saveConfig', config),
  testConnection: () => invoke('agent:testConnection'),
  analyzeHabits: (req) => invoke('agent:analyzeHabits', req),
  generateReport: (req) => invoke('agent:generateReport', req),
  listReports: (req) => invoke('agent:listReports', req),
  getHabitHistory: (req) => invoke('agent:getHabitHistory', req),
}
```

---

## 7. 错误处理

| 场景 | 处理 |
| --- | --- |
| API key 未配置 | `agent:getConfig.ready = false`，UI 红条 + 跳设置；本地指标仍可看 |
| session 数 < 3 | `analyzeHabits` 直接返回 `{ success: false, error: 'insufficient_data' }`，UI 空状态 |
| LLM 超时（30s） | `generateReport` 返回 `{ success: false, error: 'timeout' }`，写一行 `ai_reports.error='timeout'` |
| LLM 返回非 JSON | 降级为 `{ fallback_text }`，标记 `error='json_parse_failed'`，UI 显示原始文本 + 提示 |
| LLM 非 200 | 写 `ai_reports.error = http_status`，UI 显示 HTTP 错误码 |
| 网络断开 | 同超时处理 |
| 同 habit_profile_id 已有报告 | 默认读缓存；`force=true` 才覆盖 |

**所有错误都不影响本地指标展示** —— 这是分层的核心价值。

---

## 8. 测试策略

### 8.1 单元测试（vitest）

- **habit-analyzer**（最高优先级）：
  - mock 一组 trade_actions，验证追涨率计算
  - mock 倒金字塔场景（同 session 多笔递增 buy）
  - mock 止损纪律（应止损但未止损 vs 已止损）
  - mock 盈亏比（盈利单 + 亏损单）
  - 边界：空 actions / 全 hold / 单笔交易
- **ai-advisor**：
  - `buildPrompt(payload)` 验证系统/用户提示结构
  - `parseReportResponse(content)` 验证三种路径：合法 JSON / markdown 包裹 / 完全无法解析
  - `selectRepresentativeSessions(sessions)` 验证 Top-3 规则（1 盈 + 2 亏）

### 8.2 手动验证（npm run dev）

- 配置 API key → 生成诊断 → 看报告卡完整渲染
- 不配置 key → 本地指标可看，AI 区红条
- 同一指标快照重复点"生成报告" → 命中缓存，不重跑 LLM（看日志确认无 HTTP 请求）
- 删除 profile → 关联的 `habits_profile` / `ai_reports` 级联删除

---

## 9. 上线节奏（建议）

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | DB 表 + habit-analyzer 纯函数 + 单测 | 8 个指标算对 |
| P2 | IPC `agent:*` + preload 桥接 | renderer 可调用 |
| P3 | `AIHabitAdvisor.tsx` 本地指标区 + 趋势线 | 无 key 时也能完整看 |
| P4 | ai-advisor + LLM 调用 + 报告卡渲染 + 设置页配置 | 端到端跑通 |
| P5 | 错误分支全覆盖（超时/无 JSON/无网/数据不足） | 每条都有 UI |

---

## 10. 不做的事（YAGNI）

- ❌ 多轮对话（v1 是一次性报告卡）
- ❌ 流式响应（报告卡场景一次性返回即可）
- ❌ `behavior_event` 表（v2 再依赖，本 spec 只用现有数据）
- ❌ RAG（指标已结构化，无需向量检索）
- ❌ 多模型对比（v1 固定一个 model）
- ❌ 导出报告 PDF / 分享（v2）
- ❌ 跨 profile 对比（v2）

---

## 11. 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| 股票代码泄漏给第三方 LLM | 用户首次配置时弹确认；只发已结束 session；不发原始 K 线 |
| LLM 返回不稳定（非 JSON / 幻觉数字） | 强制 JSON 解析 + 降级；报告卡中"证据"字段限定引用输入数据，prompt 明确"不要编造未给出的数字" |
| token 成本 | payload 已精简（指标 + Top-3 动作序列，预估 < 2k token）；同 habit_profile_id 缓存命中不重跑 |
| 追涨率算法主观（阈值 3% / N=5） | 阈值放在 `ai_advisor_config` 内可调；初始值保守（3% / 5 根） |
| 智谱 endpoint 不可用 | 设置页可改 endpoint；环境变量兜底 |

---

## 12. 相关链接

- 项目规则：[AGENTS.md](../../../AGENTS.md)
- 数据底座契约：[docs/data-foundation-schema-v0.1.md](../../data-foundation-schema-v0.1.md)
- 盲训事件表（v2 依赖）：[docs/behavior-event-design.md](../../behavior-event-design.md)
- 现有盲训 IPC：[src/main/ipc/blind.ts](../../../src/main/ipc/blind.ts)
- 现有 AI 配置 IPC（半接好）：[src/main/index.ts:82-90](../../../src/main/index.ts)
