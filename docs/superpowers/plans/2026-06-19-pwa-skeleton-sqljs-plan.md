# PWA 骨架 + sql.js 技术验证（阶段 2a）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 mobile 分支上搭起纯 Web 版 PWA 骨架，用 sql.js 加载 builtin-100.sqlite 到浏览器内存，从 IndexedDB 持久化，能在网页上查出真实 K 线数据——证明"Electron 替换为纯 Web"技术路线走通。

**Architecture:** 现有 vite 配置同时打包 renderer + main + preload（通过 vite-plugin-electron）。PWA 版去掉 Electron 插件，只保留 React renderer。新增 `src/web/` 目录放 Web 专属代码：`dbLoader.ts`（sql.js 初始化 + IndexedDB 持久化）、`webApi.ts`（实现 preload 的接口签名，本阶段只实现 `getKline` 等只读方法）。种子包放在 `public/data/builtin-100.sqlite`，随 App 打包。

**Tech Stack:** sql.js（WebAssembly SQLite）、IndexedDB（持久化）、vite-plugin-pwa（PWA 外壳）、vitest + jsdom（浏览器环境测试）。

**关联文档：** [迁移设计 §5](../specs/2026-06-18-electron-to-pwa-migration-design.md)（数据库迁移）、[§6.4](../specs/2026-06-18-electron-to-pwa-migration-design.md)（四层加载）、[§8 阶段2](../specs/2026-06-18-electron-to-pwa-migration-design.md)

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `src/web/idb.ts` | IndexedDB 封装：存/取 Uint8Array snapshot | 创建 |
| `src/web/dbLoader.ts` | sql.js 初始化、加载种子包、查询封装 | 创建 |
| `src/web/dbLoader.test.ts` | dbLoader 单元测试（jsdom 环境） | 创建 |
| `src/web/webApi.ts` | 实现 preload 接口签名（本阶段只实现 getKline/getStockList） | 创建 |
| `public/data/builtin-100.sqlite` | 内置包（从 data/web-packs/ 拷贝） | 创建 |
| `public/data/builtin-100.meta.json` | 内置包元数据（从 data/web-packs/ 拷贝） | 创建 |
| `vite.config.ts` | 去掉 electron 插件，加 vite-plugin-pwa | 修改 |
| `package.json` | 加 sql.js / vite-plugin-pwa / jsdom 依赖 | 修改 |
| `src/App.tsx` | 加一个临时的"数据探针"页面验证查询 | 修改 |
| `index.html` | 加 PWA meta + theme-color | 修改 |

**设计说明：**
- `idb.ts` 和 `dbLoader.ts` 分开：IndexedDB 操作是通用的（存任意 ArrayBuffer），sql.js 逻辑独立。两个文件各自单一职责，可独立测试。
- 测试用 jsdom 环境（sql.js 在 jsdom 下能跑，因为 jsdom 提供 fetch/WebAssembly）。需为 PWA 测试单独配 vitest 环境，避免污染现有 node 环境测试。
- 本阶段**不实现写操作**（saveSession 等）和抽签机制——那是 plan 2b 的事。本阶段只证明"网页能加载 sqlite 并查询"，是最小技术验证。

---

## Task 1: 安装依赖 + 拷贝内置包到 public

**Files:**
- Modify: `package.json`
- Create: `public/data/builtin-100.sqlite`
- Create: `public/data/builtin-100.meta.json`

- [ ] **Step 1: 安装 sql.js、vite-plugin-pwa、jsdom 依赖**

Run:
```bash
npm install sql.js
npm install -D @types/sql.js vite-plugin-pwa jsdom
```

Expected: package.json 的 dependencies 增加 `sql.js`，devDependencies 增加 `@types/sql.js`、`vite-plugin-pwa`、`jsdom`。

- [ ] **Step 2: 拷贝内置包到 public/data/（随 App 打包，浏览器可直接 fetch）**

Run:
```bash
mkdir -p public/data
cp data/web-packs/builtin-100.sqlite public/data/builtin-100.sqlite
cp data/web-packs/builtin-100.meta.json public/data/builtin-100.meta.json
ls -lh public/data/
```

Expected: public/data/ 下有两个文件，sqlite 约 17MB，meta.json 约 1-2KB。

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json public/data/
git commit -m "feat(pwa): 安装 sql.js/vite-plugin-pwa 依赖 + 拷贝 builtin-100 到 public"
```

---

## Task 2: 配置 vite（去 Electron + 加 PWA 插件）

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: 重写 vite.config.ts——去掉 electron 插件，加 vite-plugin-pwa**

替换 `vite.config.ts` 全部内容为：

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'data/builtin-100.sqlite'],
      manifest: {
        name: '盲训工作台',
        short_name: '盲训',
        description: '基于真实历史K线的盘感训练工具',
        theme_color: '#0d0d0d',
        background_color: '#0d0d0d',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm,sqlite,json}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
    }),
  ],
  build: {
    outDir: 'dist',
  },
})
```

