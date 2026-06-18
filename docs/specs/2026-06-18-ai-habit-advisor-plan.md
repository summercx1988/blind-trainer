# AI 交易教练（AI Habit Advisor）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在盲训工作台新增第 4 个模块「AI 交易教练」，本地算 8 个习惯指标 + 调用智谱 GLM 生成结构化诊断报告卡。

**Architecture:** 四层分离 —— 本地指标算法（纯函数 `habit-analyzer`）与 LLM 调用（`ai-advisor`）解耦，没有 key/网络时本地指标仍可看。新增文件为主，对现有 3 个模块零侵入；唯一改动现有文件：`App.tsx`（加路由）、`preload/index.ts` + `global.d.ts`（加 agent 桥）、`ipc/blind.ts`（追加 handler 函数体，不动现有 handler）、`blindDb.ts`（追加 `CREATE TABLE IF NOT EXISTS`，幂等）。

**Tech Stack:** Electron 41 + React 19 + TypeScript 5 + better-sqlite3 + 智谱 GLM（Anthropic messages 兼容）+ vitest（新增 dev-dep）

**关联 spec:** [docs/specs/2026-06-18-ai-habit-advisor-design.md](../specs/2026-06-18-ai-habit-advisor-design.md)

---

## 零侵入约束（贯穿全程）

每个改动现有文件的任务，必须满足：

- **不修改任何现有函数体**，只在文件末尾或新命名空间追加
- **不动现有 IPC handler 的注册顺序与逻辑**
- **DB 改动只用 `CREATE TABLE IF NOT EXISTS`**（幂等，老库直接兼容）
- 每个任务结束跑 `npx tsc -b --noEmit` 通过才算完成
- 现有 3 个模块（overview / blind / data）的代码路径**一行都不改**

---

## 文件结构

### 新建（10 个文件）

| 文件 | 职责 |
| --- | --- |
| `src/main/services/habit-analyzer.ts` | 8 个习惯指标的纯函数计算（核心可测单元） |
| `src/main/services/ai-advisor.ts` | prompt 拼接 + LLM 调用 + JSON 解析降级 |
| `src/main/services/__tests__/habit-analyzer.test.ts` | 指标算法单测 |
| `src/main/services/__tests__/ai-advisor.test.ts` | prompt 拼接 + 解析降级单测 |
| `src/main/ipc/agentIpc.ts` | `agent:*` 一组 IPC handler（独立文件，被 blind.ts 引入注册） |
| `src/types/agent.ts` | `HabitIndicators` / `HabitProfile` / `AiReport` 等共享类型 |
| `src/components/trading/AIHabitAdvisor.tsx` | 教练页面主组件 |
| `src/components/trading/blind-workbench/AiAdvisorSettings.tsx` | endpoint/key/model 配置面板 |
| `vitest.config.ts` | vitest 配置（仅 test，不影响 vite build） |
| `src/main/services/__tests__/fixtures.ts` | 共享 mock 数据构造器 |

### 修改（5 个文件，全部追加式）

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `src/main/blindDb.ts` | `initBlindTables` 末尾追加 2 张表的 CREATE + INDEX | 低（IF NOT EXISTS 幂等） |
| `src/main/ipc/blind.ts` | 末尾 `registerBlindIpc` 函数体内追加 `registerAgentIpc()` 调用 + import | 低（一行调用） |
| `src/preload/index.ts` | `electronAPI` 对象内追加 `agent: { ... }` 命名空间 | 低（新键，不动现有） |
| `src/types/global.d.ts` | Window.electronAPI 类型追加 `agent?` | 低（可选属性） |
| `src/App.tsx` | `AppModule` 类型加 `'agent'`；MODULE_GROUPS 加一项；`renderModule` 加分支 | 低（追加分支） |

---

## Task 0：安装 vitest 并配置（基础设施）

**Files:**
- Modify: `package.json`（devDependencies 加 vitest）
- Create: `vitest.config.ts`

**Why:** 项目目前无测试框架。spec §8 要求单测。先建好基础，后续每个算法任务才能 TDD。vitest 是 vite 原生，零额外构建配置。

- [ ] **Step 1: 安装 vitest**

Run:
```bash
npm install -D vitest@^2.1.0 @vitest/expect@^2.1.0
```

Expected: `package.json` devDependencies 出现 vitest；node_modules 装好。

- [ ] **Step 2: 创建 vitest.config.ts**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
})
```

- [ ] **Step 3: 在 package.json scripts 加 test 命令**

Modify `package.json` scripts，在 `"preview": "vite preview"` 后追加：
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: 加一个最简冒烟测试验证框架可用**

Create `src/main/services/__tests__/smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: 运行测试验证**

Run: `npm test`
Expected: 1 passed

- [ ] **Step 6: 删除冒烟测试**

Delete `src/main/services/__tests__/smoke.test.ts`（仅用于验证框架，不留垃圾）。

- [ ] **Step 7: 跑 tsc 确认未破坏构建**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(test): 引入 vitest 测试框架

为 AI 交易教练模块的纯函数单测做准备。仅 devDependencies，不影响生产构建。"
```

---

## Task 1：定义共享类型

**Files:**
- Create: `src/types/agent.ts`

**Why:** 后续所有任务都依赖这些类型。先固化接口，避免类型不一致（spec 自检清单第 3 项）。

- [ ] **Step 1: 创建类型文件**

Create `src/types/agent.ts`:
```typescript
export interface HabitIndicators {
  chase_high_rate: number
  inverse_pyramid_rate: number
  stop_loss_discipline: number
  profit_loss_ratio: number
  profit_taking_timing: number
  avg_holding_bars: number
  avg_position_ratio: number
  result_group: {
    win_rate: number
    avg_pnl_pct: number
    max_drawdown_pct: number
    max_loss_streak: number
  }
}

export interface HabitProfile {
  id: string
  profile_id: string
  computed_at: number
  session_count: number
  indicators: HabitIndicators
}

export interface TradeActionRow {
  session_id: string
  bar_index: number
  action_type: 'buy' | 'sell' | 'hold' | 'skip'
  price: number | null
  shares: number | null
  amount: number | null
  realized_pnl: number | null
  created_at: number
}

export interface SessionReviewRow {
  session_id: string
  trade_win_rate: number
  realized_pnl: number
  realized_pnl_pct: number
  max_drawdown_pct: number
  buy_count: number
  sell_count: number
  hold_count: number
  avg_holding_bars: number
  total_trades: number
  winning_trades: number
}

export interface SessionRow {
  id: string
  stock_code: string
  stock_name: string
  interval_type: string
  initial_capital: number
  realized_pnl: number | null
  status: string
  started_at: number
}

export interface HabitAnalyzerConfig {
  lookbackBars: number
  chaseHighThreshold: number
  stopLossThreshold: number
  stopLossGraceBars: number
}

export const DEFAULT_HABIT_CONFIG: HabitAnalyzerConfig = {
  lookbackBars: 5,
  chaseHighThreshold: 0.03,
  stopLossThreshold: -0.07,
  stopLossGraceBars: 5,
}

export interface AdvisorStrength {
  indicator: string
  value: string
  evidence: string
  comment: string
}

export interface AdvisorBadHabit {
  name: string
  severity: 'high' | 'medium' | 'low'
  trigger: string
  evidence_session?: string
  fix: string
}

export interface AdvisorActionItem {
  priority: number
  action: string
  rationale: string
  expected_impact?: string
}

export interface AdvisorReport {
  strengths: AdvisorStrength[]
  weaknesses: AdvisorStrength[]
  bad_habits: AdvisorBadHabit[]
  action_plan: AdvisorActionItem[]
}

export interface AiReportRecord {
  id: string
  profile_id: string
  habit_profile_id: string
  report: AdvisorReport | { fallback_text: string }
  raw_response: string | null
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  duration_ms: number | null
  error: string | null
  created_at: number
}

export interface RepresentativeSession {
  stock_code: string
  stock_name: string
  interval_type: string
  realized_pnl_pct: number
  total_trades: number
  trade_win_rate: number
  actions: Array<{
    bar_index: number
    action_type: 'buy' | 'sell' | 'hold' | 'skip'
    price?: number
    shares?: number
    realized_pnl?: number
  }>
}

export interface AiAdvisorConfig {
  endpoint: string
  apiKey: string
  model: string
  ready: boolean
}
```

- [ ] **Step 2: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/types/agent.ts
git commit -m "feat(agent): 共享类型定义 HabitIndicators / AdvisorReport / AiReportRecord"
```

---

## Task 2：建 DB 表（幂等追加）

**Files:**
- Modify: `src/main/blindDb.ts`（`initBlindTables` 函数末尾追加 SQL）

**Why:** spec §3。两张表，IF NOT EXISTS 幂等，老库零迁移。

- [ ] **Step 1: 在 initBlindTables 的 database.exec 模板字符串末尾追加**

Modify `src/main/blindDb.ts`，在 `initBlindTables` 函数内的 `database.exec(\`...\`)` 模板字符串里，紧接现有 `CREATE INDEX IF NOT EXISTS idx_blind_profiles_active ...` 那一行之后追加：

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

- [ ] **Step 2: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: 启动 app 验证表创建不报错（手动）**

Run: `npm run dev`（启动后看主进程日志无 SQL 错误，可立即关闭）
Expected: 无 `SQLITE_ERROR` / `no such table` 日志

- [ ] **Step 4: Commit**

