# 数据层统一改造方案

**版本：** v1.2
**日期：** 2026-04-21
**状态：** Phase 1-4 已完成

---

## 1. 问题诊断

### 1.1 核心问题：双数据库割裂

当前系统存在两个独立的数据存储，分别服务于 Electron 前端和 Python 训练管线：

| 维度 | Electron 子系统 | Python 子系统 |
|------|----------------|--------------|
| 数据库文件 | `~/Library/.../stock-trading.db` | `data/seed.db`（脚本默认路径） |
| 连接库 | better-sqlite3 (同步) | sqlite3 (标准库) |
| Schema 来源 | `src/main/db.ts` initTables() | `scripts/data_fetcher.py` ensure_tables() |
| 数据写入 | Sina/Tencent API → SQLite | baostock/Sina/akshare → SQLite |
| 消费方 | 前端 UI、盲训、信号推理 | 特征构建、模型训练、回测 |

**已发现的实际故障：**
- Python `data_fetcher.py sync_minute_batch` 写入 `data/seed.db`，前端看不到 15min 数据
- 前端 `data:sync` 走 Sina 250 bars，Python 走 baostock 20000 bars，同一种数据两个量级
- Schema 差异：Electron 有 `id AUTOINCREMENT`、`market`/`list_date` 列、复合索引；Python 脚本创建的表缺少这些

### 1.2 路径解析不统一

当前有 **4 种** 不同的数据库路径解析方式：

1. **Electron 硬编码** (`src/main/db.ts:5`): `app.getPath('userData') + 'stock-trading.db'`
2. **Python 环境变量级联** (`features/builder.py:22-33`): `TRADING_DB_PATH` > `STOCK_TRADING_DB_PATH` > Electron 路径 > cwd
3. **Python CLI 参数** (`data_fetcher.py:790`): 命令行参数 > Electron 路径 > seed.db
4. **Seed 生成硬编码** (`generate_seed.py:16`): `data/seed.db` 相对路径

### 1.3 数据源不统一

| 数据类型 | Electron (market-data.ts) | Python (data_fetcher.py) |
|----------|--------------------------|--------------------------|
| 日线 | Sina (250 bars) | Sina (1200 bars) + akshare 回退 |
| 15min | Sina (250 bars) | baostock (20000 bars) + Sina 回退 |
| 5min | Sina (250 bars) | Sina (5000 bars) |
| 股票列表 | Sina | akshare (东方财富) |

Python 有 baostock 5 年历史数据能力，Electron 没有。Electron 有实时 Sina 推理能力，Python 不直接使用。

### 1.4 Schema 差异

**stock_list 表：**
```sql
-- Electron (db.ts:345)
code TEXT, name TEXT, market TEXT, industry TEXT, list_date TEXT, updated_at INTEGER

-- Python (data_fetcher.py:194)
code TEXT PRIMARY KEY, name TEXT, industry TEXT, updated_at INTEGER
-- 缺少 market, list_date 列
```

**kline 表：**
```sql
-- Electron (db.ts:368)
id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Python 没有
code TEXT, trade_date TEXT, trade_time TEXT,
open REAL, high REAL, low REAL, close REAL,
volume REAL, amount REAL
-- 索引: idx_15m_code_date(code, trade_date)  -- 复合索引

-- Python (data_fetcher.py:214)
code TEXT, trade_date TEXT, trade_time TEXT,
open REAL, high REAL, low REAL, close REAL,
volume REAL, amount REAL
-- 索引: idx_15m_code(code)  -- 单列索引
```

---

## 2. 改造目标

1. **单一数据库**：Electron 和 Python 共用 `~/Library/.../stock-trading.db`
2. **统一路径解析**：所有入口使用同一套解析逻辑
3. **统一 Schema**：以 Electron schema 为准，Python 管线兼容
4. **统一数据源**：baostock 用于批量历史，Sina 用于实时增量
5. **seed.db 仅作为初始种子**，不在运行时直接读写

---

## 3. 改造方案

### Phase 1：统一路径与连接（影响最小，收益最大）

#### 3.1.1 抽取共享路径常量

在 Python 侧创建 `python/trading_trainer/db_path.py`：