说明：去掉 `vite-plugin-electron` 和 main/preload 的打包配置。`includeAssets` 确保内置 sqlite 包被 service worker 缓存（离线可用）。`maximumFileSizeToCacheInBytes` 调到 30MB 以容纳 17MB 的 sqlite。

- [ ] **Step 2: 验证 dev server 能起来（即使 App 还没改）**

Run: `npm run dev`
Expected: vite dev server 正常启动（通常 http://localhost:5173），无 electron 相关报错。浏览器打开会看到现有 React App（因为还没改 App.tsx，可能因缺 electronAPI 报错，这正常）。Ctrl+C 停止。

- [ ] **Step 3: 验证 tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 退出码 0。注意：去掉 electron 后，`src/main/` 和 `src/preload/` 下的代码仍在但不会被 vite 打包（只是 TS 检查仍覆盖它们）。如果 tsc 报 electron 类型错误，说明 tsconfig 还引用了 @types/node 的 electron 部分——本步骤不应出现，因为 electron 是 devDependency，类型仍在。

- [ ] **Step 4: 提交**

```bash
git add vite.config.ts
git commit -m "feat(pwa): vite 去 electron 插件 + 加 vite-plugin-pwa 外壳"
```

---

## Task 3: 实现 IndexedDB 封装 `idb.ts`（TDD）

**Files:**
- Create: `src/web/idb.ts`
- Create: `src/web/idb.test.ts`

- [ ] **Step 1: 配置 vitest 的 jsdom 环境（为 web 测试单独配）**

修改 `vitest.config.ts`，改为按文件路径区分环境：

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: false,
    environmentMatchGlobs: [
      ['src/web/**/*.test.ts', 'jsdom'],
    ],
  },
})
```

说明：`src/web/` 下的测试用 jsdom（浏览器环境，有 indexedDB/fetch），其他测试保持 node 环境。jsdom 从 Task 1 安装的依赖提供。

- [ ] **Step 2: 写 idb.ts 的失败测试**

创建 `src/web/idb.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { saveSnapshot, loadSnapshot, clearSnapshot } from './idb'

const DB_NAME = 'blind-trainer-test'
const STORE = 'kv'
const KEY = 'test-db'

describe('idb snapshot 存取', () => {
  beforeEach(async () => {
    await clearSnapshot(DB_NAME, STORE, KEY)
  })

  it('存入 Uint8Array 后能取回相同数据', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    await saveSnapshot(DB_NAME, STORE, KEY, data)
    const loaded = await loadSnapshot(DB_NAME, STORE, KEY)
    expect(loaded).not.toBeNull()
    expect(Array.from(loaded!)).toEqual([1, 2, 3, 4, 5])
  })

  it('未存入时返回 null', async () => {
    const loaded = await loadSnapshot(DB_NAME, STORE, KEY)
    expect(loaded).toBeNull()
  })

  it('clearSnapshot 后数据消失', async () => {
    const data = new Uint8Array([9, 9, 9])
    await saveSnapshot(DB_NAME, STORE, KEY, data)
    await clearSnapshot(DB_NAME, STORE, KEY)
    const loaded = await loadSnapshot(DB_NAME, STORE, KEY)
    expect(loaded).toBeNull()
  })
})
```

- [ ] **Step 3: 运行测试，验证失败**

Run: `npx vitest run src/web/idb.test.ts`
Expected: FAIL，报 `Failed to resolve import "./idb"` 或 `Cannot find module`。

- [ ] **Step 4: 实现 idb.ts**

创建 `src/web/idb.ts`：

```typescript
/**
 * IndexedDB 轻量封装：只支持存取单个 Uint8Array snapshot。
 * 用于持久化 sql.js 导出的数据库快照。
 */

function openDb(dbName: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(store)) {
        db.createObjectStore(store)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveSnapshot(
  dbName: string,
  store: string,
  key: string,
  data: Uint8Array
): Promise<void> {
  const db = await openDb(dbName, store)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(data, key)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export async function loadSnapshot(
  dbName: string,
  store: string,
  key: string
): Promise<Uint8Array | null> {
  const db = await openDb(dbName, store)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => {
      db.close()
      resolve(req.result ? new Uint8Array(req.result as ArrayBuffer) : null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error)
    }
  })
}