```bash
git add src/main/blindDb.ts
git commit -m "feat(db): habits_profile + ai_reports 两张表（幂等追加）

CREATE TABLE IF NOT EXISTS，老库零迁移。外键级联删除依赖已有的 PRAGMA foreign_keys = ON。"
```

---

## Task 3：habit-analyzer 纯函数 + 单测（核心）

**Files:**
- Create: `src/main/services/habit-analyzer.ts`
- Create: `src/main/services/__tests__/fixtures.ts`
- Create: `src/main/services/__tests__/habit-analyzer.test.ts`

**Why:** spec §2。8 个指标全部纯函数算出，脱离 DB/IPC 即可单测。这是整个模块最该测的部分。

**注意：** 指标 1（追涨率）和 3（止损纪律）按 spec §2.3 的降级路径实现 —— 用同 session 内 buy 价格序列的局部 max 作为"前 N 根高点"，不依赖 kline_daily join（避免 bar_index 与 K 线行号不对齐问题）。在代码注释中标注此降级。

- [ ] **Step 1: 创建 fixtures 构造器**

Create `src/main/services/__tests__/fixtures.ts`:
```typescript
import type {
  TradeActionRow,
  SessionReviewRow,
  SessionRow
} from '../../../types/agent'

let actionSeq = 0
const nextCreatedAt = () => 1_700_000_000 + actionSeq++

export const makeAction = (overrides: Partial<TradeActionRow> & {
  session_id: string
  bar_index: number
  action_type: TradeActionRow['action_type']
}): TradeActionRow => {
  actionSeq++
  return {
    price: null,
    shares: null,
    amount: null,
    realized_pnl: null,
    created_at: nextCreatedAt(),
    ...overrides,
  }
}

export const makeReview = (overrides: Partial<SessionReviewRow> & {
  session_id: string
}): SessionReviewRow => ({
  trade_win_rate: 0.5,
  realized_pnl: 0,
  realized_pnl_pct: 0,
  max_drawdown_pct: 0,
  buy_count: 1,
  sell_count: 1,
  hold_count: 0,
  avg_holding_bars: 5,
  total_trades: 1,
  winning_trades: 0,
  ...overrides,
})

export const makeSession = (overrides: Partial<SessionRow> & {
  id: string
}): SessionRow => ({
  stock_code: 'TEST001',
  stock_name: '测试股',
  interval_type: '1d',
  initial_capital: 100000,
  realized_pnl: 0,
  status: 'finished',
  started_at: 1_700_000_000,
  ...overrides,
})

export const resetFixtureSeq = () => { actionSeq = 0 }
```

- [ ] **Step 2: 写第一个失败测试 —— 追涨率**

Create `src/main/services/__tests__/habit-analyzer.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { computeHabitIndicators } from '../habit-analyzer'
import { makeAction, makeReview, makeSession, resetFixtureSeq } from './fixtures'
import { DEFAULT_HABIT_CONFIG } from '../../../types/agent'

const SID = 'sess_test'

const baseSession = () => makeSession({ id: SID, initial_capital: 100000 })

describe('computeHabitIndicators - chase_high_rate', () => {
  beforeEach(resetFixtureSeq)

  it('返回 1.0 当所有 buy 都追高（价格 >= 前 5 根高点 * 1.03）', () => {
    // 用 buy 价格序列模拟"前 5 根高点"：降级算法取同 session 已有 buy 的局部 max
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10 }),
      makeAction({ session_id: SID, bar_index: 2, action_type: 'buy', price: 10.5 }),
      makeAction({ session_id: SID, bar_index: 3, action_type: 'sell', price: 11, realized_pnl: 100 }),
    ]
    const result = computeHabitIndicators(
      actions,
      [makeReview({ session_id: SID })],
      [baseSession()],
      DEFAULT_HABIT_CONFIG
    )
    // bar 2 的 buy 价格 10.5 相对 bar 1 的 10 偏离 5% >= 3% → 追高
    expect(result.chase_high_rate).toBeCloseTo(0.5, 5)
  })

  it('返回 0 当没有 buy', () => {
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'hold' }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    expect(result.chase_high_rate).toBe(0)
  })
})
```

- [ ] **Step 3: 运行测试确认失败（函数不存在）**

Run: `npm test -- habit-analyzer`
Expected: FAIL，错误含 `Cannot find module '../habit-analyzer'`

- [ ] **Step 4: 创建 habit-analyzer.ts 骨架 + 追涨率实现**

Create `src/main/services/habit-analyzer.ts`:
```typescript
import type {
  HabitIndicators,
  HabitAnalyzerConfig,
  TradeActionRow,
  SessionReviewRow,
  SessionRow,
} from '../../types/agent'
import { DEFAULT_HABIT_CONFIG } from '../../types/agent'

// 降级实现说明（spec §2.3）：
// 追涨率/止损纪律本应 join kline_daily 取前 N 根高点，
// 但盲训 bar_index 与 K 线行号可能不对齐（mask），
// 这里改用同 session 内 buy 价格序列的局部 max 作为"前 N 根高点"代理。
// 精度略损，但保证可算且不依赖外部 K 线表。
export function computeHabitIndicators(
  actions: TradeActionRow[],
  reviews: SessionReviewRow[],
  sessions: SessionRow[],
  config: HabitAnalyzerConfig = DEFAULT_HABIT_CONFIG
): HabitIndicators {
  return {
    chase_high_rate: computeChaseHighRate(actions, config),
    inverse_pyramid_rate: 0,
    stop_loss_discipline: 0,
    profit_loss_ratio: 0,
    profit_taking_timing: 0,
    avg_holding_bars: 0,
    avg_position_ratio: 0,
    result_group: {
      win_rate: 0,
      avg_pnl_pct: 0,
      max_drawdown_pct: 0,
      max_loss_streak: 0,
    },
  }
}

// 追涨率 = 追高买入笔数 / 总买入笔数
// 一笔 buy 视为追高，当其 price >= 同 session 此前所有 buy price 的 max * (1 + threshold)
function computeChaseHighRate(actions: TradeActionRow[], config: HabitAnalyzerConfig): number {
  const bySession = groupBySession(actions)
  let totalBuys = 0
  let chaseBuys = 0
  for (const sessActions of bySession.values()) {
    const buys = sessActions
      .filter(a => a.action_type === 'buy' && a.price != null)
      .sort((a, b) => a.bar_index - b.bar_index)
    let prevMax = -Infinity
    for (const buy of buys) {
      const price = buy.price as number
      totalBuys++
      if (prevMax !== -Infinity && price >= prevMax * (1 + config.chaseHighThreshold)) {
        chaseBuys++
      }
      prevMax = Math.max(prevMax, price)
    }
  }
  if (totalBuys === 0) return 0
  return chaseBuys / totalBuys
}

function groupBySession(actions: TradeActionRow[]): Map<string, TradeActionRow[]> {
  const map = new Map<string, TradeActionRow[]>()
  for (const a of actions) {
    const list = map.get(a.session_id) ?? []
    list.push(a)
    map.set(a.session_id, list)
  }
  return map
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- habit-analyzer`
Expected: 2 passed

- [ ] **Step 6: 写倒金字塔加仓测试**

追加到 `habit-analyzer.test.ts` 末尾：
```typescript
describe('computeHabitIndicators - inverse_pyramid_rate', () => {
  beforeEach(resetFixtureSeq)

  it('返回 1.0 当所有多笔 buy 的 session 都是递增加仓', () => {
    const actions = [
      makeAction({ session_id: 's1', bar_index: 1, action_type: 'buy', price: 10 }),
      makeAction({ session_id: 's1', bar_index: 2, action_type: 'buy', price: 12 }),
      makeAction({ session_id: 's2', bar_index: 1, action_type: 'buy', price: 20 }),
      makeAction({ session_id: 's2', bar_index: 2, action_type: 'buy', price: 25 }),
    ]
    const result = computeHabitIndicators(
      actions,
      [makeReview({ session_id: 's1' }), makeReview({ session_id: 's2' })],
      [makeSession({ id: 's1' }), makeSession({ id: 's2' })],
      DEFAULT_HABIT_CONFIG
    )
    expect(result.inverse_pyramid_rate).toBe(1)
  })

  it('不计入只有单笔 buy 的 session', () => {
    const actions = [
      makeAction({ session_id: 's1', bar_index: 1, action_type: 'buy', price: 10 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: 's1' })], [makeSession({ id: 's1' })], DEFAULT_HABIT_CONFIG)
    expect(result.inverse_pyramid_rate).toBe(0)
  })
})
```

- [ ] **Step 7: 实现倒金字塔加仓**

在 `habit-analyzer.ts` 的 `computeHabitIndicators` 返回对象中替换 `inverse_pyramid_rate: 0` 为 `inverse_pyramid_rate: computeInversePyramidRate(actions)`，并新增函数：

```typescript
// 倒金字塔加仓率 = 倒金字塔 session 数 / 有多笔 buy 的 session 数
// 一个 session 视为倒金字塔，当其存在后续 buy price 高于首笔 buy price
function computeInversePyramidRate(actions: TradeActionRow[]): number {
  const bySession = groupBySession(actions)
  let multiBuySessions = 0
  let inversePyramidSessions = 0
  for (const sessActions of bySession.values()) {
    const buys = sessActions
      .filter(a => a.action_type === 'buy' && a.price != null)
      .sort((a, b) => a.bar_index - b.bar_index)
    if (buys.length < 2) continue
    multiBuySessions++
    const firstPrice = buys[0].price as number
    if (buys.some(b => (b.price as number) > firstPrice)) {
      inversePyramidSessions++
    }
  }
  if (multiBuySessions === 0) return 0
  return inversePyramidSessions / multiBuySessions
}
```

