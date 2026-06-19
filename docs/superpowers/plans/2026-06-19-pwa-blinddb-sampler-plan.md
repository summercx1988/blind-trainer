# 可写盲训库 + 零重复抽签（阶段 2b-1）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 版建立独立的可写盲训库（sessions/actions/trained_stocks），持久化到 IndexedDB，实现零重复抽签——能在网页上"从 builtin-100 随机抽一只还没训练过的股票，取它的 K 线段"。

**Architecture:** 现有 `dbLoader.ts` 管理只读行情库（builtin-100）。本计划新增 `blindDb.ts` 管理可写盲训库：启动时从 IndexedDB 加载（或新建空库），每次写操作后导出 snapshot 存回 IndexedDB。抽签逻辑 `getRandomSamples` 查行情库选股 + 查盲训库排除已训练股，SQL 逻辑参考 main 版 `data.ts:451` 但用 sql.js 重写。

**Tech Stack:** sql.js（已接入）、IndexedDB（已封装 idb.ts）、vitest + jsdom + fake-indexeddb。

**关联文档：** [迁移设计 §6.3](../specs/2026-06-18-electron-to-pwa-migration-design.md)（零重复抽签）、[§6.7](../specs/2026-06-18-electron-to-pwa-migration-design.md)（抽签 SQL）；main 版参考 `src/main/ipc/data.ts:451`、`src/main/blindDb.ts:25`

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `src/web/blindDb.ts` | 可写盲训库管理：建表、CRUD、snapshot 持久化 | 创建 |
| `src/web/blindDb.test.ts` | blindDb 单元测试 | 创建 |
| `src/web/sampler.ts` | 零重复抽签：行情库选股 + 盲训库排除 | 创建 |
| `src/web/sampler.test.ts` | 抽签逻辑测试（含零重复验证） | 创建 |
| `src/web/dbLoader.ts` | 导出行情库引用（供 sampler 查询） | 修改 |

**设计说明：**
- `blindDb.ts` 独立管理盲训库生命周期，与 `dbLoader.ts`（行情库）解耦。两者通过 `sampler.ts` 协同。
- 盲训库持久化策略：每次写操作（saveSession/addTrainedStock 等）后调用 `persist()`，把整个库导出为 Uint8Array 存 IndexedDB。读多写少场景下可接受（单次 snapshot ~几 KB）。
- `sampler.ts` 是 plan 2b-2 接入工作台的桥梁——它就是 `data.getRandomSamples` 的 Web 实现。

---

## Task 1: 实现盲训库管理 `blindDb.ts`（TDD）

**Files:**
- Create: `src/web/blindDb.ts`
- Create: `src/web/blindDb.test.ts`

- [ ] **Step 1: 写 blindDb 的失败测试**

创建 `src/web/blindDb.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import fakeIndexedDB from 'fake-indexeddb'
import {
  initBlindDb,
  saveSession,
  markTrained,
  getTrainedCodes,
  isBlindDbReady,
} from './blindDb'

;(globalThis as unknown as { indexedDB: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB

beforeEach(async () => {
  // 每个测试前重置盲训库（forceRefresh 强制新建空库）
  await initBlindDb({ forceRefresh: true })
})

describe('blindDb 盲训库管理', () => {
  it('initBlindDb 后 isBlindDbReady 为 true', async () => {
    await initBlindDb({ forceRefresh: true })
    expect(isBlindDbReady()).toBe(true)
  })

  it('saveSession 后能查到该 session', async () => {
    await saveSession({
      id: 'sess-1',
      sample_id: 'smp-1',
      stock_code: '600001',
      stock_name: '测试科技',
      interval_type: '1d',
      started_at: 1718000000,
      initial_capital: 100000,
      created_at: 1718000000,
      profile_id: 'default',
    })
    const trained = await getTrainedCodes('default')
    expect(trained).toContain('600001')
  })

  it('markTrained 独立标记已训练股', async () => {
    await markTrained('600002', 'default')
    const trained = await getTrainedCodes('default')
    expect(trained).toContain('600002')
  })

  it('不同 profile 的已训练股互不干扰', async () => {
    await markTrained('600001', 'profileA')
    await markTrained('600002', 'profileB')
    expect(await getTrainedCodes('profileA')).toEqual(['600001'])
    expect(await getTrainedCodes('profileB')).toEqual(['600002'])
  })

  it('持久化后重启能恢复（forceRefresh=false 从 IndexedDB 加载）', async () => {
    await markTrained('600999', 'default')
    // 模拟重启：再次 init 但不强制刷新
    await initBlindDb({ forceRefresh: false })
    const trained = await getTrainedCodes('default')
    expect(trained).toContain('600999')
  })
})
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `npx vitest run src/web/blindDb.test.ts`
Expected: FAIL，报 `Failed to resolve import "./blindDb"`。

- [ ] **Step 3: 实现 blindDb.ts**

创建 `src/web/blindDb.ts`：

```typescript
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { saveSnapshot, loadSnapshot } from './idb'

