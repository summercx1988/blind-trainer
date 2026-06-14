# 盲训 App 架构文档

**版本：** v2.0（拆分后重写）
**状态：** 当前代码对应的架构真相
**日期：** 2026-06-14

## 0. 关于本文档

本文档服务于**盲训独立 App**（仓库 [summercx1988/blind-trainer](https://github.com/summercx1988/blind-trainer)）。

历史双子系统架构见 [archive/2026-06-split/quant-removed/ARCHITECTURE.md](archive/2026-06-split/quant-removed/ARCHITECTURE.md)（仅作历史参考）。

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────┐
│  Renderer (React 19)                            │
│  ├── TrainingOverview                           │
│  ├── BlindTrainingWorkbench                     │
│  └── DataManagement                             │
└────────────────────┬────────────────────────────┘
                     │ window.electronAPI
┌────────────────────┴────────────────────────────┐
│  Preload (contextBridge)                        │
└────────────────────┬────────────────────────────┘
                     │ IPC
┌────────────────────┴────────────────────────────┐
│  Main Process                                   │
│  ├── db.ts            行情库                    │
│  ├── blindDb.ts       盲训库                    │
│  ├── services/                                  │
│  │   ├── market-data.ts  (手动同步)            │
│  │   └── seed-loader.ts  (首次启动加载种子)    │
│  └── ipc/                                      │
│      ├── data.ts (22 个数据 IPC)               │
│      └── blind.ts (盲训 IPC)                   │
└────────────────────┬────────────────────────────┘
                     │ better-sqlite3
┌────────────────────┴────────────────────────────┐
│  本地 SQLite                                    │
│  ├── stock-trading.db (885MB, 行情)            │
│  └── blind-training.db (动态, 训练会话)         │
└─────────────────────────────────────────────────┘
```

## 2. 模块划分

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| **训练总览** | `src/components/trading/TrainingOverview.tsx` | 训练日历、累计收益、数据状态 |
| **盲训工作台** | `src/components/trading/BlindTrainingWorkbench.tsx` | 随机起点抽取、K 线推进、决策、复盘 |
| **数据管理** | `src/components/trading/DataManagement.tsx` | 行情库加载、手动同步、覆盖率 |

## 3. 关键数据流

### 3.1 训练会话流程

```
1. 用户在「训练总览」点击"开始训练"
         │
         ▼
2. Renderer → IPC: blind:startSession
         │
         ▼
3. Main: 随机抽取起点（股票 + 起始日期）
         │
         ▼
4. Main → 写 blind-training.db: sessions 表
         │
         ▼
5. 返回 session_id 给 Renderer
         │
         ▼
6. Renderer 进入「盲训工作台」
   - 渲染 K 线（仅显示 ≤ 当前推进位置）
   - 用户点击"推进一根 K 线" → IPC: blind:advanceBar
   - 用户点击"买入/卖出" → IPC: blind:recordAction
         │
         ▼
7. 用户点击"结束会话" → IPC: blind:endSession
   - 揭示后续 K 线，计算盈亏
   - 写入 actions 表 + reviews 表
         │
         ▼
8. 返回复盘结果给 Renderer
```

### 3.2 数据加载流程

```
首次启动：
  1. 检测 data/blind-seed.db 是否存在
  2. 检测 ~/Library/Application Support/blind-trainer/stock-trading.db 是否存在
  3. 都不存在 → 网络同步（仅首次，慢）
  4. 种子存在 + userData 不存在 → 复制种子到 userData
  5. 都存在 → 直接启动

后续启动：
  - 行情库已就位 → 直接启动
  - 不主动同步（"盲"训约束）

手动更新：
  - 用户在「数据管理」点击"同步" → market-data.ts 走 sina/tencent/baostock
```

## 4. 关键约束

### 4.1 信息遮蔽
- 渲染 K 线时**只传** `klines[0..current_idx]`，后续 K 线**不进入 Renderer 内存**
- 不在前端 store 缓存未揭示的 K 线
- 复盘阶段才把 `klines[current_idx+1..end]` 一次返回

### 4.2 不自动同步
- 启动时**不调用**任何行情同步接口
- 仅用户主动触发时才同步
- 目的：避免训练期间行情库悄悄更新，导致"用未来训练"

### 4.3 数据隔离
- 行情库路径：`app.getPath('userData')` + `/stock-trading.db`
- 盲训库路径：`app.getPath('userData')` + `/blind-training.db`
- 与量化 App 的 userData **完全独立**

## 5. 数据 schema

### 5.1 行情库（db.ts）

```sql
-- 盲训只用 kline_daily / stock_list 两张表
CREATE TABLE kline_daily (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL,
  volume REAL, amount REAL,
  PRIMARY KEY (code, trade_date)
);

CREATE TABLE stock_list (
  code TEXT PRIMARY KEY,
  name TEXT,
  industry TEXT,
  ...
);
```

完整 schema 见 [data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md)。

### 5.2 盲训库（blindDb.ts）

```sql
-- 训练会话
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  initial_capital REAL,
  final_capital REAL,
  pnl REAL,
  created_at TEXT,
  ended_at TEXT
);

-- 动作日志
CREATE TABLE actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  bar_index INTEGER,
  action_type TEXT,  -- 'buy' / 'sell' / 'hold'
  price REAL,
  shares INTEGER,
  created_at TEXT
);

-- 复盘结果
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  actual_pnl REAL,
  max_drawdown REAL,
  max_profit REAL,
  ...
);
```

完整 schema 见 [behavior-event-design.md](behavior-event-design.md)。

## 6. IPC 桥接

| 类别 | IPC 数 | 主要接口 |
| --- | --- | --- |
| 数据 | 22 | init, sync, backfill, status, getStocks, getKline |
| 盲训 | 8 | startSession, advanceBar, recordAction, endSession, getSession, listSessions, getReview, deleteSession |

完整 IPC 列表见 [src/types/ipc.ts](../src/types/ipc.ts)。

## 7. 技术栈

| 维度 | 技术 |
| --- | --- |
| 运行时 | Electron 41 + Node.js 20 |
| UI | React 19 + TypeScript 5 |
| 构建 | Vite 8 |
| 状态 | zustand |
| 存储 | better-sqlite3 |
| 图表 | ECharts |
| 数据源 | sina / tencent / baostock（手动触发） |

## 8. 拆分关系

| | 量化 App | 盲训 App（这里） |
| --- | --- | --- |
| Electron 主进程 | db.ts (20+ 表) | db.ts (2 表) + blindDb.ts |
| IPC 桥接 | 22 + 量化专属 | 22 数据 + 8 盲训 |
| Python 子工程 | ✅ | ❌ |
| 数据同步 | 自动 + 手动 | 仅手动 |

详见 [split-plan-v2.md](split-plan-v2.md)。