- [ ] **Step 8: 测试通过**

Run: `npm test -- habit-analyzer`
Expected: 4 passed

- [ ] **Step 9: 写盈亏比 + 止盈过早测试**

追加到 `habit-analyzer.test.ts`：
```typescript
describe('computeHabitIndicators - profit_loss_ratio & profit_taking_timing', () => {
  beforeEach(resetFixtureSeq)

  it('盈亏比 = avg(盈利单) / abs(avg(亏损单))', () => {
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'sell', price: 11, realized_pnl: 200 }),
      makeAction({ session_id: SID, bar_index: 2, action_type: 'sell', price: 9, realized_pnl: -100 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    // avg(win)=200, abs(avg(loss))=100, ratio=2
    expect(result.profit_loss_ratio).toBeCloseTo(2, 5)
  })

  it('止盈过早 = 盈利单持仓 < 亏损单持仓 * 0.8 时返回 < 0.8', () => {
    // 盈利单 1 bar，亏损单 5 bar → ratio = 1/5 = 0.2
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10 }),
      makeAction({ session_id: SID, bar_index: 2, action_type: 'sell', price: 11, realized_pnl: 100 }),
      makeAction({ session_id: SID, bar_index: 3, action_type: 'buy', price: 10 }),
      makeAction({ session_id: SID, bar_index: 8, action_type: 'sell', price: 9, realized_pnl: -100 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    expect(result.profit_taking_timing).toBeCloseTo(0.2, 5)
  })

  it('无平仓交易时盈亏比为 0', () => {
    const actions = [makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10 })]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    expect(result.profit_loss_ratio).toBe(0)
  })
})
```

- [ ] **Step 10: 实现盈亏比 + 止盈过早**

在 `habit-analyzer.ts` 替换 `profit_loss_ratio: 0` 和 `profit_taking_timing: 0`，新增函数：

```typescript
// 盈亏比 = avg(盈利单 realized_pnl) / abs(avg(亏损单 realized_pnl))
function computeProfitLossRatio(actions: TradeActionRow[]): number {
  const sells = actions.filter(a => a.action_type === 'sell' && a.realized_pnl != null)
  const wins = sells.filter(a => (a.realized_pnl as number) > 0)
  const losses = sells.filter(a => (a.realized_pnl as number) < 0)
  if (wins.length === 0 || losses.length === 0) return 0
  const avgWin = wins.reduce((s, a) => s + (a.realized_pnl as number), 0) / wins.length
  const avgLoss = Math.abs(losses.reduce((s, a) => s + (a.realized_pnl as number), 0) / losses.length)
  if (avgLoss === 0) return 0
  return avgWin / avgLoss
}

// 止盈过早/过晚 = 盈利单平均持仓 bars / 亏损单平均持仓 bars
// < 0.8 = 赚一点就跑；> 1.3 = 拿得住盈利
function computeProfitTakingTiming(actions: TradeActionRow[]): number {
  const pairs = pairBuySell(actions)
  const winBars: number[] = []
  const lossBars: number[] = []
  for (const p of pairs) {
    const bars = p.sellBar - p.buyBar
    if (p.realizedPnl > 0) winBars.push(bars)
    else if (p.realizedPnl < 0) lossBars.push(bars)
  }
  if (winBars.length === 0 || lossBars.length === 0) return 0
  const avgWin = winBars.reduce((s, b) => s + b, 0) / winBars.length
  const avgLoss = lossBars.reduce((s, b) => s + b, 0) / lossBars.length
  if (avgLoss === 0) return 0
  return avgWin / avgLoss
}

interface BuySellPair { buyBar: number; sellBar: number; realizedPnl: number }

// 简化配对：每个 session 内按 bar_index 顺序，buy 后最近的 sell 配对（FIFO 近似）
function pairBuySell(actions: TradeActionRow[]): BuySellPair[] {
  const pairs: BuySellPair[] = []
  const bySession = groupBySession(actions)
  for (const sessActions of bySession.values()) {
    const sorted = [...sessActions].sort((a, b) => a.bar_index - b.bar_index)
    let pendingBuyBar: number | null = null
    for (const a of sorted) {
      if (a.action_type === 'buy') {
        pendingBuyBar = a.bar_index
      } else if (a.action_type === 'sell' && pendingBuyBar !== null) {
        pairs.push({
          buyBar: pendingBuyBar,
          sellBar: a.bar_index,
          realizedPnl: a.realized_pnl ?? 0,
        })
        pendingBuyBar = null
      }
    }
  }
  return pairs
}
```

- [ ] **Step 11: 测试通过**

Run: `npm test -- habit-analyzer`
Expected: 7 passed

- [ ] **Step 12: 写止损纪律 + 仓位占比测试**

追加到 `habit-analyzer.test.ts`：
```typescript
describe('computeHabitIndicators - stop_loss_discipline & avg_position_ratio', () => {
  beforeEach(resetFixtureSeq)

  it('止损纪律 = 实际止损 / 应止损（浮亏超阈值后 grace bars 内卖出）', () => {
    // buy @ 10，跌到 9.3 即 -7%（达到阈值）；之后 3 bar 内 sell 视为已止损
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10 }),
      makeAction({ session_id: SID, bar_index: 4, action_type: 'sell', price: 9.3, realized_pnl: -70 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    // 降级算法：buy 后若同 session 有 sell 且 realized_pnl/buy_amount <= threshold 视为应止损；
    // 该 sell 在 grace bars 内 → 已止损。应止损=1, 已止损=1 → 1.0
    expect(result.stop_loss_discipline).toBe(1)
  })

  it('avg_position_ratio = buy amount / 初始资金的中位数', () => {
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10, shares: 1000, amount: 10000 }),
      makeAction({ session_id: SID, bar_index: 2, action_type: 'buy', price: 10, shares: 2000, amount: 20000 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    // amounts [10000, 20000] / 100000 = [0.1, 0.2]，中位数 0.15
    expect(result.avg_position_ratio).toBeCloseTo(0.15, 5)
  })
})
```

- [ ] **Step 13: 实现止损纪律 + 仓位占比 + 持仓节奏 + 结果组**

在 `habit-analyzer.ts` 替换剩余的 `0` 占位，并新增函数。完整替换 `computeHabitIndicators` 返回体与新增：

```typescript
// 止损纪律 = 已止损笔数 / 应止损笔数
// 降级算法：每笔 buy 后若存在 realized_pnl/price*shares <= stopLossThreshold 的 sell，视为"应止损"；
// 若该 sell 在 buy 后 stopLossGraceBars 根 bar 内 → 已止损
function computeStopLossDiscipline(actions: TradeActionRow[], config: HabitAnalyzerConfig): number {
  const pairs = pairBuySell(actions)
  let shouldStop = 0
  let didStop = 0
  for (const p of pairs) {
    // 需要 buy price 来判断浮亏比例；从 actions 里找配对的 buy price
    const buyAction = actions.find(a => a.session_id === actions.find(x => x.bar_index === p.buyBar)?.session_id && a.bar_index === p.buyBar && a.action_type === 'buy')
    const buyPrice = buyAction?.price
    if (buyPrice == null) continue
    const lossPct = p.realizedPnl / (buyPrice * (buyAction?.shares ?? 1))
    if (lossPct <= config.stopLossThreshold) {
      shouldStop++
      if (p.sellBar - p.buyBar <= config.stopLossGraceBars) {
        didStop++
      }
    }
  }
  if (shouldStop === 0) return 0
  return didStop / shouldStop
}

// 平均持仓 bars = 所有 buy-sell 配对的 (sellBar - buyBar) 平均
function computeAvgHoldingBars(reviews: SessionReviewRow[]): number {
  if (reviews.length === 0) return 0
  const sum = reviews.reduce((s, r) => s + (r.avg_holding_bars || 0), 0)
  return sum / reviews.length
}

// 单笔仓位占比中位数 = buy amount / session initial_capital
function computeAvgPositionRatio(actions: TradeActionRow[], sessions: SessionRow[]): number {
  const capitalBySession = new Map(sessions.map(s => [s.id, s.initial_capital]))
  const ratios: number[] = []
  for (const a of actions) {
    if (a.action_type !== 'buy' || a.amount == null) continue
    const cap = capitalBySession.get(a.session_id)
    if (!cap || cap <= 0) continue
    ratios.push(a.amount / cap)
  }
  if (ratios.length === 0) return 0
  ratios.sort((x, y) => x - y)
  const mid = Math.floor(ratios.length / 2)
  return ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid]
}

// 结果组：直接从 session_reviews 聚合 + sessions 算连损
function computeResultGroup(reviews: SessionReviewRow[], sessions: SessionRow[]) {
  if (reviews.length === 0) {
    return { win_rate: 0, avg_pnl_pct: 0, max_drawdown_pct: 0, max_loss_streak: 0 }
  }
  const winRate = reviews.reduce((s, r) => s + (r.trade_win_rate || 0), 0) / reviews.length
  const avgPnlPct = reviews.reduce((s, r) => s + (r.realized_pnl_pct || 0), 0) / reviews.length
  const maxDd = Math.max(...reviews.map(r => r.max_drawdown_pct || 0))
  const maxLossStreak = computeMaxLossStreak(sessions)
  return { win_rate: winRate, avg_pnl_pct: avgPnlPct, max_drawdown_pct: maxDd, max_loss_streak: maxLossStreak }
}

// 连损场次：按 started_at 排序，realized_pnl < 0 视为亏损场，算最长连续
function computeMaxLossStreak(sessions: SessionRow[]): number {
  const sorted = [...sessions].sort((a, b) => a.started_at - b.started_at)
  let max = 0
  let cur = 0
  for (const s of sorted) {
    if ((s.realized_pnl ?? 0) < 0) {
      cur++
      max = Math.max(max, cur)
    } else {
      cur = 0
    }
  }
  return max
}
```