const IDB_NAME = 'blind-trainer'
const IDB_STORE = 'db-snapshots'
const IDB_KEY = 'blind-db'

let SQL: SqlJsStatic | null = null
let blindDb: Database | null = null

export interface BlindInitOptions {
  /** 强制新建空库，忽略 IndexedDB 缓存 */
  forceRefresh?: boolean
  /** sql.js wasm 定位（测试可覆盖） */
  locateFile?: (file: string) => string
}

export interface SaveSessionInput {
  id: string
  sample_id: string
  stock_code: string
  stock_name: string
  interval_type: string
  started_at: number
  initial_capital: number
  created_at: number
  profile_id: string
}

/**
 * 初始化盲训库：优先从 IndexedDB 加载，否则新建空库并建表。
 * 表结构对齐 main 版 blindDb.ts（training_sessions / trade_actions / trained_stocks）。
 */
export async function initBlindDb(options: BlindInitOptions = {}): Promise<void> {
  const { forceRefresh = false, locateFile = (file: string) => `/${file}` } = options

  if (!SQL) {
    SQL = await initSqlJs({ locateFile })
  }

  let buffer: Uint8Array | null = null
  if (!forceRefresh) {
    buffer = await loadSnapshot(IDB_NAME, IDB_STORE, IDB_KEY)
  }

  if (buffer) {
    if (blindDb) blindDb.close()
    blindDb = new SQL.Database(buffer)
  } else {
    if (blindDb) blindDb.close()
    blindDb = new SQL.Database()
    createTables(blindDb)
    await persist()
  }
}

function createTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS training_sessions (
      id TEXT PRIMARY KEY,
      sample_id TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      interval_type TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT DEFAULT 'active',
      initial_capital REAL NOT NULL,
      final_capital REAL,
      realized_pnl REAL,
      total_trades INTEGER DEFAULT 0,
      winning_trades INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      profile_id TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS trade_actions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      bar_index INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      price REAL,
      shares INTEGER,
      amount REAL,
      commission REAL,
      realized_pnl REAL,
      source TEXT DEFAULT 'manual',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trained_stocks (
      code TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      trained_at INTEGER NOT NULL,
      PRIMARY KEY (code, profile_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_profile ON training_sessions(profile_id);
    CREATE INDEX IF NOT EXISTS idx_trained_profile ON trained_stocks(profile_id);
  `)
}

/** 把当前盲训库导出存 IndexedDB（每次写操作后调用） */
async function persist(): Promise<void> {
  if (!blindDb) return
  const data = blindDb.export()
  await saveSnapshot(IDB_NAME, IDB_STORE, IDB_KEY, data)
}

export function isBlindDbReady(): boolean {
  return blindDb !== null
}

function requireDb(): Database {
  if (!blindDb) throw new Error('盲训库未初始化，请先调用 initBlindDb()')
  return blindDb
}

export async function saveSession(input: SaveSessionInput): Promise<void> {
  const db = requireDb()
  db.run(
    `INSERT INTO training_sessions
      (id, sample_id, stock_code, stock_name, interval_type, started_at, initial_capital, created_at, profile_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [input.id, input.sample_id, input.stock_code, input.stock_name,
     input.interval_type, input.started_at, input.initial_capital,
     input.created_at, input.profile_id]
  )
  // session 关联的股票自动标记为已训练
  await markTrained(input.stock_code, input.profile_id)
}

export async function markTrained(code: string, profileId: string): Promise<void> {
  const db = requireDb()
  db.run(
    `INSERT OR IGNORE INTO trained_stocks (code, profile_id, trained_at) VALUES (?, ?, ?)`,
    [code, profileId, Math.floor(Date.now() / 1000)]
  )
  await persist()
}

export async function getTrainedCodes(profileId: string): Promise<string[]> {
  const db = requireDb()
  const stmt = db.prepare(
    `SELECT code FROM trained_stocks WHERE profile_id = ? ORDER BY code`
  )
  stmt.bind([profileId])
  const codes: string[] = []
  while (stmt.step()) {
    codes.push(stmt.getAsObject().code as string)
  }
  stmt.free()
  return codes
}
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `npx vitest run src/web/blindDb.test.ts`
Expected: 5 个测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/web/blindDb.ts src/web/blindDb.test.ts
git commit -m "feat(pwa): 可写盲训库 blindDb（建表+持久化+trained_stocks）"
```

---

## Task 2: 实现零重复抽签 `sampler.ts`（TDD）

**Files:**
- Create: `src/web/sampler.ts`
- Create: `src/web/sampler.test.ts`
- Modify: `src/web/dbLoader.ts`（导出 getMarketDb 供 sampler 用）

- [ ] **Step 1: 在 dbLoader.ts 导出行情库引用**

修改 `src/web/dbLoader.ts`，在文件末尾（`isDbReady` 函数之后）追加：

```typescript
/** 获取行情库实例（供 sampler 等模块查询，不对外暴露写权限） */
export function getMarketDb(): Database | null {
  return db
}
```

- [ ] **Step 2: 写 sampler 的失败测试**

创建 `src/web/sampler.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fakeIndexedDB from 'fake-indexeddb'
import { initDb, getMarketDb } from './dbLoader'
import { initBlindDb, markTrained, getTrainedCodes } from './blindDb'
import { getRandomSamples } from './sampler'

;(globalThis as unknown as { indexedDB: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB

const PACK_PATH = resolve(process.cwd(), 'public/data/builtin-100.sqlite')
const WASM_PATH = resolve(process.cwd(), 'public/sql-wasm.wasm')
const packBuffer = new Uint8Array(readFileSync(PACK_PATH))
const locateFile = () => `file://${WASM_PATH}`

beforeAll(async () => {
  await initDb({ packData: packBuffer, locateFile })
  await initBlindDb({ forceRefresh: true, locateFile })
}, 30000)

describe('sampler 零重复抽签', () => {
  it('能抽到样本（至少 1 个）', async () => {
    const samples = await getRandomSamples('mixed', 10, {
      maxBarsPerSymbol: 260,
      profileId: 'default',
    })
    expect(samples.length).toBeGreaterThan(0)
    expect(samples[0]).toHaveProperty('code')
    expect(samples[0]).toHaveProperty('klines')
    expect((samples[0] as { klines: unknown[] }).klines.length).toBeGreaterThan(0)
  })

  it('抽到的股票不重复出现（零重复）', async () => {
    const samples = await getRandomSamples('mixed', 5, {
      maxBarsPerSymbol: 260,
      profileId: 'sampler-test-nodup',
    })
    const codes = samples.map((s) => (s as { code: string }).code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('已训练的股票会被排除', async () => {
    // 先抽一批，记下被抽到的股
    const firstBatch = await getRandomSamples('mixed', 3, {
      maxBarsPerSymbol: 260,
      profileId: 'sampler-test-exclude',
    })
    const firstCodes = firstBatch.map((s) => (s as { code: string }).code)
    // 标记它们为已训练
    for (const code of firstCodes) {
      await markTrained(code, 'sampler-test-exclude')
    }
    // 再抽一批，不应包含已训练的
    const secondBatch = await getRandomSamples('mixed', 3, {
      maxBarsPerSymbol: 260,
      profileId: 'sampler-test-exclude',
    })
    expect(secondBatch.length).toBeGreaterThan(0) // 确保真的抽到了新股票（非空通过）
    const secondCodes = secondBatch.map((s) => (s as { code: string }).code)
    for (const code of firstCodes) {
      expect(secondCodes).not.toContain(code)
    }
  })

  it('minPrice 过滤生效', async () => {
    const samples = await getRandomSamples('mixed', 5, {
      maxBarsPerSymbol: 260,
      profileId: 'sampler-test-price',
      minPrice: 50,
    })
    for (const s of samples) {
      const klines = (s as { klines: Array<{ close: number }> }).klines
      const lastClose = klines[klines.length - 1]?.close ?? 0
      expect(lastClose).toBeGreaterThanOrEqual(50)
    }
  })
})
```

- [ ] **Step 3: 运行测试，验证失败**

Run: `npx vitest run src/web/sampler.test.ts`
Expected: FAIL，报 `Failed to resolve import "./sampler"`。

- [ ] **Step 4: 实现 sampler.ts**

创建 `src/web/sampler.ts`：

```typescript
import { getMarketDb } from './dbLoader'
import { getTrainedCodes } from './blindDb'
import type { Database } from 'sql.js'

export interface NormalizedBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface TrainingSample {
  id: string
  code: string
  name: string
  regime: string
  period: string
  warmupBars: number
  forwardBars: number
  actualDate: string
  totalAvailableBars: number
  klines: NormalizedBar[]
}

export interface GetSamplesOptions {
  maxBarsPerSymbol?: number
  profileId?: string
  candidateCount?: number
  minPrice?: number
}

const MIN_HISTORY_BARS = 50
const MIN_FORWARD_BARS = 65
const MIN_TOTAL_BARS = MIN_HISTORY_BARS + MIN_FORWARD_BARS

function requireMarketDb(): Database {
  const db = getMarketDb()
  if (!db) throw new Error('行情库未初始化，请先调用 initDb()')
  return db
}

/**
 * 零重复抽签：从行情库随机选股，排除盲训库中已训练的。
 * SQL 逻辑参考 main 版 data.ts:451，用 sql.js 重写。
 */
export async function getRandomSamples(
  regime: string,
  count: number,
  options: GetSamplesOptions = {}
): Promise<TrainingSample[]> {
  const marketDb = requireMarketDb()
  const {
    maxBarsPerSymbol = 260,
    profileId = 'default',
    minPrice = 0,
  } = options
  const requestedCandidates = options.candidateCount ?? Math.max(count * 10, 80)
  const candidateLimit = Math.max(20, Math.min(2000, requestedCandidates))
  const actualMaxBars = Math.max(MIN_TOTAL_BARS + 20, Math.min(5000, Math.floor(maxBarsPerSymbol)))

  // 1. 取已训练股（排除集）
  const excludeCodes = new Set(await getTrainedCodes(profileId))

  // 2. 随机抽候选股（多抽以补偿排除）
  const fetchLimit = candidateLimit + excludeCodes.size
  const candidateRows = marketDb.prepare(
    `SELECT DISTINCT code FROM kline_daily ORDER BY RANDOM() LIMIT ?`
  )
  candidateRows.bind([fetchLimit])
  const allCodes: string[] = []
  while (candidateRows.step()) {
    allCodes.push(candidateRows.getAsObject().code as string)
  }
  candidateRows.free()

  // 排除已训练，截断到 candidateLimit
  const codes = allCodes.filter((c) => !excludeCodes.has(c)).slice(0, candidateLimit)

  // 3. 逐只构造样本
  const samples: TrainingSample[] = []
  for (const code of codes) {
    if (samples.length >= count) break

    // 股票名
    const nameStmt = marketDb.prepare(`SELECT name FROM stock_list WHERE code = ? LIMIT 1`)
    nameStmt.bind([code])
    nameStmt.step()
    const stockName = (nameStmt.getAsObject().name as string) || code
    nameStmt.free()

    // 取最近 maxBars 根 K 线（降序），再反转为升序
    const klineStmt = marketDb.prepare(
      `SELECT trade_date as date, open, high, low, close, volume, amount
       FROM kline_daily WHERE code = ?
       ORDER BY trade_date DESC LIMIT ?`
    )
    klineStmt.bind([code, actualMaxBars])
    const rows: NormalizedBar[] = []
    while (klineStmt.step()) {
      const r = klineStmt.getAsObject()
      rows.push({
        date: r.date as string,
        open: r.open as number,
        high: r.high as number,
        low: r.low as number,
        close: r.close as number,
        volume: r.volume as number,
        amount: r.amount as number,
      })
    }
    klineStmt.free()

    if (rows.length < MIN_TOTAL_BARS) continue

    // minPrice 过滤（最新收盘价 = rows 反转后最后一根，这里 rows 是降序，第一根是最新）
    if (minPrice > 0 && rows[0].close < minPrice) continue

    const klines = rows.reverse() // 升序
    const totalAvailableBars = klines.length
    const warmupBars = Math.min(MIN_HISTORY_BARS, Math.floor(totalAvailableBars * 0.3))
    const forwardBars = totalAvailableBars - warmupBars
    const actualDate = klines[warmupBars]?.date || klines[0].date

    samples.push({
      id: `${code}-${actualDate}`,
      code,
      name: stockName,
      regime,
      period: '1d',
      warmupBars,
      forwardBars,
      actualDate,
      totalAvailableBars,
      klines,
    })
  }

  return samples
}
```

- [ ] **Step 5: 运行测试，验证通过**

Run: `npx vitest run src/web/sampler.test.ts`
Expected: 4 个测试全过。注意"已训练排除"测试依赖 trained_stocks 持久化，验证零重复核心机制。

- [ ] **Step 6: 提交**

```bash
git add src/web/sampler.ts src/web/sampler.test.ts src/web/dbLoader.ts
git commit -m "feat(pwa): 零重复抽签 sampler（行情库选股+盲训库排除）"
```

---

## Task 3: 集成到数据探针页面验证

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 在 DataProbe 里加抽签验证区块**

修改 `src/App.tsx` 的 `DataProbe` 函数。在现有 import 行追加：

```typescript
import { initBlindDb } from './web/blindDb'
import { getRandomSamples } from './web/sampler'
```

在 `DataProbe` 函数内，把 `useState` 区块替换为（增加抽签结果 state）：

```typescript
function DataProbe() {
  const [status, setStatus] = useState('未初始化')
  const [stocks, setStocks] = useState<Array<Record<string, unknown>>>([])
  const [klines, setKlines] = useState<Array<Record<string, unknown>>>([])
  const [sample, setSample] = useState<{ code?: string; name?: string; barCount?: number }>({})

  useEffect(() => {
    ;(async () => {
      try {
        setStatus('初始化行情库…')
        await initDb()
        setStatus('初始化盲训库…')
        await initBlindDb()
        setStatus('查询股票列表…')
        const s = await queryStockList(5)
        setStocks(s)
        if (s.length > 0) {
          const k = await queryKline(s[0].code as string, 'daily', 5)
          setKlines(k)
        }
        setStatus('抽签（零重复）…')
        const samples = await getRandomSamples('mixed', 1, {
          maxBarsPerSymbol: 260,
          profileId: 'default',
        })
        if (samples.length > 0) {
          setSample({
            code: samples[0].code,
            name: samples[0].name,
            barCount: samples[0].klines.length,
          })
        }
        setStatus(`✅ 就绪（${s.length} 股票 + 抽到 ${sample.code || '无'}）`)
      } catch (e) {
        setStatus(`❌ ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  }, [])
```

然后在 JSX 的 K 线区块之后、闭合 `</div>` 之前，追加抽签结果展示：

```typescript
      <h3 style={{ fontSize: 14, marginTop: 16 }}>零重复抽签结果</h3>
      <pre style={{ fontSize: 11, overflowX: 'auto' }}>{JSON.stringify(sample, null, 2)}</pre>
```

- [ ] **Step 2: 验证 tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 退出码 0。

- [ ] **Step 3: 启动 dev server 验证（抓页面 HTML 确认渲染）**

Run:
```bash
npm run dev > /tmp/vite-dev3.log 2>&1 &
sleep 4
curl -s -m 5 http://localhost:5173 | grep -o 'id="root"'
kill %1 2>/dev/null
```
Expected: 输出 `<div id="root">`，页面正常渲染（运行时数据由单元测试证明）。

- [ ] **Step 4: 运行全部测试确认无回归**

Run: `npx vitest run 2>&1 | tail -5`
Expected: 所有测试通过（含新增 sampler 4 + blindDb 5 = 9 个）。

- [ ] **Step 5: 提交**

```bash
git add src/App.tsx
git commit -m "feat(pwa): 数据探针集成盲训库+抽签验证"
```

---

## 完成标准（Definition of Done）

- [ ] `npx vitest run src/web/` 全部通过（idb 3 + dbLoader 3 + blindDb 5 + sampler 4 = 15 个）
- [ ] `npm run build` 成功
- [ ] `npm run dev` 数据探针显示抽到的股票（零重复）
- [ ] `npx tsc -b --noEmit` 通过
- [ ] 零重复机制验证：标记已训练后，再次抽签不返回该股
- [ ] 持久化验证：重启（forceRefresh=false）能恢复 trained_stocks
- [ ] 所有改动已 commit

---

## 后续（plan 2b-2）

本计划完成后，进入：
- **plan 2b-2**：webApi 抽象层（实现 saveSession/saveTradeAction/finishSession/getSessionReview 等，签名对齐 preload）+ 工作台组件接入（BlindTrainingWorkbench 用 mobileAPI 替代 electronAPI）+ 横竖屏布局 CSS