export async function clearSnapshot(
  dbName: string,
  store: string,
  key: string
): Promise<void> {
  const db = await openDb(dbName, store)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}
```

- [ ] **Step 5: 运行测试，验证通过**

Run: `npx vitest run src/web/idb.test.ts`
Expected: 3 个测试全过。

- [ ] **Step 6: 提交**

```bash
git add vitest.config.ts src/web/idb.ts src/web/idb.test.ts
git commit -m "feat(pwa): IndexedDB 封装 idb.ts（存取 sql.js snapshot）"
```

---

## Task 4: 实现 sql.js 加载器 `dbLoader.ts`（TDD）

**Files:**
- Create: `src/web/dbLoader.ts`
- Create: `src/web/dbLoader.test.ts`

> 前置：本 task 开始前，先拷贝 wasm 到 public（Task 5 的内容前置到这里，避免 locateFile 在测试环境失效）：
> ```bash
> cp node_modules/sql.js/dist/sql-wasm.wasm public/sql-wasm.wasm
> ```
> vitest jsdom 环境下 `fetch('/data/...')` 无 origin 可用，因此 `initDb` 设计为**支持直接传入 Uint8Array**（测试用 fs 读文件后传入，生产用 fetch）。这把"数据来源"和"数据库初始化"解耦。

- [ ] **Step 1: 拷贝 sql-wasm.wasm 到 public/**

Run:
```bash
cp node_modules/sql.js/dist/sql-wasm.wasm public/sql-wasm.wasm
ls -lh public/sql-wasm.wasm
```

Expected: public/sql-wasm.wasm 约 2-3MB。

- [ ] **Step 2: 写 dbLoader 的失败测试**

创建 `src/web/dbLoader.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initDb, queryKline, queryStockList } from './dbLoader'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACK_PATH = resolve(__dirname, '../../../public/data/builtin-100.sqlite')

// 测试用 fs 直接读内置包（绕过 fetch，jsdom 无 origin）
const packBuffer = new Uint8Array(readFileSync(PACK_PATH))

describe('dbLoader 真实数据查询', () => {
  beforeAll(async () => {
    await initDb({ packData: packBuffer })
  }, 30000)

  it('能查到股票列表（至少 1 只）', async () => {
    const stocks = await queryStockList(10)
    expect(stocks.length).toBeGreaterThan(0)
    expect(stocks[0]).toHaveProperty('code')
    expect(stocks[0]).toHaveProperty('name')
  })

  it('能查到指定股票的 K 线（至少 1 根）', async () => {
    const stocks = await queryStockList(1)
    const code = stocks[0].code as string
    const klines = await queryKline(code, 'daily', 120)
    expect(klines.length).toBeGreaterThan(0)
    expect(klines[0]).toHaveProperty('trade_date')
    expect(klines[0]).toHaveProperty('close')
  })

  it('不存在的股票返回空数组', async () => {
    const klines = await queryKline('NOTEXIST', 'daily', 10)
    expect(klines).toEqual([])
  })
})
```

- [ ] **Step 3: 运行测试，验证失败**

Run: `npx vitest run src/web/dbLoader.test.ts`
Expected: FAIL，报 `Failed to resolve import "./dbLoader"`。

- [ ] **Step 4: 实现 dbLoader.ts**

创建 `src/web/dbLoader.ts`：

```typescript
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { saveSnapshot, loadSnapshot } from './idb'

const IDB_NAME = 'blind-trainer'
const IDB_STORE = 'db-snapshots'
const IDB_KEY = 'builtin-db'

let SQL: SqlJsStatic | null = null
let db: Database | null = null

export interface InitOptions {
  /** 直接传入种子包数据（优先级最高，测试用）。不传则走 packUrl fetch。 */
  packData?: Uint8Array
  /** 种子包 URL，默认 /data/builtin-100.sqlite（生产/dev 用） */
  packUrl?: string
  /** 强制重新 fetch，忽略 IndexedDB 缓存 */
  forceRefresh?: boolean
}

/**
 * 初始化数据库：优先级 packData > IndexedDB 缓存 > fetch packUrl。
 * 加载后实例化 sql.js Database，存入模块级变量。
 * 首次 fetch 成功后写入 IndexedDB，后续从缓存秒加载。
 */