并更新 `computeHabitIndicators` 返回体为：
```typescript
  return {
    chase_high_rate: computeChaseHighRate(actions, config),
    inverse_pyramid_rate: computeInversePyramidRate(actions),
    stop_loss_discipline: computeStopLossDiscipline(actions, config),
    profit_loss_ratio: computeProfitLossRatio(actions),
    profit_taking_timing: computeProfitTakingTiming(actions),
    avg_holding_bars: computeAvgHoldingBars(reviews),
    avg_position_ratio: computeAvgPositionRatio(actions, sessions),
    result_group: computeResultGroup(reviews, sessions),
  }
```

- [ ] **Step 14: 全部测试通过**

Run: `npm test -- habit-analyzer`
Expected: 9 passed

- [ ] **Step 15: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 16: Commit**

```bash
git add src/main/services/habit-analyzer.ts src/main/services/__tests__/
git commit -m "feat(agent): habit-analyzer 8 指标纯函数 + 单测

追涨率/倒金字塔/止损纪律/盈亏比/止盈过早/持仓/仓位/结果组。
降级实现：用 buy 价格序列局部 max 代理前 N 根高点，避免 kline_daily join 对齐问题。"
```

---

## Task 4：ai-advisor prompt 拼接 + 解析（核心）

**Files:**
- Create: `src/main/services/ai-advisor.ts`
- Create: `src/main/services/__tests__/ai-advisor.test.ts`

**Why:** spec §4.2 / §4.3。prompt 拼接和 JSON 解析降级都是纯函数，先单测固化。

- [ ] **Step 1: 写 prompt 拼接失败测试**

Create `src/main/services/__tests__/ai-advisor.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { buildMessages, parseReportResponse, selectRepresentativeSessions } from '../ai-advisor'
import type { HabitProfile, RepresentativeSession, SessionRow, TradeActionRow } from '../../../types/agent'

const makeHabitProfile = (): HabitProfile => ({
  id: 'hp1',
  profile_id: 'default',
  computed_at: 1_700_000_000,
  session_count: 10,
  indicators: {
    chase_high_rate: 0.42,
    inverse_pyramid_rate: 0.3,
    stop_loss_discipline: 0.78,
    profit_loss_ratio: 1.8,
    profit_taking_timing: 0.7,
    avg_holding_bars: 7,
    avg_position_ratio: 0.35,
    result_group: { win_rate: 0.62, avg_pnl_pct: 5.2, max_drawdown_pct: 18, max_loss_streak: 3 },
  },
})

describe('buildMessages', () => {
  it('返回 system + user 两条消息，user 含 HabitProfile JSON', () => {
    const profile = makeHabitProfile()
    const sessions: RepresentativeSession[] = [{
      stock_code: '600029', stock_name: '中远海控', interval_type: '1d',
      realized_pnl_pct: -7, total_trades: 5, trade_win_rate: 0.4,
      actions: [{ bar_index: 12, action_type: 'buy', price: 10.5 }],
    }]
    const msgs = buildMessages(profile, sessions)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('chase_high_rate')
    expect(msgs[1].content).toContain('600029')
  })

  it('system prompt 要求严格 JSON 输出', () => {
    const msgs = buildMessages(makeHabitProfile(), [])
    expect(msgs[0].content).toContain('JSON')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- ai-advisor`
Expected: FAIL，`Cannot find module '../ai-advisor'`

- [ ] **Step 3: 创建 ai-advisor.ts 实现 buildMessages**

Create `src/main/services/ai-advisor.ts`:
```typescript
import type {
  HabitProfile,
  RepresentativeSession,
  AdvisorReport,
} from '../../types/agent'

const SYSTEM_PROMPT = `你是一位资深 A 股交易教练，专门帮助散户改进交易习惯。
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
      "evidence_session": "引用代表性 session 的股票名（如有）",
      "fix": "等回踩 ±2% 或量能确认后再入"
    }
  ],
  "action_plan": [
    {"priority": 1, "action": "...", "rationale": "...", "expected_impact": "..."}
  ]
}
不要输出 JSON 以外的内容。不要编造未在输入中给出的具体数字。`

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export function buildMessages(profile: HabitProfile, sessions: RepresentativeSession[]): ChatMessage[] {
  const payload = {
    profile,
    representative_sessions: sessions,
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(payload, null, 2) },
  ]
}

export function parseReportResponse(content: string): { report: AdvisorReport | { fallback_text: string }; error: string | null } {
  throw new Error('not implemented')
}

export function selectRepresentativeSessions(
  sessions: Array<Pick<SessionRow, 'id' | 'stock_code' | 'stock_name' | 'interval_type' | 'realized_pnl' | 'status'>>,
  actions: TradeActionRow[],
  reviews: Array<{ session_id: string; realized_pnl_pct: number; total_trades: number; trade_win_rate: number }>
): RepresentativeSession[] {
  throw new Error('not implemented')
}
```

- [ ] **Step 4: buildMessages 测试通过**

Run: `npm test -- ai-advisor`
Expected: 2 passed（buildMessages 部分）

- [ ] **Step 5: 写解析降级测试**

追加到 `ai-advisor.test.ts`：
```typescript
describe('parseReportResponse', () => {
  it('合法 JSON 直接解析', () => {
    const content = JSON.stringify({
      strengths: [{ indicator: '盈亏比', value: '1.8', evidence: 'x', comment: 'y' }],
      weaknesses: [],
      bad_habits: [],
      action_plan: [],
    })
    const { report, error } = parseReportResponse(content)
    expect(error).toBeNull()
    expect((report as { strengths: unknown[] }).strengths).toHaveLength(1)
  })

  it('markdown 代码块包裹的 JSON 仍能解析', () => {
    const content = '```json\n{"strengths":[],"weaknesses":[],"bad_habits":[],"action_plan":[]}\n```'
    const { report, error } = parseReportResponse(content)
    expect(error).toBeNull()
    expect((report as { strengths: unknown[] }).strengths).toHaveLength(0)
  })

  it('完全无法解析时降级为 fallback_text', () => {
    const content = '这不是 JSON，是模型胡言乱语'
    const { report, error } = parseReportResponse(content)
    expect(error).toBe('json_parse_failed')
    expect((report as { fallback_text: string }).fallback_text).toBe(content)
  })
})
```

- [ ] **Step 6: 实现 parseReportResponse**

在 `ai-advisor.ts` 替换 `parseReportResponse` 的 `throw`：

```typescript
export function parseReportResponse(content: string): { report: AdvisorReport | { fallback_text: string }; error: string | null } {
  // 1. 直接解析
  try {
    const parsed = JSON.parse(content)
    if (isValidReport(parsed)) return { report: parsed, error: null }
  } catch {
    // 落到下一步
  }
  // 2. 提取 markdown 代码块内的 JSON
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1])
      if (isValidReport(parsed)) return { report: parsed, error: null }
    } catch {
      // 落到下一步
    }
  }
  // 3. 兜底：提取第一个 {...} 块
  const braceMatch = content.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0])
      if (isValidReport(parsed)) return { report: parsed, error: null }
    } catch {
      // 落到 fallback
    }
  }
  // 4. 降级
  return { report: { fallback_text: content }, error: 'json_parse_failed' }
}

function isValidReport(obj: unknown): obj is AdvisorReport {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return Array.isArray(o.strengths) && Array.isArray(o.weaknesses)
    && Array.isArray(o.bad_habits) && Array.isArray(o.action_plan)
}
```

- [ ] **Step 7: 测试通过**

Run: `npm test -- ai-advisor`
Expected: 5 passed

- [ ] **Step 8: 写 selectRepresentativeSessions 测试**

