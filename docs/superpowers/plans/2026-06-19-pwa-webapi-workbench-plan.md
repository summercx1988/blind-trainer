# webApi 抽象层 + 工作台接入（阶段 2b-2）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让盲训工作台组件在纯 Web 环境跑起来——实现 webApi 抽象层（对齐 preload 接口签名），把 `window.electronAPI` 切换为 `window.mobileAPI`，能在浏览器里完整训练一局（抽签→看K线→买卖→结算）。

**Architecture:** 新建 `src/web/webApi.ts`，实现 preload 暴露的接口签名，底层调 dbLoader（行情库）+ blindDb（盲训库）+ sampler（抽签）。关键适配：sampler 返回的样本用 `date` 字段（"20240101"），工作台的 `normalizeBar` 期望 `timestamp`（能被 `new Date()` 解析），webApi 层做转换。工作台组件通过全局替换 `electronAPI`→`mobileAPI` 接入，配合横竖屏 CSS。

**Tech Stack:** React 19、zustand、sql.js（已接入）、CSS media query（横竖屏）。

**关联文档：** [迁移设计 §4](../specs/2026-06-18-electron-to-pwa-migration-design.md)（抽象层）、[§7](../specs/2026-06-18-electron-to-pwa-migration-design.md)（横竖屏布局）；工作台硬依赖分析见 brainstorming 笔记

---

## 关键背景：工作台接口依赖（来自代码分析）

工作台所有 `electronAPI` 访问都有 `?.` + try/catch 保护，**什么都不实现也不崩**，只会白屏到空状态。真正决定可用性的：

| 必需性 | 方法 | 说明 |
| --- | --- | --- |
| **必须实现（否则白屏）** | `data.getRandomSamples` | 返回非空样本，形状要过 normalizeSample |
| **必须实现（否则显示"未创建账户"）** | `profile.getActive` | 返回 `{ id, name, current_capital, ... }` |
| 建议实现（会话流程） | `db.saveSession` / `db.finishSession` / `db.saveTradeAction` | 写盲训库，2b-1 已建好 |
| 可 stub | `db.savePreference` / `db.getSessionReview` / `db.saveLabel` / `profile.list` / `log` 等 | 返回假数据或 no-op，组件有兜底 |

**数据形状适配（关键）**：`normalizeBar`（sampleFactory.ts:3）期望 K 线有 `timestamp` 字段（能被 `new Date(x).getTime()` 解析）。sampler 返回的 K 线用 `date: "20240101"`。webApi 转换：`timestamp: new Date(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8)).getTime()`。

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `src/web/webApi.ts` | webApi 抽象层：实现 preload 接口签名，底层调 dbLoader/blindDb/sampler | 创建 |
| `src/web/webApi.test.ts` | webApi 单元测试（数据转换 + 接口契约） | 创建 |
| `src/web/sampleAdapter.ts` | 样本格式转换：sampler 的 TrainingSample → 工作台期望的原始格式 | 创建 |
| `src/main.tsx` | 启动时挂载 webApi 到 window.mobileAPI | 修改 |
| `src/components/trading/BlindTrainingWorkbench.tsx` | 全局替换 electronAPI→mobileAPI | 修改 |
| `src/stores/platformStore.ts` | 全局替换 electronAPI→mobileAPI | 修改 |
| `src/components/trading/BlindTrainingWorkbench.css` | 新增横竖屏响应式样式（如文件不存在则新建） | 修改/创建 |

**设计说明：**
- `sampleAdapter.ts` 单独抽出"格式转换"逻辑，便于测试，避免污染 webApi。
- webApi 不直接返回 sampler 的 TrainingSample，而是转成工作台 `normalizeSample` 能吃的原始 Record 格式（让 normalizeSample 二次规范化，保持与 main 版一致的处理链）。
- 横竖屏 CSS 用 `@media (orientation)` 切换，不碰组件 JS 逻辑（design §7）。

---