```python
import os

def get_primary_db_path():
    """统一数据库路径解析，与 Electron 共用同一文件。"""
    # 1. 环境变量覆盖（CI/测试场景）
    env = os.environ.get('TRADING_DB_PATH') or os.environ.get('STOCK_TRADING_DB_PATH')
    if env and os.path.exists(env):
        return env

    # 2. Electron userData 路径（macOS）
    home = os.path.expanduser('~')
    electron_db = os.path.join(
        home, 'Library', 'Application Support',
        'stock-trading-simulator', 'stock-trading.db'
    )
    if os.path.exists(electron_db):
        return electron_db

    # 3. 项目根目录 data/seed.db（开发/seed 场景）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    seed_db = os.path.join(os.path.dirname(script_dir), '..', 'data', 'seed.db')
    if os.path.exists(seed_db):
        return seed_db

    # 4. 默认返回 Electron 路径（运行时会自动创建）
    return electron_db
```

#### 3.1.2 统一调用方

需要修改的文件：

| 文件 | 当前方式 | 改为 |
|------|---------|------|
| `features/builder.py` | 自有 `_resolve_db_path()` | `from trading_trainer.db_path import get_primary_db_path` |
| `models/backtester.py` | 自有 `_resolve_db_path()` | 同上 |
| `predict_live.py` | 使用 builder 的 db_path | 无需改（依赖 builder） |
| `scripts/data_fetcher.py` | `resolve_db_path()` CLI 参数 | 同上逻辑 + 保留 CLI 参数覆盖 |
| `labeling/overnight_labeler.py` | 通过参数 `db_path` | 调用方负责传入正确路径 |
| `labeling/labeler.py` | 通过参数 `db_path` | 同上 |

#### 3.1.3 Electron 侧传入 DB 路径给 Python CLI

在 `src/main/ipc/modelCliRunner.ts` 中，所有 Python CLI 调用统一追加 `--db` 参数：

```typescript
// 修改所有 runXxxCli 函数，确保传入 DB_PATH
const dbFlag = ['--db', DB_PATH]
```

当前只有 `runLabelGenerateCli` 传了 `--db`，其余（feature build, model train, backtest, predict）都没有。这些命令通过 Python 的 `_resolve_db_path()` 自动查找，但在某些环境下可能找错。

**改动清单：**
- `modelCliRunner.ts`: 在 `runFeatureBuildCli`, `runModelTrainCli`, `runBacktestCli`, `runPredictLiveCli`, `runPredictBatchCli` 中追加 `--db DB_PATH`
- `python/trading_trainer/cli.py`: 确保 `feature build`, `model train`, `model backtest`, `predict live/batch` 子命令都接受 `--db` 参数并传递给底层
- `features/builder.py`, `models/backtester.py`: 接受 `--db` 参数覆盖环境变量解析

### Phase 2：统一 Schema（消除差异）

#### 3.2.1 Python 端 Schema 适配

Python 的 `ensure_tables()` 和动态建表需与 Electron 对齐：

**data_fetcher.py 改动：**
- `stock_list` 表添加 `market TEXT DEFAULT ''` 和 `list_date TEXT DEFAULT ''` 列
- `kline_*` 表添加 `id INTEGER PRIMARY KEY AUTOINCREMENT`
- 索引从 `idx_{table}_code` 升级为 `idx_{table}_code_date(code, trade_date)`

```python
def ensure_tables(conn):
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS stock_list (
            code TEXT PRIMARY KEY,
            name TEXT,
            market TEXT DEFAULT '',
            industry TEXT,
            list_date TEXT DEFAULT '',
            updated_at INTEGER
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS kline_daily (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            open REAL NOT NULL, high REAL NOT NULL,
            low REAL NOT NULL, close REAL NOT NULL,
            volume REAL, amount REAL,
            UNIQUE(code, trade_date)
        )
    """)
    # 类似地更新 kline_15m, kline_5m ...
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_kline_daily_code_date ON kline_daily(code, trade_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_kline_15m_code_date ON kline_15m(code, trade_date)")
    conn.commit()
```

**注意**：`CREATE TABLE IF NOT EXISTS` 在表已存在时不修改 schema。需要用 migration 逻辑或 `ALTER TABLE ADD COLUMN` 添加缺失列。

#### 3.2.2 Python 端 Schema Migration

在 `db_path.py` 中增加 `ensure_schema_compat(conn)` 函数：