追加到 `ai-advisor.test.ts`：
```typescript
describe('selectRepresentativeSessions', () => {
  it('返回 1 盈 + 2 亏（按 realized_pnl_pct）', () => {
    const sessions = [
      { id: 's1', stock_code: 'A', stock_name: '盈最多', interval_type: '1d', realized_pnl: 500, status: 'finished' },
      { id: 's2', stock_code: 'B', stock_name: '亏1', interval_type: '1d', realized_pnl: -100, status: 'finished' },
      { id: 's3', stock_code: 'C', stock_name: '亏2', interval_type: '1d', realized_pnl: -300, status: 'finished' },
      { id: 's4', stock_code: 'D', stock_name: '亏3更小', interval_type: '1d', realized_pnl: -50, status: 'finished' },
    ]
    const actions: TradeActionRow[] = [
      { session_id: 's1', bar_index: 1, action_type: 'buy', price: 10, shares: 100, amount: 1000, realized_pnl: null, created_at: 1 },
    ]
    const reviews = [
      { session_id: 's1', realized_pnl_pct: 5, total_trades: 2, trade_win_rate: 0.5 },
      { session_id: 's2', realized_pnl_pct: -1, total_trades: 2, trade_win_rate: 0.5 },
      { session_id: 's3', realized_pnl_pct: -3, total_trades: 2, trade_win_rate: 0.5 },
      { session_id: 's4', realized_pnl_pct: -0.5, total_trades: 2, trade_win_rate: 0.5 },
    ]
    const result = selectRepresentativeSessions(sessions, actions, reviews)
    expect(result).toHaveLength(3)
    const names = result.map(r => r.stock_name)
    expect(names).toContain('盈最多')
    // 两笔最大亏损：-3 和 -1（-0.5 最小不算）
    expect(names).toContain('亏2')
    expect(names).toContain('亏1')
  })

  it('跳过未结束的 session', () => {
    const sessions = [
      { id: 's1', stock_code: 'A', stock_name: 'X', interval_type: '1d', realized_pnl: 100, status: 'active' },
    ]
    const result = selectRepresentativeSessions(sessions, [], [])
    expect(result).toHaveLength(0)
  })
})
```

- [ ] **Step 9: 实现 selectRepresentativeSessions**

替换 `ai-advisor.ts` 中该函数的 `throw`：

```typescript
import type { TradeActionRow } from '../../types/agent'

export function selectRepresentativeSessions(
  sessions: Array<Pick<SessionRow, 'id' | 'stock_code' | 'stock_name' | 'interval_type' | 'realized_pnl' | 'status'>>,
  actions: TradeActionRow[],
  reviews: Array<{ session_id: string; realized_pnl_pct: number; total_trades: number; trade_win_rate: number }>
): RepresentativeSession[] {
  const finished = sessions.filter(s => s.status === 'finished')
  if (finished.length === 0) return []
  const reviewMap = new Map(reviews.map(r => [r.session_id, r]))
  const actionMap = new Map<string, TradeActionRow[]>()
  for (const a of actions) {
    const list = actionMap.get(a.session_id) ?? []
    list.push(a)
    actionMap.set(a.session_id, list)
  }

  const toRep = (s: typeof finished[number]): RepresentativeSession => {
    const rv = reviewMap.get(s.id)
    const sessActions = (actionMap.get(s.id) ?? [])
      .sort((a, b) => a.bar_index - b.bar_index)
      .map(a => ({
        bar_index: a.bar_index,
        action_type: a.action_type,
        price: a.price ?? undefined,
        shares: a.shares ?? undefined,
        realized_pnl: a.realized_pnl ?? undefined,
      }))
    return {
      stock_code: s.stock_code,
      stock_name: s.stock_name,
      interval_type: s.interval_type,
      realized_pnl_pct: rv?.realized_pnl_pct ?? 0,
      total_trades: rv?.total_trades ?? 0,
      trade_win_rate: rv?.trade_win_rate ?? 0,
      actions: sessActions,
    }
  }

  // 1 盈最多 + 2 亏最多（按 realized_pnl_pct）
  const withPnl = finished.map(s => ({ s, pct: reviewMap.get(s.id)?.realized_pnl_pct ?? 0 }))
  const topWin = [...withPnl].filter(x => x.pct > 0).sort((a, b) => b.pct - a.pct)[0]
  const topLosses = [...withPnl]
    .filter(x => x.pct < 0 && (!topWin || x.s.id !== topWin.s.id))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 2)

  const picked = [topWin, ...topLosses].filter(Boolean) as Array<{ s: typeof finished[number] }>
  return picked.map(x => toRep(x.s))
}
```

- [ ] **Step 10: 全部测试通过**

Run: `npm test -- ai-advisor`
Expected: 7 passed

- [ ] **Step 11: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 12: Commit**

```bash
git add src/main/services/ai-advisor.ts src/main/services/__tests__/ai-advisor.test.ts
git commit -m "feat(agent): ai-advisor prompt 拼接 + JSON 解析降级 + Top-3 选择

buildMessages / parseReportResponse（3 级降级）/ selectRepresentativeSessions（1 盈 + 2 亏）。"
```

---

## Task 5：LLM 调用封装（含超时与错误处理）

**Files:**
- Create: `src/main/services/ai-client.ts`

**Why:** 把 fetch + 超时 + 错误归类抽成单独模块，方便 ai-advisor 的 IPC 层调用。spec §4.3。

**注意：** Node 18+ 全局 fetch 可用。Electron 41 主进程支持。不引第三方 HTTP 库（YAGNI）。

- [ ] **Step 1: 创建 ai-client.ts**

Create `src/main/services/ai-client.ts`:
```typescript
import type { AiAdvisorConfig } from '../../types/agent'

export interface LlmCallResult {
  ok: boolean
  content: string
  status: number | null
  promptTokens: number | null
  completionTokens: number | null
  durationMs: number
  error: string | null
}

const TIMEOUT_MS = 30_000

export async function callLlm(
  config: AiAdvisorConfig,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  timeoutMs = TIMEOUT_MS
): Promise<LlmCallResult> {
  if (!config.ready) {
    return { ok: false, content: '', status: null, promptTokens: null, completionTokens: null, durationMs: 0, error: 'not_configured' }
  }
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        messages,
      }),
      signal: controller.signal,
    })
    const durationMs = Date.now() - start
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, content: text, status: res.status, promptTokens: null, completionTokens: null, durationMs, error: `http_${res.status}` }
    }
    const json = await res.json() as {
      content?: Array<{ text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const content = json.content?.[0]?.text ?? ''
    return {
      ok: true,
      content,
      status: res.status,
      promptTokens: json.usage?.input_tokens ?? null,
      completionTokens: json.usage?.output_tokens ?? null,
      durationMs,
      error: null,
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      content: '',
      status: null,
      promptTokens: null,
      completionTokens: null,
      durationMs,
      error: aborted ? 'timeout' : 'network_error',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function testConnection(config: AiAdvisorConfig): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const result = await callLlm(config, [{ role: 'user', content: 'ping' }], 10_000)
  return { ok: result.ok, latencyMs: result.durationMs, error: result.error }
}
```

- [ ] **Step 2: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/main/services/ai-client.ts
git commit -m "feat(agent): ai-client LLM 调用封装（fetch + 30s 超时 + 错误归类）"
```

> 说明：ai-client 不写单测（涉及真实 HTTP，mock fetch 性价比低；其错误分支由 IPC 层集成测试覆盖 + 手动验证）。

---

## Task 6：agentIpc — agent:* IPC handler

**Files:**
- Create: `src/main/ipc/agentIpc.ts`
- Modify: `src/main/ipc/blind.ts`（末尾追加一行 `registerAgentIpc()`）

**Why:** spec §6。7 个 channel。独立文件，blind.ts 只加一行注册调用，零侵入。

- [ ] **Step 1: 创建 agentIpc.ts**

Create `src/main/ipc/agentIpc.ts`:
```typescript
import { ipcMain } from 'electron'
import log from '../logger'
import { getDb } from '../db'
import { getBlindDb } from '../blindDb'
import { ok, fail } from './platformResult'
import { computeHabitIndicators } from '../services/habit-analyzer'
import { buildMessages, parseReportResponse, selectRepresentativeSessions } from '../services/ai-advisor'
import { callLlm, testConnection } from '../services/ai-client'
import { DEFAULT_HABIT_CONFIG } from '../../types/agent'
import type {
  AiAdvisorConfig,
  HabitProfile,
  HabitIndicators,
  TradeActionRow,
  SessionReviewRow,
  SessionRow,
} from '../../types/agent'

const CONFIG_KEY = 'ai_advisor_config'
const MIN_SESSIONS = 3

const readConfig = (): AiAdvisorConfig => {
  const row = getDb()
    .prepare('SELECT value_json FROM app_preferences WHERE key = ? LIMIT 1')
    .get(CONFIG_KEY) as { value_json?: string } | undefined
  let parsed: Partial<AiAdvisorConfig> = {}
  if (row?.value_json) {
    try { parsed = JSON.parse(row.value_json) } catch { /* ignore */ }
  }
  const endpoint = parsed.endpoint
    || (process.env.ANTHROPIC_BASE_URL ? `${process.env.ANTHROPIC_BASE_URL}/v1/messages` : 'https://open.bigmodel.cn/api/anthropic/v1/messages')
  const apiKey = parsed.apiKey || process.env.ANTHROPIC_AUTH_TOKEN || ''
  const model = parsed.model || process.env.ANTHROPIC_MODEL || 'glm-4.7'
  return { endpoint, apiKey, model, ready: Boolean(apiKey) }
}

const loadProfileData = (profileId: string) => {
  const db = getBlindDb()
  const sessions = db.prepare(`
    SELECT id, stock_code, stock_name, interval_type, initial_capital, realized_pnl, status, started_at
    FROM training_sessions
    WHERE profile_id = ? AND status = 'finished'
    ORDER BY started_at ASC
  `).all(profileId) as SessionRow[]
  const sessionIds = sessions.map(s => s.id)
  if (sessionIds.length === 0) {
    return { sessions: [], actions: [] as TradeActionRow[], reviews: [] as SessionReviewRow[] }
  }
  const placeholders = sessionIds.map(() => '?').join(',')
  const actions = db.prepare(`
    SELECT session_id, bar_index, action_type, price, shares, amount, realized_pnl, created_at
    FROM trade_actions
    WHERE session_id IN (${placeholders})
    ORDER BY created_at ASC
  `).all(...sessionIds) as Array<Omit<TradeActionRow, 'created_at'> & { created_at: number | string }> as TradeActionRow[]
  const reviews = db.prepare(`
    SELECT session_id, trade_win_rate, realized_pnl, realized_pnl_pct, max_drawdown_pct,
           buy_count, sell_count, hold_count, avg_holding_bars, total_trades, winning_trades
    FROM session_reviews
    WHERE session_id IN (${placeholders})
  `).all(...sessionIds) as SessionReviewRow[]
  return { sessions, actions, reviews }
}