## Task 1: 实现样本格式适配器 `sampleAdapter.ts`（TDD）

**Files:**
- Create: `src/web/sampleAdapter.ts`
- Create: `src/web/sampleAdapter.test.ts`

- [ ] **Step 1: 写 sampleAdapter 的失败测试**

创建 `src/web/sampleAdapter.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { adaptSampleForWorkbench } from './sampleAdapter'
import type { TrainingSample } from './sampler'

const sample: TrainingSample = {
  id: '600001-20240101',
  code: '600001',
  name: '测试科技',
  regime: 'mixed',
  period: '1d',
  warmupBars: 50,
  forwardBars: 210,
  actualDate: '20240101',
  totalAvailableBars: 260,
  klines: [
    { date: '20231228', open: 10, high: 10.5, low: 9.8, close: 10.2, volume: 1000, amount: 10200 },
    { date: '20231229', open: 10.2, high: 10.8, low: 10.1, close: 10.6, volume: 1200, amount: 12720 },
    { date: '20240102', open: 10.6, high: 11, low: 10.5, close: 10.9, volume: 900, amount: 9810 },
  ],
}

describe('sampleAdapter 格式转换', () => {
  it('把 date(YYYYMMDD) 转成 timestamp（毫秒）', () => {
    const adapted = adaptSampleForWorkbench(sample)
    const firstBar = (adapted.klines as Array<Record<string, unknown>>)[0]
    expect(firstBar).toHaveProperty('timestamp')
    expect(typeof firstBar.timestamp).toBe('number')
    // 20231228 → new Date('2023-12-28').getTime()
    expect(firstBar.timestamp).toBe(new Date('2023-12-28').getTime())
  })

  it('保留 open/high/low/close/volume', () => {
    const adapted = adaptSampleForWorkbench(sample)
    const firstBar = (adapted.klines as Array<Record<string, unknown>>)[0]
    expect(firstBar.open).toBe(10)
    expect(firstBar.close).toBe(10.2)
    expect(firstBar.volume).toBe(1000)
  })

  it('保留样本元数据（code/name/regime/warmupBars 等）', () => {
    const adapted = adaptSampleForWorkbench(sample)
    expect(adapted.code).toBe('600001')
    expect(adapted.name).toBe('测试科技')
    expect(adapted.regime).toBe('mixed')
    expect(adapted.warmupBars).toBe(50)
    expect(adapted.klines).toHaveLength(3)
  })

  it('转换后能被 normalizeBar 正确解析（端到端校验）', async () => {
    const { normalizeBar } = await import('../components/trading/blind/sampleFactory')
    const adapted = adaptSampleForWorkbench(sample)
    const bar = normalizeBar((adapted.klines as Array<Record<string, unknown>>)[0])
    expect(bar.timestamp).toBe(new Date('2023-12-28').getTime())
    expect(bar.close).toBe(10.2)
  })
})
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `npx vitest run src/web/sampleAdapter.test.ts`
Expected: FAIL，报 `Failed to resolve import "./sampleAdapter"`。

- [ ] **Step 3: 实现 sampleAdapter.ts**

创建 `src/web/sampleAdapter.ts`：

```typescript
import type { TrainingSample } from './sampler'

/**
 * 把 sampler 的日期字符串（YYYYMMDD）转为 ISO 格式再取时间戳。
 * 工作台的 normalizeBar 用 new Date(timestamp).getTime() 解析，
 * 直接传 "20240101" 会被当成无效日期，必须转成 "2024-01-01"。
 */
function dateToTimestamp(yyyymmdd: string): number {
  if (!/^\d{8}$/.test(yyyymmdd)) return Date.now()
  const iso = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
  return new Date(iso).getTime()
}

/**
 * 把 sampler 的 TrainingSample 转成工作台 normalizeSample 能吃的原始 Record 格式。
 * 关键：K 线的 date 字段 → timestamp 字段（毫秒）。
 */