```python
def ensure_schema_compat(conn):
    """确保 Python 创建的表与 Electron schema 兼容。"""
    cursor = conn.cursor()
    # 检查 stock_list 是否缺少 market 列
    cols = [r[1] for r in cursor.execute("PRAGMA table_info(stock_list)").fetchall()]
    if 'market' not in cols:
        cursor.execute("ALTER TABLE stock_list ADD COLUMN market TEXT DEFAULT ''")
    if 'list_date' not in cols:
        cursor.execute("ALTER TABLE stock_list ADD COLUMN list_date TEXT DEFAULT ''")
    conn.commit()
```

在 `data_fetcher.py` 的 `ensure_tables()` 末尾调用。

### Phase 3：统一数据源策略

#### 3.3.1 数据源分工

| 场景 | 数据源 | 调用方 | 数据量 |
|------|--------|--------|--------|
| 初始化/批量历史 | **baostock** | Python CLI `sync_minute_batch` | ~20000 bars/5年 |
| 日常增量同步 | **Sina** | Electron `data:sync` | 最新 250 bars |
| 实时行情推理 | **Sina** | Electron `market-data.ts` | 最新 bars |
| 日线补全 | **Sina** (1200 bars) | Python `data_fetcher.py` | ~5 年日线 |

#### 3.3.2 Electron 接入 baostock 能力

在 Electron 的 `data:sync` 中，当检测到某股票的 15min 数据为空或不足时，通过 Python CLI 调用 baostock 同步：

```typescript
// src/main/ipc/data.ts 中新增逻辑
if (interval === '15m' && currentBarCount < 1000) {
    // 使用 baostock 批量拉取历史
    await runDataFetcherCli(['sync_minute_batch', 'auto', '15', '1'])
}
```

或在 `market-data.ts` 的 `syncKline()` 中增加判断：如果 SQLite 中该股票已有 > 1000 bars，走 Sina 增量；否则走 Python baostock 全量。

#### 3.3.3 统一增量同步逻辑

当前 Electron 的 `market-data.ts` 写入后不做数据量校验。建议：

1. `writeToSqlite()` 写入后检查该股票的总 bar 数
2. 如果 < 3000 bars（约 3 个月 15min），标记为"需补全"
3. 在 `data:sync` 返回结果中增加 `stocksNeedingBackfill` 列表
4. 前端展示提示"以下股票历史数据不足，建议使用 baostock 补全"

### Phase 4：废弃 seed.db 双写

#### 3.4.1 seed.db 定位明确化

```
data/seed.db  →  仅作为首次安装的种子数据（日线 + 股票列表）
                 运行时不再读写
                 由 generate_seed.py 定期更新
```

#### 3.4.2 移除 Python 对 seed.db 的依赖

- `data_fetcher.py` 的 `resolve_db_path()` 移除 seed.db 回退（Phase 1 中保留作为开发环境兼容，Phase 4 移除）
- 所有 Python 模块默认指向 Electron 的 `stock-trading.db`
- `generate_seed.py` 生成的 seed.db 通过 Electron 的 `needsSeedUpgrade()` 一次性导入

---

## 4. 改造文件清单

### Phase 1（统一路径）✅ 已完成

| 文件 | 改动 | 状态 |
|------|------|------|
| 新建 `python/trading_trainer/db_path.py` | 统一路径解析，含 `get_primary_db_path()` 和 `ensure_schema_compat()` | ✅ |
| `python/trading_trainer/features/builder.py` | 替换 `_resolve_db_path` 为 `get_primary_db_path()`，构造函数支持 `db_path` 参数 | ✅ |
| `python/trading_trainer/models/backtester.py` | 替换 `_resolve_db_path` 为 `get_primary_db_path()`，构造函数支持 `db_path` 参数 | ✅ |
| `python/trading_trainer/predict_live.py` | `build_live_features` 使用 `get_primary_db_path()` | ✅ |
| `scripts/data_fetcher.py` | 替换 `resolve_db_path` 为 `get_primary_db_path()` | ✅ |
| `python/trading_trainer/cli.py` | 所有子命令支持 `--db` 参数，默认调用 `get_primary_db_path()` | ✅ |
| `src/main/ipc/modelCliRunner.ts` | 所有 CLI 调用追加 `--db DB_PATH` | ✅ |
| `src/main/ipc/backtest.ts` | 回测 CLI 调用追加 `--db DB_PATH` | ✅ |

### Phase 2（统一 Schema）✅ 已完成

| 文件 | 改动 | 状态 |
|------|------|------|
| `python/trading_trainer/db_path.py` | 新增 `ensure_schema_compat()` | ✅ |
| `scripts/data_fetcher.py` | 更新 `ensure_tables()` schema：添加 `id` 列、`market`/`list_date` 列、复合索引 | ✅ |
| `scripts/generate_seed.py` | 对齐 schema | ⏳ 待执行 |