export async function initDb(options: InitOptions = {}): Promise<void> {
  const { packData, packUrl = '/data/builtin-100.sqlite', forceRefresh = false } = options

  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file: string) => `/${file}`,
    })
  }

  let buffer: Uint8Array | null = packData ?? null
  if (!buffer && !forceRefresh) {
    buffer = await loadSnapshot(IDB_NAME, IDB_STORE, IDB_KEY)
  }
  if (!buffer) {
    const res = await fetch(packUrl)
    if (!res.ok) {
      throw new Error(`加载种子包失败：${packUrl} (${res.status})`)
    }
    buffer = new Uint8Array(await res.arrayBuffer())
    await saveSnapshot(IDB_NAME, IDB_STORE, IDB_KEY, buffer)
  }

  if (db) {
    db.close()
  }
  db = new SQL.Database(buffer)
}

/**
 * 查询某只股票的 K 线。
 * 返回最新的 limit 根，按日期升序（oldest→newest，适配 K 线图）。
 */
export async function queryKline(
  code: string,
  period: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  if (!db) throw new Error('数据库未初始化，请先调用 initDb()')
  // 种子包只有日K，period 暂时只支持 'daily'，参数保留为后续扩展
  const stmt = db.prepare(
    `SELECT code, trade_date, open, high, low, close, volume, amount, change_pct
     FROM kline_daily
     WHERE code = ?
     ORDER BY trade_date DESC
     LIMIT ?`
  )
  stmt.bind([code, limit])
  const rows: Array<Record<string, unknown>> = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows.reverse() // 转为升序
}

/**
 * 查询股票列表（按 code 升序）。
 */