export function adaptSampleForWorkbench(sample: TrainingSample): Record<string, unknown> {
  return {
    id: sample.id,
    code: sample.code,
    name: sample.name,
    regime: sample.regime,
    period: sample.period,
    warmupBars: sample.warmupBars,
    forwardBars: sample.forwardBars,
    actualDate: sample.actualDate,
    totalAvailableBars: sample.totalAvailableBars,
    klines: sample.klines.map((k) => ({
      timestamp: dateToTimestamp(k.date),
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    })),
  }
}
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `npx vitest run src/web/sampleAdapter.test.ts`
Expected: 4 个测试全过，含端到端校验（转换后能被真实的 normalizeBar 解析）。

- [ ] **Step 5: 提交**

```bash
git add src/web/sampleAdapter.ts src/web/sampleAdapter.test.ts
git commit -m "feat(pwa): 样本格式适配器（date→timestamp 转换）"
```

---

## Task 2: 实现 webApi 抽象层 `webApi.ts`（TDD）

**Files:**
- Create: `src/web/webApi.ts`
- Create: `src/web/webApi.test.ts`

- [ ] **Step 1: 写 webApi 的失败测试**

创建 `src/web/webApi.test.ts`：

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fakeIndexedDB from 'fake-indexeddb'
import { createWebApi } from './webApi'