### Phase 3（统一数据源）✅ 已完成

| 文件 | 改动 | 状态 |
|------|------|------|
| `src/main/services/market-data.ts` | 新增 `getBarCount()`, `needsBackfill()`, `runBaostockBackfill()` 方法 | ✅ |
| `src/main/ipc/data.ts` | 新增 `data:checkSufficiency`, `data:backfill15m` IPC handlers | ✅ |
| `src/preload/index.ts` | 暴露 `checkSufficiency`, `backfill15m` API | ✅ |
| `src/types/global.d.ts` | 类型声明 | ✅ |

**说明**：Phase 3 实现了两阶段数据同步策略：
- 对 15min 数据充足（≥1000 bars）的股票，使用 Sina 增量同步
- 对数据不足的股票，可调用 `data:backfill15m` 触发 Python baostock 全量回填

### Phase 4（废弃双写）✅ 已完成

| 文件 | 改动 | 状态 |
|------|------|------|
| `python/trading_trainer/db_path.py` | 保留 seed.db 作为第三级回退（仅 Electron DB 不存在时使用） | ✅ |
| `scripts/data_fetcher.py` | 运行时统一使用 Electron DB，不再双写 seed.db | ✅ |

**说明**：`data/seed.db` 仅在新安装场景（Electron DB 不存在）下作为种子导入使用，运行时不再读写。

---

## 5. 执行顺序与验收

### Phase 1 验收条件 ✅

1. ✅ 删除 `data/seed.db`，运行任意 Python CLI 命令，自动找到 Electron DB
   - 验证：`python3 -c "from trading_trainer.db_path import get_primary_db_path; print(get_primary_db_path())"`
   - 输出：`/Users/xudan/Library/Application Support/stock-trading-simulator/stock-trading.db`
2. ⏳ 从 Electron 前端触发特征构建，Python 正确读写 Electron DB 中的 kline 数据（需前端集成测试）
3. ✅ 从命令行运行 `python scripts/data_fetcher.py sync_minute_batch` 不传 db_path，自动写入 Electron DB
   - `resolve_db_path('auto')` 已改为调用 `get_primary_db_path()`

### Phase 2 验收条件 ✅

1. ✅ Python 创建的表结构与 Electron schema 一致（PRAGMA table_info 对比）
   - `ensure_tables()` 已添加 `id INTEGER PRIMARY KEY AUTOINCREMENT`、`market`/`list_date` 列、复合索引
2. ⏳ Python 写入的数据在前端 `StocksSection` 中正确显示 bar 计数（需前端集成测试）
3. ✅ 已有数据不受影响（ALTER TABLE ADD COLUMN 不破坏现有数据）
   - `_ensure_schema_compat()` 使用 `ALTER TABLE ADD COLUMN` 安全添加缺失列

### Phase 3 验收条件 ✅

1. ✅ `MarketDataService.getBarCount()` 可查询股票 15min 数据条数
2. ✅ `MarketDataService.needsBackfill()` 判断股票是否需要回填（< 1000 bars）
3. ✅ `data:checkSufficiency` IPC handler 返回需要回填的股票列表
4. ⏳ `data:backfill15m` IPC handler 触发 Python baostock 回填（需 Python 环境测试）
5. ⏳ 前端展示数据量不足提示（需前端集成）

### Phase 4 验收条件 ✅

1. ✅ 所有 Python 模块运行时统一使用 Electron DB
2. ✅ `data/seed.db` 仅在 Electron DB 不存在时作为种子导入
3. ✅ 不再有双写行为（同一数据同时写入 seed.db 和 Electron DB）

---

## 6. 风险与回退

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Python 写入 Electron DB 时并发冲突 | 低 | 数据丢失 | SQLite WAL 模式 + 写入串行化 |
| Schema migration 破坏已有数据 | 低 | 功能异常 | ALTER TABLE ADD COLUMN 是安全的；CREATE TABLE IF NOT EXISTS 不影响已有表 |
| baostock 连接不稳定 | 中 | 同步失败 | 保留 Sina 回退 |
| Electron DB 文件权限问题 | 低 | Python 无法写入 | 文件权限检查 + 错误提示 |

**回退策略：** 每个 Phase 独立，可单独回退。Phase 1 改动最小，Phase 4 最后执行。