export async function queryStockList(
  limit: number
): Promise<Array<Record<string, unknown>>> {
  if (!db) throw new Error('数据库未初始化，请先调用 initDb()')
  const stmt = db.prepare(
    `SELECT code, name, market, industry FROM stock_list ORDER BY code LIMIT ?`
  )
  stmt.bind([limit])
  const rows: Array<Record<string, unknown>> = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

/** 获取数据库是否已初始化 */
export function isDbReady(): boolean {
  return db !== null
}
```

- [ ] **Step 5: 运行测试，验证通过**

Run: `npx vitest run src/web/dbLoader.test.ts`
Expected: 3 个测试全过。首次运行初始化 WASM 约 1-2 秒，数据来自 packData（不触发 fetch）。

- [ ] **Step 6: 提交**

```bash
git add public/sql-wasm.wasm src/web/dbLoader.ts src/web/dbLoader.test.ts
git commit -m "feat(pwa): sql.js 加载器 dbLoader（packData 解耦数据源 + 查询K线/股票）"
```

---

## Task 5: 验证生产构建

**Files:**
- 无新增（dbLoader 的 locateFile 已在 Task 4 指向 /，wasm 已在 public/）

- [ ] **Step 1: 验证生产构建能成功**

Run: `npm run build`
Expected: 构建成功，`dist/` 下生成 index.html + assets + sql-wasm.wasm + data/builtin-100.sqlite（被 vite-plugin-pwa 的 includeAssets 拷入）。无报错。

> ⚠️ 如果 build 警告 builtin-100.sqlite 超过推荐缓存大小（500KB），这是预期的——Task 2 已配置 `maximumFileSizeToCacheInBytes: 30MB`。

- [ ] **Step 2: 验证 build 产物结构**

Run: `ls dist/ dist/assets/ dist/data/ 2>/dev/null`
Expected: 看到 index.html、sql-wasm.wasm、data/builtin-100.sqlite、sw.js（service worker）等。

- [ ] **Step 3: 提交（如有改动；纯验证无文件变更则跳过）**

```bash
git status --short
# 如果有改动：
git add -A && git commit -m "chore(pwa): 验证生产构建产物结构"
# 如果无改动，本 task 无 commit
```

---

## Task 6: 数据探针页面（在 App 里验证端到端）

**Files:**
- Modify: `src/App.tsx`
- Modify: `index.html`

- [ ] **Step 1: 修改 index.html，加 PWA meta 和主题色**

把 `index.html` 的 `<head>` 部分改为：

```html
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0d0d0d" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <title>盲训工作台</title>
</head>
```

说明：`viewport` 加 `user-scalable=no` 禁止双击缩放（移动 App 体验）。`theme-color` 和 apple meta 让"添加到主屏幕"后有原生 App 观感。

- [ ] **Step 2: 在 App.tsx 加一个临时的"数据探针"组件**

在 `src/App.tsx` 顶部 import 区加：

```typescript
import { useEffect, useState } from 'react'
import { initDb, queryStockList, queryKline, isDbReady } from './web/dbLoader'
```

然后在 `App` 函数体的 `return` 之前，加一个探针 hook（不替换现有 App 逻辑，只是追加一个独立的验证区块）：

```typescript
function DataProbe() {
  const [status, setStatus] = useState('未初始化')
  const [stocks, setStocks] = useState<Array<Record<string, unknown>>>([])
  const [klines, setKlines] = useState<Array<Record<string, unknown>>>([])

  useEffect(() => {
    (async () => {
      try {
        setStatus('加载中…')
        await initDb()
        setStatus('已加载，查询中…')
        const s = await queryStockList(5)
        setStocks(s)
        if (s.length > 0) {
          const k = await queryKline(s[0].code as string, 'daily', 5)
          setKlines(k)
        }
        setStatus(`✅ 就绪（${s.length} 只股票示例）`)
      } catch (e) {
        setStatus(`❌ ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  }, [])

  return (
    <div style={{ padding: 16, background: '#0d0d0d', color: '#fff', fontFamily: 'monospace', minHeight: '100vh' }}>
      <h2 style={{ fontSize: 16 }}>数据探针 · PWA 阶段2a 验证</h2>
      <p style={{ fontSize: 13 }}>DB 状态：{status}</p>
      <p style={{ fontSize: 13 }}>isDbReady: {String(isDbReady())}</p>
      <h3 style={{ fontSize: 14, marginTop: 16 }}>股票列表（前5）</h3>
      <pre style={{ fontSize: 11, overflowX: 'auto' }}>{JSON.stringify(stocks, null, 2)}</pre>
      <h3 style={{ fontSize: 14, marginTop: 16 }}>第一只股票最近5根K线</h3>
      <pre style={{ fontSize: 11, overflowX: 'auto' }}>{JSON.stringify(klines, null, 2)}</pre>
    </div>
  )
}
```

然后在 `App` 的 `return` 最外层包一个判断：如果 `window.electronAPI` 不存在（纯 Web 环境），渲染 `DataProbe`，否则渲染原有 App。把 `App` 的 return 改为：

```typescript
  if (typeof window !== 'undefined' && !(window as unknown as { electronAPI?: unknown }).electronAPI) {
    return <DataProbe />
  }
  return (
    <>
      {/* ...原有的 App JSX 保持不变... */}
    </>
  )
```

> 注：这是临时验证手段，plan 2b 会用正式的 webApi 替代。不要删除原有 App JSX。

- [ ] **Step 3: 启动 dev server，浏览器打开验证**

Run: `npm run dev`
打开浏览器 `http://localhost:5173`。
Expected: 看到黑底页面，标题"数据探针"，DB 状态从"加载中"变为"✅ 就绪（5 只股票示例）"，下方显示股票 JSON 和 K 线 JSON（真实数据，非空）。

- [ ] **Step 4: 验证 IndexedDB 持久化（刷新页面应秒加载）**

在浏览器 DevTools → Application → IndexedDB → blind-trainer → db-snapshots，应看到 key 为 `builtin-db` 的记录。
刷新页面（F5），观察状态从"加载中"快速变为"已加载"（因为从 IndexedDB 读，不再 fetch）。

- [ ] **Step 5: 验证 tsc 通过**

Run: `npx tsc -b --noEmit`
Expected: 退出码 0。

- [ ] **Step 6: 提交**

```bash
git add index.html src/App.tsx
git commit -m "feat(pwa): 数据探针页面验证端到端（App 里条件渲染）"
```

---

## 完成标准（Definition of Done）

- [ ] `npx vitest run src/web/` 全部通过（idb 3 + dbLoader 3 = 6 个测试）
- [ ] `npm run build` 成功，dist/ 含 sql-wasm.wasm + data/builtin-100.sqlite + sw.js
- [ ] `npm run dev` 浏览器打开，数据探针页面显示真实股票和 K 线数据
- [ ] 刷新页面后从 IndexedDB 秒加载（不再 fetch 17MB）
- [ ] `npx tsc -b --noEmit` 通过
- [ ] vite.config 已去掉 electron 插件，加 vite-plugin-pwa
- [ ] 所有改动已 commit

---

## 验证 PWA 安装能力（手动，非阻塞）

完成上述后，可选手动验证：
1. `npm run build && npm run preview`
2. 浏览器打开 preview 地址，地址栏应出现"安装"图标（PWA 可安装）
3. 手机 Safari 打开（同局域网 IP），分享 → 添加到主屏幕

如果这三步成功，证明 PWA 外壳工作正常，阶段 2a 完整达成。

---

## 后续（plan 2b）

本计划完成后，进入：
- **plan 2b**：webApi.ts 抽象层（实现 preload 全部接口签名，底层调 dbLoader）+ 工作台组件接入 + 抽签机制（trained_stocks 表 + getRandomSamples）
- 阶段 3-5 见 [迁移设计 §8](../specs/2026-06-18-electron-to-pwa-migration-design.md)