export function registerAgentIpc() {
  ipcMain.handle('agent:getConfig', async () => {
    const c = readConfig()
    // 不把 apiKey 明文返回渲染进程；只返回 ready 标志与脱敏后缀
    const maskedKey = c.apiKey ? `****${c.apiKey.slice(-4)}` : ''
    return { endpoint: c.endpoint, model: c.model, ready: c.ready, apiKeyMasked: maskedKey }
  })

  ipcMain.handle('agent:saveConfig', async (_, payload: { endpoint?: string; apiKey?: string; model?: string }) => {
    try {
      const now = Math.floor(Date.now() / 1000)
      const current = readConfig()
      const next = {
        endpoint: payload.endpoint || current.endpoint,
        apiKey: payload.apiKey || current.apiKey,
        model: payload.model || current.model,
      }
      getDb().prepare(`
        INSERT INTO app_preferences (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run(CONFIG_KEY, JSON.stringify(next), now)
      return { success: true }
    } catch (error) {
      log.error('[agent] saveConfig ERROR:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:testConnection', async () => {
    const result = await testConnection(readConfig())
    return result
  })

  ipcMain.handle('agent:analyzeHabits', async (_, payload: { profileId: string }) => {
    try {
      const { sessions, actions, reviews } = loadProfileData(payload.profileId)
      if (sessions.length < MIN_SESSIONS) {
        return fail('insufficient_data', `至少需要 ${MIN_SESSIONS} 场已结束训练，当前 ${sessions.length} 场`)
      }
      const indicators: HabitIndicators = computeHabitIndicators(actions, reviews, sessions, DEFAULT_HABIT_CONFIG)
      const db = getBlindDb()
      const id = `habit_${Date.now()}`
      const now = Math.floor(Date.now() / 1000)
      db.prepare(`
        INSERT INTO habits_profile (id, profile_id, computed_at, session_count, indicators_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, payload.profileId, now, sessions.length, JSON.stringify(indicators))
      const profile: HabitProfile = { id, profile_id: payload.profileId, computed_at: now, session_count: sessions.length, indicators }
      return ok(profile)
    } catch (error) {
      log.error('[agent] analyzeHabits ERROR:', error)
      return fail('analyze_failed', String(error))
    }
  })

  ipcMain.handle('agent:generateReport', async (_, payload: { profileId: string; habitProfileId?: string; force?: boolean }) => {
    try {
      const db = getBlindDb()
      // 1. 取 habit profile（指定 or 最新）
      let habitProfile: HabitProfile | null = null
      if (payload.habitProfileId) {
        const row = db.prepare('SELECT * FROM habits_profile WHERE id = ? LIMIT 1').get(payload.habitProfileId) as Omit<HabitProfile, 'indicators'> & { indicators_json: string } | undefined
        if (row) habitProfile = { ...row, indicators: JSON.parse(row.indicators_json) }
      } else {
        const row = db.prepare('SELECT * FROM habits_profile WHERE profile_id = ? ORDER BY computed_at DESC LIMIT 1').get(payload.profileId) as Omit<HabitProfile, 'indicators'> & { indicators_json: string } | undefined
        if (row) habitProfile = { ...row, indicators: JSON.parse(row.indicators_json) }
      }
      if (!habitProfile) {
        return fail('no_habit_profile', '请先生成习惯诊断')
      }

      // 2. 缓存命中（非 force）
      if (!payload.force) {
        const cached = db.prepare(`
          SELECT * FROM ai_reports WHERE habit_profile_id = ? ORDER BY created_at DESC LIMIT 1
        `).get(habitProfile.id) as Record<string, unknown> | undefined
        if (cached && !cached.error) {
          return ok(cached)
        }
      }

      // 3. 调 LLM
      const config = readConfig()
      if (!config.ready) return fail('not_configured', '请先在设置中配置 AI 助手')
      const { sessions, actions, reviews } = loadProfileData(payload.profileId)
      const repSessions = selectRepresentativeSessions(
        sessions.map(s => ({ id: s.id, stock_code: s.stock_code, stock_name: s.stock_name, interval_type: s.interval_type, realized_pnl: s.realized_pnl, status: s.status })),
        actions,
        reviews.map(r => ({ session_id: r.session_id, realized_pnl_pct: r.realized_pnl_pct, total_trades: r.total_trades, trade_win_rate: r.trade_win_rate }))
      )
      const messages = buildMessages(habitProfile, repSessions)
      const llmResult = await callLlm(config, messages)

      // 4. 解析 + 落库
      const parsed = parseReportResponse(llmResult.content)
      const reportId = `report_${Date.now()}`
      const now = Math.floor(Date.now() / 1000)
      const errorStr = !llmResult.ok ? llmResult.error : parsed.error
      db.prepare(`
        INSERT INTO ai_reports (id, profile_id, habit_profile_id, report_json, raw_response, model, prompt_tokens, completion_tokens, duration_ms, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reportId, payload.profileId, habitProfile.id,
        JSON.stringify(parsed.report),
        llmResult.content || null,
        config.model,
        llmResult.promptTokens, llmResult.completionTokens, llmResult.durationMs,
        errorStr
      )
      const record = db.prepare('SELECT * FROM ai_reports WHERE id = ?').get(reportId)
      if (!llmResult.ok) return fail(llmResult.error || 'llm_failed', `LLM 调用失败：${llmResult.error}`)
      return ok(record)
    } catch (error) {
      log.error('[agent] generateReport ERROR:', error)
      return fail('generate_failed', String(error))
    }
  })

  ipcMain.handle('agent:listReports', async (_, payload: { profileId: string; limit?: number }) => {
    const db = getBlindDb()
    const limit = payload.limit ?? 20
    return db.prepare(`
      SELECT * FROM ai_reports WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(payload.profileId, limit)
  })

  ipcMain.handle('agent:getHabitHistory', async (_, payload: { profileId: string; limit?: number }) => {
    const db = getBlindDb()
    const limit = payload.limit ?? 20
    const rows = db.prepare(`
      SELECT * FROM habits_profile WHERE profile_id = ? ORDER BY computed_at DESC LIMIT ?
    `).all(payload.profileId, limit) as Array<Omit<HabitProfile, 'indicators'> & { indicators_json: string }>
    return rows.map(r => ({ ...r, indicators: JSON.parse(r.indicators_json) }))
  })
}
```

- [ ] **Step 2: 在 blind.ts 末尾注册**

Modify `src/main/ipc/blind.ts`：在文件顶部 import 区追加：
```typescript
import { registerAgentIpc } from './agentIpc'
```
在 `registerBlindIpc` 函数体**最末尾**（最后一个 `ipcMain.handle` 之后、`}` 之前）追加：
```typescript
  registerAgentIpc()
```

- [ ] **Step 3: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 4: 手动启动验证 IPC 注册无错**

Run: `npm run dev`（启动后看主进程日志无重复注册 / 无 handler 冲突，可立即关闭）
Expected: 无 `Attempted to register a second handler` 错误

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/agentIpc.ts src/main/ipc/blind.ts
git commit -m "feat(agent): agentIpc 7 个 IPC handler 注册

getConfig/saveConfig/testConnection/analyzeHabits/generateReport/listReports/getHabitHistory。
blind.ts 仅追加一行 registerAgentIpc() 调用。"
```

---

## Task 7：preload + global.d.ts 桥接

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/types/global.d.ts`

**Why:** 渲染进程访问 agent IPC。

- [ ] **Step 1: preload 追加 agent 命名空间**

Modify `src/preload/index.ts`，在 `electronAPI` 对象内（紧接 `data: { ... }` 之后、`onTrainingLog` 之前）追加：
```typescript
  agent: {
    getConfig: (): Promise<{ endpoint: string; model: string; ready: boolean; apiKeyMasked: string }> =>
      invoke('agent:getConfig'),
    saveConfig: (config: { endpoint?: string; apiKey?: string; model?: string }): Promise<{ success: boolean; error?: string }> =>
      invoke('agent:saveConfig', config),
    testConnection: (): Promise<{ ok: boolean; latencyMs: number; error: string | null }> =>
      invoke('agent:testConnection'),
    analyzeHabits: (profileId: string): Promise<unknown> =>
      invoke('agent:analyzeHabits', { profileId }),
    generateReport: (req: { profileId: string; habitProfileId?: string; force?: boolean }): Promise<unknown> =>
      invoke('agent:generateReport', req),
    listReports: (profileId: string, limit?: number): Promise<unknown[]> =>
      invoke('agent:listReports', { profileId, limit }),
    getHabitHistory: (profileId: string, limit?: number): Promise<unknown[]> =>
      invoke('agent:getHabitHistory', { profileId, limit }),
  },
```

- [ ] **Step 2: global.d.ts 追加类型**

Modify `src/types/global.d.ts`，在 `data?: {...}` 之后、`onTrainingLog?` 之前追加：
```typescript
      agent?: {
        getConfig: () => Promise<{ endpoint: string; model: string; ready: boolean; apiKeyMasked: string }>
        saveConfig: (config: { endpoint?: string; apiKey?: string; model?: string }) => Promise<{ success: boolean; error?: string }>
        testConnection: () => Promise<{ ok: boolean; latencyMs: number; error: string | null }>
        analyzeHabits: (profileId: string) => Promise<unknown>
        generateReport: (req: { profileId: string; habitProfileId?: string; force?: boolean }) => Promise<unknown>
        listReports: (profileId: string, limit?: number) => Promise<unknown[]>
        getHabitHistory: (profileId: string, limit?: number) => Promise<unknown[]>
      }
```

- [ ] **Step 3: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/types/global.d.ts
git commit -m "feat(agent): preload agent 命名空间 + global.d.ts 类型"
```

---

## Task 8：设置面板组件 AiAdvisorSettings

**Files:**
- Create: `src/components/trading/blind-workbench/AiAdvisorSettings.tsx`

**Why:** spec §5.3。endpoint/key/model 配置 + 测试连接。

- [ ] **Step 1: 创建组件**

Create `src/components/trading/blind-workbench/AiAdvisorSettings.tsx`:
```typescript
import { useEffect, useState } from 'react'

interface AiAdvisorSettingsProps {
  onSaved?: () => void
}

export default function AiAdvisorSettings({ onSaved }: AiAdvisorSettingsProps) {
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [ready, setReady] = useState(false)
  const [masked, setMasked] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const cfg = await window.electronAPI?.agent?.getConfig()
      if (cfg) {
        setEndpoint(cfg.endpoint)
        setModel(cfg.model)
        setReady(cfg.ready)
        setMasked(cfg.apiKeyMasked)
      }
    })()
  }, [])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      if (apiKey) {
        await window.electronAPI?.agent?.saveConfig({ endpoint, apiKey, model })
      }
      const r = await window.electronAPI?.agent?.testConnection()
      setTestResult(r?.ok ? `连接成功（${r.latencyMs}ms）` : `失败：${r?.error ?? '未知'}`)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.electronAPI?.agent?.saveConfig({ endpoint, apiKey, model })
      const cfg = await window.electronAPI?.agent?.getConfig()
      if (cfg) {
        setReady(cfg.ready)
        setMasked(cfg.apiKeyMasked)
      }
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ai-advisor-settings">
      <div className="ai-advisor-settings-row">
        <label>Endpoint</label>
        <input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://open.bigmodel.cn/api/anthropic/v1/messages" />
      </div>
      <div className="ai-advisor-settings-row">
        <label>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={ready ? `已配置 ${masked}（留空则不修改）` : '输入 API Key'}
        />
      </div>
      <div className="ai-advisor-settings-row">
        <label>Model</label>
        <input value={model} onChange={e => setModel(e.target.value)} placeholder="glm-4.7" />
      </div>
      <div className="ai-advisor-settings-actions">
        <button onClick={handleTest} disabled={testing || (!apiKey && !ready)}>
          {testing ? '测试中...' : '测试连接'}
        </button>
        <button onClick={handleSave} disabled={saving || !endpoint || !model}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      {testResult && <div className="ai-advisor-settings-test-result">{testResult}</div>}
      {!ready && (
        <div className="ai-advisor-settings-warning">
          ⚠️ AI 教练将向 {endpoint || '配置的 endpoint'} 发送你的脱敏训练记录（含已结束 session 的股票代码与动作序列）。配置即视为同意。
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/trading/blind-workbench/AiAdvisorSettings.tsx
git commit -m "feat(agent): AiAdvisorSettings 配置面板组件"
```

---

## Task 9：主页面 AIHabitAdvisor

**Files:**
- Create: `src/components/trading/AIHabitAdvisor.tsx`

**Why:** spec §5.2。本地指标区 + AI 报告卡 + 趋势 + 错误分支。

- [ ] **Step 1: 创建组件**

Create `src/components/trading/AIHabitAdvisor.tsx`:
```typescript
import { useEffect, useState, useCallback } from 'react'
import AiAdvisorSettings from './blind-workbench/AiAdvisorSettings'
import type { HabitIndicators } from '../types/agent'

interface HabitProfileRecord {
  id: string
  computed_at: number
  session_count: number
  indicators: HabitIndicators
}

interface ReportRecord {
  id: string
  report_json: string
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  duration_ms: number | null
  error: string | null
  created_at: number
}

const isPlatformOk = (r: unknown): r is { data: unknown } =>
  typeof r === 'object' && r !== null && (r as { success?: boolean }).success === true

const unwrap = <T,>(r: unknown): T | null => (isPlatformOk(r) ? ((r as { data: T }).data) : null)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`
const fmtNum = (n: number) => n.toFixed(2)

export default function AIHabitAdvisor() {
  const [profileId, setProfileId] = useState<string>('default')
  const [configReady, setConfigReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [habit, setHabit] = useState<HabitProfileRecord | null>(null)
  const [history, setHistory] = useState<HabitProfileRecord[]>([])
  const [report, setReport] = useState<ReportRecord | null>(null)
  const [loadingHabit, setLoadingHabit] = useState(false)
  const [loadingReport, setLoadingReport] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)

  const loadInit = useCallback(async () => {
    const active = await window.electronAPI?.profile?.getActive() as { id?: string } | undefined
    if (active?.id) setProfileId(active.id)
    const cfg = await window.electronAPI?.agent?.getConfig()
    setConfigReady(Boolean(cfg?.ready))
    const hist = await window.electronAPI?.agent?.getHabitHistory(active?.id ?? 'default', 10)
    const histArr = (hist ?? []) as HabitProfileRecord[]
    setHistory(histArr)
    if (histArr.length > 0) {
      setHabit(histArr[0])
      const reports = await window.electronAPI?.agent?.listReports(active?.id ?? 'default', 1)
      const repArr = (reports ?? []) as ReportRecord[]
      if (repArr.length > 0 && !repArr[0].error) setReport(repArr[0])
    }
  }, [])

  useEffect(() => { void loadInit() }, [loadInit])

  const handleAnalyze = async () => {
    setLoadingHabit(true)
    setError(null)
    try {
      const r = await window.electronAPI?.agent?.analyzeHabits(profileId)
      const data = unwrap<HabitProfileRecord>(r)
      if (data) {
        setHabit(data)
        const hist = await window.electronAPI?.agent?.getHabitHistory(profileId, 10)
        setHistory((hist ?? []) as HabitProfileRecord[])
      } else {
        setError((r as { error?: { message?: string } })?.error?.message ?? '分析失败')
      }
    } finally {
      setLoadingHabit(false)
    }
  }

  const handleGenerateReport = async (force: boolean) => {
    if (!habit) return
    setLoadingReport(true)
    setReportError(null)
    try {
      const r = await window.electronAPI?.agent?.generateReport({
        profileId,
        habitProfileId: habit.id,
        force,
      })
      const data = unwrap<ReportRecord>(r)
      if (data) {
        setReport(data)
      } else {
        setReportError((r as { error?: { message?: string } })?.error?.message ?? '生成失败')
      }
    } finally {
      setLoadingReport(false)
    }
  }

  const prevHabit = history.length > 1 ? history[1] : null
  const trend = (key: 'chase_high_rate' | 'result_group') => {
    if (!prevHabit || !habit) return null
    if (key === 'result_group') {
      const d = habit.indicators.result_group.win_rate - prevHabit.indicators.result_group.win_rate
      return d
    }
    return habit.indicators[key] - prevHabit.indicators[key]
  }

  const parsedReport = report ? (() => {
    try { return JSON.parse(report.report_json) } catch { return null }
  })() : null

  return (
    <div className="ai-habit-advisor">
      <div className="ai-habit-advisor-toolbar">
        {prevHabit && habit && (
          <div className="ai-habit-advisor-trend">
            {trend('chase_high_rate') !== null && (
              <span>追涨率 {trend('chase_high_rate')! > 0 ? '▲' : '▼'} {fmtPct(Math.abs(trend('chase_high_rate')!))} </span>
            )}
            {trend('result_group') !== null && (
              <span>胜率 {trend('result_group')! > 0 ? '▲' : '▼'} {fmtPct(Math.abs(trend('result_group')!))}</span>
            )}
            <span className="ai-habit-advisor-trend-label">vs 上次</span>
          </div>
        )}
        <button onClick={handleAnalyze} disabled={loadingHabit}>
          {loadingHabit ? '分析中...' : habit ? '重新分析' : '生成诊断'}
        </button>
        <button
          onClick={() => handleGenerateReport(true)}
          disabled={loadingReport || !habit || !configReady}
        >
          {loadingReport ? '生成报告中...' : '生成 AI 报告'}
        </button>
        <button onClick={() => setShowSettings(s => !s)}>
          {showSettings ? '收起配置' : 'AI 配置'}
        </button>
      </div>

      {showSettings && <AiAdvisorSettings onSaved={() => { void loadInit(); setShowSettings(false) }} />}

      {error && <div className="ai-habit-advisor-error">{error}</div>}
      {!configReady && !showSettings && (
        <div className="ai-habit-advisor-warning">
          ⚠️ 未配置 AI 助手，无法生成 AI 报告（本地指标仍可查看）。
          <button onClick={() => setShowSettings(true)}>去配置</button>
        </div>
      )}

      {habit && (
        <section className="ai-habit-advisor-indicators">
          <h3>习惯指标（基于 {habit.session_count} 场训练）</h3>
          <div className="ai-habit-advisor-indicator-grid">
            <div className="ai-habit-card"><span>追涨率</span><strong>{fmtPct(habit.indicators.chase_high_rate)}</strong></div>
            <div className="ai-habit-card"><span>倒金字塔加仓率</span><strong>{fmtPct(habit.indicators.inverse_pyramid_rate)}</strong></div>
            <div className="ai-habit-card"><span>止损纪律</span><strong>{fmtPct(habit.indicators.stop_loss_discipline)}</strong></div>
            <div className="ai-habit-card"><span>盈亏比</span><strong>{fmtNum(habit.indicators.profit_loss_ratio)}</strong></div>
            <div className="ai-habit-card"><span>止盈过早/过晚比</span><strong>{fmtNum(habit.indicators.profit_taking_timing)}</strong></div>
            <div className="ai-habit-card"><span>平均持仓 bars</span><strong>{fmtNum(habit.indicators.avg_holding_bars)}</strong></div>
            <div className="ai-habit-card"><span>单笔仓位占比中位数</span><strong>{fmtPct(habit.indicators.avg_position_ratio)}</strong></div>
            <div className="ai-habit-card">
              <span>胜率 / 平均盈亏 / 最大回撤 / 连损场次</span>
              <strong>
                {fmtPct(habit.indicators.result_group.win_rate)} / {fmtPct(habit.indicators.result_group.avg_pnl_pct)} /{' '}
                {fmtPct(habit.indicators.result_group.max_drawdown_pct)} / {habit.indicators.result_group.max_loss_streak}
              </strong>
            </div>
          </div>
        </section>
      )}

      {report && (
        <section className="ai-habit-advisor-report">
          <h3>AI 诊断报告</h3>
          <div className="ai-habit-advisor-report-meta">
            生成于 {new Date(report.created_at * 1000).toLocaleString('zh-CN')}
            {report.model ? ` · ${report.model}` : ''}
            {report.prompt_tokens != null ? ` · ${report.prompt_tokens + (report.completion_tokens ?? 0)} tokens` : ''}
          </div>
          {parsedReport && !('fallback_text' in parsedReport) ? (
            <>
              {parsedReport.strengths?.length > 0 && (
                <div className="ai-habit-report-section ai-habit-report-section--good">
                  <h4>✅ 优点</h4>
                  <ul>{parsedReport.strengths.map((s: { indicator: string; value: string; evidence: string; comment: string }, i: number) => (
                    <li key={i}><strong>{s.indicator} {s.value}</strong> — {s.evidence} {s.comment}</li>
                  ))}</ul>
                </div>
              )}
              {parsedReport.weaknesses?.length > 0 && (
                <div className="ai-habit-report-section ai-habit-report-section--warn">
                  <h4>⚠️ 缺点</h4>
                  <ul>{parsedReport.weaknesses.map((s: { indicator: string; value: string; evidence: string; comment: string }, i: number) => (
                    <li key={i}><strong>{s.indicator} {s.value}</strong> — {s.evidence} {s.comment}</li>
                  ))}</ul>
                </div>
              )}
              {parsedReport.bad_habits?.length > 0 && (
                <div className="ai-habit-report-section ai-habit-report-section--bad">
                  <h4>🎯 不良习惯</h4>
                  <ul>{parsedReport.bad_habits.map((h: { name: string; severity: string; trigger: string; fix: string; evidence_session?: string }, i: number) => (
                    <li key={i}><strong>{h.name}</strong> [{h.severity}] — 触发：{h.trigger}{h.evidence_session ? `（证据：${h.evidence_session}）` : ''} → 建议：{h.fix}</li>
                  ))}</ul>
                </div>
              )}
              {parsedReport.action_plan?.length > 0 && (
                <div className="ai-habit-report-section">
                  <h4>📋 改善计划</h4>
                  <ol>{parsedReport.action_plan.map((a: { priority: number; action: string; rationale: string; expected_impact?: string }, i: number) => (
                    <li key={i}><strong>{a.action}</strong> — {a.rationale}{a.expected_impact ? `（预期：${a.expected_impact}）` : ''}</li>
                  ))}</ol>
                </div>
              )}
            </>
          ) : parsedReport && 'fallback_text' in parsedReport ? (
            <pre className="ai-habit-advisor-fallback">{parsedReport.fallback_text}</pre>
          ) : (
            <div className="ai-habit-advisor-error">报告解析失败，原始内容见日志</div>
          )}
        </section>
      )}
      {reportError && <div className="ai-habit-advisor-error">{reportError}</div>}
    </div>
  )
}
```

- [ ] **Step 2: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/trading/AIHabitAdvisor.tsx
git commit -m "feat(agent): AIHabitAdvisor 主页面（指标卡 + AI 报告 + 趋势 + 错误分支）"
```

---

## Task 10：挂载到 App.tsx（最后一步打通）

**Files:**
- Modify: `src/App.tsx`

**Why:** spec §5.1。第 4 个模块路由。这是唯一影响应用 shell 的改动。

- [ ] **Step 1: 加 lazy import 与类型**

Modify `src/App.tsx`，在现有 lazy import 区（`const DataManagement = lazy(...)` 之后）追加：
```typescript
const AIHabitAdvisor = lazy(() => import('./components/trading/AIHabitAdvisor'))
```
把 `type AppModule = 'overview' | 'blind' | 'data'` 改为：
```typescript
type AppModule = 'overview' | 'blind' | 'data' | 'agent'
```

- [ ] **Step 2: MODULE_GROUPS 加模块定义**

在 `'人的训练'` 分组的 `modules` 数组末尾（`blind` 之后）追加：
```typescript
      {
        id: 'agent' as AppModule,
        label: 'AI 交易教练',
        category: '习惯诊断',
        summary: '解析训练记录，识别交易优缺点与不良习惯，给出改善计划。',
        outcome: '把统计指标变成可执行的实战改进清单。',
        focus: ['习惯指标', 'AI 诊断', '改善计划']
      },
```

- [ ] **Step 3: renderModule 加分支**

在 `renderModule` 函数内，紧接 `if (activeModule === 'blind') {...}` 之后追加：
```typescript
  if (activeModule === 'agent') {
    return (
      <Suspense fallback={<WorkspaceFallback label="AI 交易教练" />}>
        <AIHabitAdvisor />
      </Suspense>
    )
  }
```

- [ ] **Step 4: tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 无错误

- [ ] **Step 5: 启动 app 端到端验证（手动）**

Run: `npm run dev`

验证清单（在 app 内逐项点击）：
- 左侧导航出现「AI 交易教练」第 4 个模块，归在「人的训练」分组
- 点击进入 → 看到空状态（无训练数据时）或习惯指标卡（有数据时）
- 现有 3 个模块（训练总览/盲训工作台/数据管理）切换正常、无报错
- 点击「AI 配置」→ 填 endpoint/key/model → 测试连接 → 保存
- 点「生成诊断」→ 看到 8 个指标卡
- 点「生成 AI 报告」→ 看到报告卡（需已配置 key 且有 ≥3 场已结束训练）
- 网络断开时点「生成 AI 报告」→ 看到错误提示，本地指标仍在

Expected: 全部通过

- [ ] **Step 6: 跑全部单测**

Run: `npm test`
Expected: 16 passed（habit-analyzer 9 + ai-advisor 7）

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(agent): 挂载 AI 交易教练模块到应用 shell

第 4 个 AppModule 'agent'，归入「人的训练」分组。"
```

---

## Task 11：git 同步（最后）

**Files:** 无（仅 git 操作）

- [ ] **Step 1: 确认工作区干净**

Run: `git status`
Expected: `nothing to commit, working tree clean`

- [ ] **Step 2: 推送到 origin**

Run: `git push origin main`
Expected: 推送成功（若网络问题，参考 spec 提交时的诊断：本机需代理访问 github.com）

- [ ] **Step 3: 验证远端同步**

Run: `git log origin/main..HEAD`
Expected: 无输出（本地与远端一致）

---

## 回归测试清单（每个任务后都该跑）

- [ ] `npx tsc -b --noEmit` 无错误
- [ ] `npm test` 全绿（Task 0 之后）
- [ ] 现有 3 个模块在 `npm run dev` 下切换无报错（Task 10 重点验证）

---

## 风险点（执行时留意）

1. **Task 3 止损纪律降级算法**：依赖 `pairBuySell` 的 FIFO 配对，如果 session 内有多次 buy/sell 交错的复杂序列，配对可能不准。这是已知降级，spec §2.3 已标注。
2. **Task 6 LLM 调用**：智谱 Anthropic 兼容接口的响应结构假设 `content[0].text`。若实际返回不同（如 reasoning model 多字段），需在 ai-client.ts 调整解析。建议 Task 10 端到端验证时先确认一次真实响应结构。
3. **Task 9 PlatformResult 解包**：`unwrap` 用 `success === true` 判断；后端用 `ok()`/`fail()`，结构对齐。
4. **AGENTS.md §3 "不上传用户数据"**：本方案明确放宽（用户已批准，首次配置有警示）。但只发已结束 session + 不发原始 K 线 + 不发初始资金绝对值，是硬边界。