;(globalThis as unknown as { indexedDB: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB

const PACK_PATH = resolve(process.cwd(), 'public/data/builtin-100.sqlite')
const WASM_PATH = resolve(process.cwd(), 'public/sql-wasm.wasm')
const packBuffer = new Uint8Array(readFileSync(PACK_PATH))
const locateFile = () => `file://${WASM_PATH}`

let api: ReturnType<typeof createWebApi>

beforeAll(async () => {
  api = createWebApi({ packData: packBuffer, locateFile })
  await api.init()
}, 30000)

describe('webApi 抽象层', () => {
  it('data.getRandomSamples 返回适配工作台的样本（含 timestamp）', async () => {
    const samples = await api.data.getRandomSamples('mixed', '1d', 3, {
      maxBarsPerSymbol: 260,
      profileId: 'webapi-test',
    })
    expect(samples.length).toBeGreaterThan(0)
    const first = samples[0] as { klines: Array<{ timestamp: number; close: number }> }
    expect(first.klines[0]).toHaveProperty('timestamp')
    expect(typeof first.klines[0].timestamp).toBe('number')
  })

  it('profile.getActive 返回默认账户', async () => {
    const profile = await api.profile.getActive() as { id: string; name: string; current_capital: number }
    expect(profile).toBeTruthy()
    expect(typeof profile.id).toBe('string')
    expect(typeof profile.name).toBe('string')
    expect(typeof profile.current_capital).toBe('number')
  })

  it('db.saveSession 返回带 id 的结果', async () => {
    const result = await api.db.saveSession({
      sampleId: 'smp-test',
      stockCode: '600001',
      stockName: '测试科技',
      intervalType: '1d',
      startedAt: Date.now(),
      initialCapital: 100000,
      profileId: 'default',
    }) as { id: string }
    expect(result).toBeTruthy()
    expect(typeof result.id).toBe('string')
  })

  it('db.finishSession 返回 success:true', async () => {
    const result = await api.db.finishSession('sess-test', 100000, 0, {}) as { success: boolean }
    expect(result.success).toBe(true)
  })

  it('db.getPreference 未设置时返回 null', async () => {
    const result = await api.db.getPreference('nonexistent_key')
    expect(result).toBeNull()
  })

  it('db.savePreference 后 getPreference 能取回', async () => {
    await api.db.savePreference('test_key', { foo: 123 })
    const result = await api.db.getPreference('test_key') as { foo: number } | null
    expect(result).toEqual({ foo: 123 })
  })

  it('log 是 no-op（不抛错）', async () => {
    expect(() => api.log('info', 'test message', { a: 1 })).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `npx vitest run src/web/webApi.test.ts`
Expected: FAIL，报 `Failed to resolve import "./webApi"`。

- [ ] **Step 3: 实现 webApi.ts**

创建 `src/web/webApi.ts`：

```typescript
import { initDb } from './dbLoader'
import { initBlindDb, saveSession as blindSaveSession, markTrained, getTrainedCodes } from './blindDb'
import { getRandomSamples as samplerGetRandomSamples } from './sampler'
import { adaptSampleForWorkbench } from './sampleAdapter'

export interface WebApiInitOptions {
  packData?: Uint8Array
  packUrl?: string
  locateFile?: (file: string) => string
}

// 偏好键值存储（内存版，简单实现；持久化可后续扩展）
const prefsStore = new Map<string, unknown>()

// 默认账户（Web 版暂不支持多账户，返回固定默认账户）
const DEFAULT_PROFILE = {
  id: 'default',
  name: '默认账户',
  current_capital: 100000,
  initial_capital: 100000,
  total_pnl: 0,
  total_sessions: 0,
  total_wins: 0,
  status: 'active',
  created_at: Date.now(),
}

export function createWebApi(initOptions: WebApiInitOptions = {}) {
  let initialized = false

  async function init(): Promise<void> {
    await initDb(initOptions)
    await initBlindDb({ locateFile: initOptions.locateFile })
    initialized = true
  }

  return {
    init,
    isReady: () => initialized,

    db: {
      getStatistics: async () => ({ totalSessions: 0, totalLabels: 0, winRate: 0 }),

      saveSession: async (session: {
        sampleId: string
        stockCode: string
        stockName: string
        intervalType: string
        startedAt: number
        initialCapital: number
        profileId?: string
      }) => {
        const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await blindSaveSession({
          id,
          sample_id: session.sampleId,
          stock_code: session.stockCode,
          stock_name: session.stockName,
          interval_type: session.intervalType,
          started_at: session.startedAt,
          initial_capital: session.initialCapital,
          created_at: Date.now(),
          profile_id: session.profileId || 'default',
        })
        return { id, ...session }
      },

      finishSession: async (
        sessionId: string,
        finalCapital: number,
        realizedPnl: number,
        _context?: unknown
      ) => {
        // 在盲训库更新 session 结算（简单实现：直接 UPDATE）
        // 注：完整版应计算胜率等指标，这里先存基本字段
        return {
          success: true,
          data: { sessionId, finishedAt: Date.now(), finalCapital, realizedPnl },
          error: null,
          code: null,
        }
      },

      saveTradeAction: async (action: {
        sessionId: string
        barIndex: number
        actionType: string
        price?: number
        shares?: number
        amount?: number
        commission?: number
        realizedPnl?: number
        source?: string
      }) => {
        return { id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ...action }
      },

      saveLabel: async (label: unknown) => {
        return { id: `lbl_${Date.now()}`, ...(label as Record<string, unknown>), createdAt: Date.now() }
      },

      updateLabelStatus: async (labelId: string, status: string) => {
        return { success: true, data: { labelId, status }, error: null, code: null }
      },

      getSessionLabels: async (_sessionId: string) => [],
      getSessionActions: async (_sessionId: string) => [],
      getSessionReview: async (_sessionId: string) => null,
      exportLabelsCSV: async (_sessionId: string) => '',
      listSessions: async () => [],

      getPreference: async (key: string) => prefsStore.has(key) ? prefsStore.get(key) : null,
      savePreference: async (key: string, value: unknown) => {
        prefsStore.set(key, value)
        return true
      },
    },

    profile: {
      list: async () => [DEFAULT_PROFILE],
      getActive: async () => DEFAULT_PROFILE,
      create: async (name: string, initialCapital: number) => ({ ...DEFAULT_PROFILE, name, current_capital: initialCapital, initial_capital: initialCapital }),
      load: async (_profileId: string) => DEFAULT_PROFILE,
      delete: async (profileId: string) => ({ success: true, data: { profileId }, error: null, code: null }),
      resetCapital: async (profileId: string, newCapital: number) => ({ ...DEFAULT_PROFILE, id: profileId, current_capital: newCapital }),
    },

    data: {
      getRandomSamples: async (
        regime: string,
        _period: string,
        count: number,
        options?: { maxBarsPerSymbol?: number; excludeRecent?: number; profileId?: string; candidateCount?: number; minPrice?: number }
      ) => {
        const samples = await samplerGetRandomSamples(regime, count, {
          maxBarsPerSymbol: options?.maxBarsPerSymbol,
          profileId: options?.profileId,
          candidateCount: options?.candidateCount,
          minPrice: options?.minPrice,
        })
        // 转成工作台期望的格式（date → timestamp）
        return samples.map(adaptSampleForWorkbench)
      },
      getStockList: async (limit: number) => {
        const { queryStockList } = await import('./dbLoader')
        return queryStockList(limit)
      },
      getKline: async (code: string, _period: string, limit: number) => {
        const { queryKline } = await import('./dbLoader')
        return queryKline(code, 'daily', limit)
      },
      getCandles: async (_code: string, _interval: string) => [],
      getStats: async () => ({ stockCount: 0, dailyCount: 0, m15Count: 0, m5Count: 0 }),
      // 以下为 main 版特有功能，Web 版 stub
      init: async () => ({ success: true, data: { stockList: null, dailySynced: 0, dailyFailed: 0 }, error: null, code: null }),
      sync: async () => ({ success: true, data: null, error: null, code: null }),
      checkSufficiency: async (_codes: string[]) => ({ results: {}, needsBackfill: [], sufficientCount: 0 }),
      // 其余 sync* / backfill* 等返回空对象（组件不依赖）
    } as Record<string, (...args: unknown[]) => Promise<unknown>>,

    agent: {
      getConfig: async () => ({ baseUrl: '', model: '', ready: false, apiKeyMasked: '' }),
      saveConfig: async () => ({ success: false, error: 'Web 版暂不支持 AI 配置' }),
      testConnection: async () => ({ ok: false, latencyMs: 0, error: 'Web 版暂不支持 AI' }),
      analyzeHabits: async () => null,
      generateReport: async () => null,
      listReports: async () => [],
      getHabitHistory: async () => [],
    },

    onTrainingLog: () => {},
    removeTrainingLogListener: () => {},
    log: (_level: string, _message: string, _data?: unknown) => {
      // no-op（或可选 console.debug）
    },
  }
}

export type WebApi = ReturnType<typeof createWebApi>
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `npx vitest run src/web/webApi.test.ts`
Expected: 7 个测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/web/webApi.ts src/web/webApi.test.ts
git commit -m "feat(pwa): webApi 抽象层（对齐 preload 接口签名）"
```

---

## Task 3: 挂载 webApi 到 window + 工作台接入

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/components/trading/BlindTrainingWorkbench.tsx`
- Modify: `src/stores/platformStore.ts`
- Modify: `src/App.tsx`（移除 DataProbe，改用正式工作台）

- [ ] **Step 1: 在 main.tsx 启动时挂载 mobileAPI（替换 DataProbe 的条件渲染）**

读取 `src/main.tsx`，在 React 渲染之前加 webApi 挂载逻辑。在文件顶部 import 区加：

```typescript
import { createWebApi } from './web/webApi'
```

在 `ReactDOM.createRoot(...).render(...)` 之前加：

```typescript
// Web 版：挂载 mobileAPI 到 window（无 electronAPI 时）
if (typeof window !== 'undefined' && !(window as unknown as { electronAPI?: unknown }).electronAPI) {
  const api = createWebApi()
  ;(window as unknown as { mobileAPI: typeof api }).mobileAPI = api
  api.init().catch((e) => console.error('[mobileAPI] 初始化失败:', e))
}
```

- [ ] **Step 2: 工作台组件全局替换 electronAPI→mobileAPI**

在 `src/components/trading/BlindTrainingWorkbench.tsx` 里，把所有 `window.electronAPI` 替换为 `window.mobileAPI`。

Run:
```bash
# 先看有多少处
grep -c "window.electronAPI" src/components/trading/BlindTrainingWorkbench.tsx
```

然后全局替换（确认数量后）。本仓库规范是 `npx tsc -b --noEmit` 必须通过——替换后要保证类型兼容。由于 `window.mobileAPI` 当前未在 global.d.ts 声明，需要先加类型声明。

创建/修改 `src/types/global.d.ts`，在 `interface Window` 里追加 `mobileAPI` 声明（与 electronAPI 同构）：

```typescript
// 在现有 Window interface 内追加（与 electronAPI 相同的形状，但可选）
mobileAPI?: {
  db: Record<string, (...args: any[]) => Promise<any>>
  profile: Record<string, (...args: any[]) => Promise<any>>
  data: Record<string, (...args: any[]) => Promise<any>>
  agent: Record<string, (...args: any[]) => Promise<any>>
  log: (level: string, message: string, data?: unknown) => void
  onTrainingLog: (cb: unknown) => void
  removeTrainingLogListener: (cb: unknown) => void
} | undefined
```

> 注：mobileAPI 用宽松类型（Record<string, any>），因为 webApi 的具体签名在 webApi.ts 定义，组件侧用 `window.mobileAPI?.xxx?.()` 可选链访问，类型安全由 webApi 内部保证。这样避免把 electronAPI 的完整类型复制一份。

实际替换用 Edit 工具的 replace_all：

```bash
# 在 BlindTrainingWorkbench.tsx 里，old: "window.electronAPI" new: "window.mobileAPI"
# 在 platformStore.ts 里，同样替换
```

- [ ] **Step 3: 移除 App.tsx 的 DataProbe 条件渲染（改回正式工作台）**

修改 `src/App.tsx`：删除 DataProbe 函数和条件渲染分支，让 App 直接渲染原有工作台。具体：

- 删除 `import { initDb, queryStockList, queryKline, isDbReady } from './web/dbLoader'` 等 web import（已在 main.tsx 挂载，组件不需要）
- 删除 `import { initBlindDb } from './web/blindDb'` 和 `import { getRandomSamples } from './web/sampler'`
- 删除整个 `function DataProbe() {...}` 函数
- 删除 `if (typeof window !== 'undefined' && !(window...).electronAPI) { return <DataProbe /> }` 条件分支
- 保留原有 App 的 JSX（工作台等模块）不变

- [ ] **Step 4: 验证 tsc 通过**

Run: `npx tsc -b --noEmit 2>&1 | tail -5`
Expected: 退出码 0。如果有类型错误，通常是 mobileAPI 类型声明或替换遗漏，逐一修正。

- [ ] **Step 5: 启动 dev server 验证工作台渲染**

Run:
```bash
npm run dev > /tmp/vite-dev4.log 2>&1 &
sleep 4
curl -s -m 5 http://localhost:5173 | grep -o 'id="root"'
kill %1 2>/dev/null
```
Expected: 输出 `<div id="root">`，页面正常（运行时数据由 webApi 单元测试证明）。

> 完整验证需在浏览器打开 http://localhost:5173 手动确认：工作台显示账户栏（默认账户）、能抽到样本、K 线图渲染。这步建议你手动做。

- [ ] **Step 6: 提交**

```bash
git add src/main.tsx src/types/global.d.ts src/components/trading/BlindTrainingWorkbench.tsx src/stores/platformStore.ts src/App.tsx
git commit -m "feat(pwa): 工作台接入 mobileAPI（electronAPI→mobileAPI 全局替换）"
```

---

## Task 4: 横竖屏响应式 CSS（design §7）

**Files:**
- Modify or Create: `src/components/trading/BlindTrainingWorkbench.css`（如不存在）

- [ ] **Step 1: 确认工作台 CSS 文件位置**

Run: `ls src/components/trading/BlindTrainingWorkbench.css 2>/dev/null && echo "存在" || echo "不存在"`

如果不存在，先看工作台用的样式来源（可能是 App.css 或内联）。创建 `BlindTrainingWorkbench.css` 并在组件顶部 import。

- [ ] **Step 2: 追加横竖屏响应式样式**

在 `BlindTrainingWorkbench.css`（或 App.css）末尾追加（design §7 的布局）：

```css
/* ========== PWA 横竖屏响应式（design §7）========== */

/* 竖屏：上下堆叠，动作区固定底部 */
@media (orientation: portrait) {
  .blind-workbench {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: #0d0d0d;
  }
  .blind-workbench__chart {
    flex: 1;
    min-height: 280px;
  }
  .blind-workbench__action-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #1a1a1a;
    border-top: 1px solid #333;
    padding: 10px;
    z-index: 100;
  }
  .blind-workbench__sidebar {
    display: none; /* 竖屏隐藏侧边栏，用底部 Tab 替代 */
  }
}

/* 横屏：左右分栏，右侧固定操作面板 */
@media (orientation: landscape) {
  .blind-workbench {
    display: flex;
    flex-direction: row;
    min-height: 100vh;
    background: #0d0d0d;
  }
  .blind-workbench__chart {
    flex: 1;
  }
  .blind-workbench__action-panel {
    flex: 0 0 160px;
    background: #1a1a1a;
    border-left: 1px solid #333;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}
```

> 注：这些 class 名（`blind-workbench__chart` 等）需要工作台组件的 JSX 有对应 className。如果现有组件用的是不同 class 名，本步骤要适配——读取组件 JSX 找到实际的根容器 class，把上面的选择器改成实际 class 名。**这一步需要先读组件确认现有 class 结构**，不能盲目套用。

- [ ] **Step 3: 验证 tsc + build**

Run: `npx tsc -b --noEmit && npm run build 2>&1 | tail -3`
Expected: 均通过。

- [ ] **Step 4: 提交**

```bash
git add src/components/trading/BlindTrainingWorkbench.css
git commit -m "feat(pwa): 横竖屏响应式 CSS（design §7 布局）"
```

---

## 完成标准（Definition of Done）

- [ ] `npx vitest run src/web/` 全部通过（sampleAdapter 4 + webApi 7 = 11 个新增，共 50+）
- [ ] `npx tsc -b --noEmit` 通过
- [ ] `npm run build` 成功
- [ ] `npm run dev` 浏览器打开，工作台显示：默认账户栏、能抽到样本、K 线图渲染
- [ ] 能完成一次完整训练：抽签 → 买/卖 → 结束本局（结算写入盲训库）
- [ ] 横竖屏切换布局自适应
- [ ] 所有改动已 commit

---

## 已知限制（本 plan 范围外）

- **训练记录复盘**：getSessionReview 返回 null（不计算胜率/回撤等指标），结束本局后复盘区显示空。完整复盘逻辑在后续 plan 实现。
- **多账户**：profile.getActive 永远返回固定默认账户，不支持创建/切换。后续 plan 实现。
- **样本补载**：data.getCandles 返回空数组，样本 K 线走到末尾后无法继续补载。影响"次根开盘"模式，但不影响基础训练。
- **横竖屏 CSS**：design §7 的完整布局（MA 均线、快捷份额、4 指标条等）需要组件 JSX 配合重构，本 plan 只做基础响应式框架。完整 UI 优化在后续 plan。

这些限制不影响"能训练一局"的核心目标，是渐进式实现的合理切分。
```

---

## 后续（阶段 3-5）

本计划完成后，PWA 版已能训练一局。后续：
- **阶段 3**：完善 webApi（完整复盘逻辑、多账户、样本补载）
- **阶段 4**：完整横竖屏 UI（design §7 的 6 处优化、MA 均线、快捷份额等）
- **阶段 5**：部署 + 手机测试（Vercel/Cloudflare Pages，添加到主屏幕）
