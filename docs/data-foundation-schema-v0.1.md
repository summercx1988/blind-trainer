# 数据底座 Schema 契约 v0.1

> 状态：草案 v0.1（基于现状盘点 + 拆分方案预演）
> 适用范围：macOS 平台型 App、Web 盲训 App、Menu Bar 同步进程、Python 训练子系统
> 来源：基于 [src/main/db.ts](src/main/db.ts) / [src/main/blindDb.ts](src/main/blindDb.ts) / [src/main/marketDb.ts](src/main/marketDb.ts) 的现状盘点，叠加拆分方案的"取并集"诉求

---

## 0. 目的与读者

拆分盲训与量化之前，必须先把"数据底座"沉淀成一份独立契约，作为后续 monorepo 中 `packages/data-foundation` 的真相源。

读者：

- macOS 量化 App 的 TS / Python 维护者
- 盲训 App（macOS 平台型内嵌模块 / 未来 Web 端）的维护者
- Menu Bar 同步进程的维护者
- 数据底座包（`packages/data-foundation`）的拥有者

非读者：业务用户。

---

## 1. 原则

| #   | 原则                              | 说明                                                                                            |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| P1  | **取并集**                        | 共享表字段尽量齐全；子系统用 `SELECT 列名列表` 取数，未列出字段不引用                              |
| P2  | **底座不依赖子系统**              | `packages/data-foundation` 不允许 import 任何 `apps/*` 或 `packages/{blind,quant}`               |
| P3  | **SQLite WAL + 跨进程 flock**     | 任何对外打开 DB 的进程必须先 `flock` 写锁，锁目录 `~/Library/Application Support/<app>/.lock`    |
| P4  | **单一写入者**                    | 一份 DB 同时只允许一个进程写入；其他进程走只读 `readonly: true, fileMustExist: true` 模式        |
| P5  | **路径可被环境变量覆盖**          | 拆分测试时通过 `STOCK_TRADING_DB_PATH` / `TRADING_DB_PATH` 走隔离库（详见 [scripts/safe-refactor.sh](scripts/safe-refactor.sh)） |
| P6  | **JSON 字段走 TEXT + `_json` 后缀** | 例如 `payload_json`、`metrics_json`；TS 端用 `COALESCE(json_extract(col, '$'), ...)` 兜底         |
| P7  | **必带 `created_at` INTEGER 秒**  | 几乎所有表都需 `created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))`                      |
| P8  | **CHECK 枚举替代 BOOLEAN**        | 状态字段一律 `CHECK(status IN (...))`，避免布尔歧义                                            |
| P9  | **不引入软删除**                  | 通过 `status = 'archived' / 'rejected'` 表达；不引入 `deleted_at`                                |
| P10 | **每个 migration 必带 `description`** | 遵循 [.trae/rules/project_rules.md](.trae/rules/project_rules.md) 的硬约束                       |

---

## 2. 命名约定

### 2.1 表

- 全部小写 `snake_case`
- 业务实体表用单数或复数均可，**优先单数**（与现有 [db.ts:391](src/main/db.ts#L391) `samples` / [db.ts:427](src/main/db.ts#L427) `stock_list` 保持一致）
- 关联表用 `<单数A>_<单数B>`，例如 `trade_actions`、`session_reviews`
- 跨子系统的共享表不放任何子系统前缀
- 子系统独占表可加前缀（量化表暂不加，盲训表用 `idx_blind_*` 作为索引前缀以隔离命名空间）

### 2.2 字段

- `snake_case`
- 主键：业务表用 `id TEXT PRIMARY KEY`（UUID 字符串或语义化 ID），K 线表用 `id INTEGER PRIMARY KEY AUTOINCREMENT`
- 时间戳：
  - `*_at INTEGER`（秒，epoch UTC），由 `(strftime('%s','now'))` 默认值提供
  - 行情类（K 线）业务时间走 `trade_date TEXT`（YYYY-MM-DD）+ `trade_time TEXT`（HH:MM）
- 枚举：`CHECK(col IN ('a', 'b', 'c'))`
- 标志：INTEGER 0/1，**不要** BOOLEAN 类型（SQLite 不原生支持）
- 金额/价格/百分比：`REAL`
- 大文本：TEXT（不限长）
- 复杂结构：JSON 序列化为字符串，列名以 `_json` 结尾

### 2.3 索引

- 命名 `idx_<table>_<col1>[_<col2>...]`
- 跨子系统的盲训索引保留现有 `idx_blind_*` 风格（参考 [blindDb.ts:110-116](src/main/blindDb.ts#L110-L116)）
- 量化表索引沿用现有 `idx_*`（参考 [db.ts:289-368](src/main/db.ts#L289-L368)）

### 2.4 约束

- `FOREIGN KEY` 仅在表间关系稳定时使用；盲训表当前无外键（[blindDb.ts:9-118](src/main/blindDb.ts#L9-L118)），沿用现状
- 主库量化表沿用现有外键（如 [db.ts:213-214](src/main/db.ts#L213-L214) `model_training_tasks`）

---

## 3. 核心共享表（底座必含）

### 3.1 `stock_list`

- 现状：[db.ts:427-434](src/main/db.ts#L427-L434)
- 字段：code (TEXT PK) / name / market / industry / list_date / updated_at
- 唯一消费者：行情同步、量化与盲训双方读

```sql
CREATE TABLE stock_list (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  market       TEXT,
  industry     TEXT,
  list_date    TEXT,
  updated_at   INTEGER
);
```

### 3.2 `kline_daily`

- 现状：[db.ts:436-448](src/main/db.ts#L436-L448)
- 唯一键：`(code, trade_date)`

```sql
CREATE TABLE kline_daily (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL,
  trade_date    TEXT NOT NULL,
  open          REAL NOT NULL,
  high          REAL NOT NULL,
  low           REAL NOT NULL,
  close         REAL NOT NULL,
  volume        REAL,
  amount        REAL,
  change_pct    REAL,
  UNIQUE(code, trade_date)
);
CREATE INDEX idx_kline_daily_code_date ON kline_daily(code, trade_date);
```

### 3.3 `kline_15m` / `kline_5m`

- 现状：[db.ts:450-476](src/main/db.ts#L450-L476)
- 唯一键：`(code, trade_date, trade_time)`
- **拆分坑点**：[marketDb.ts:69-77](src/main/marketDb.ts#L69-L77) 引用了 `kline_30m` / `kline_60m`，但 [db.ts](src/main/db.ts) 未建表。底座 v0.1 决定：
  - **不建** `kline_30m/60m`，仅保留 `1d/15m/5m`
  - [marketDb.ts](src/main/marketDb.ts) 在解析到 `30m/60m` 时返回空数组

### 3.4 `stock_kline_stats`

- 现状：[db.ts:478-493](src/main/db.ts#L478-L493)
- 作用：单只股票的 K 线覆盖度统计（盲训抽样本、量化回测都要查）
- 由 [auto-sync.ts:28-95](src/main/services/auto-sync.ts#L28-L95) 维护

### 3.5 `sync_state`（v0.1 新增）

- 现状：分散存于 `dataset_policy_evaluations`（[auto-sync.ts:169-188](src/main/services/auto-sync.ts#L169-L188)）+ `app_preferences`
- 拆分诉求：把同步元数据从「借用表」抽出来，给 Menu Bar App 用

```sql
CREATE TABLE sync_state (
  id              TEXT PRIMARY KEY,           -- 'auto_sync_meta' / 'menu_bar_status' / 'last_full_sync' ...
  scope           TEXT NOT NULL,              -- 'market' | 'blind' | 'quant'
  status          TEXT NOT NULL,              -- 'idle' | 'running' | 'ok' | 'error'
  last_run_at     INTEGER,
  last_ok_at      INTEGER,
  last_error      TEXT,
  summary_json    TEXT,
  updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX idx_sync_state_scope ON sync_state(scope, updated_at DESC);
```

### 3.6 `app_preferences`

- 现状：[db.ts:338-342](src/main/db.ts#L338-L342) 通用 K/V 表
- 拆分诉求：保留。两个 App 共享同一份偏好（行情 DB 路径等）

---

## 4. 量化扩展表（仅 quant 子系统写）

> 现状：14 张表散落在 [db.ts](src/main/db.ts) L152-336
> 拆分原则：v0.1 **保持位置不变**，不迁出主库；Web 盲训不读这些表

| 表                     | 现状位置                  | 拆分后归属                  |
| ---------------------- | ------------------------- | --------------------------- |
| `signal_candidates`    | [db.ts:123-140](src/main/db.ts#L123-L140)  | 量化主库                    |
| `candidate_review_logs`| [db.ts:142-150](src/main/db.ts#L142-L150)  | 量化主库                    |
| `dataset_versions`     | [db.ts:152-162](src/main/db.ts#L152-L162)  | 量化主库                    |
| `dataset_items`        | [db.ts:164-178](src/main/db.ts#L164-L178)  | 量化主库                    |
| `feature_build_tasks`  | [db.ts:180-198](src/main/db.ts#L180-L198)  | 量化主库                    |
| `model_training_tasks` | [db.ts:200-215](src/main/db.ts#L200-L215)  | 量化主库                    |
| `model_versions`       | [db.ts:217-231](src/main/db.ts#L217-L231)  | 量化主库                    |
| `model_evaluations`    | [db.ts:233-245](src/main/db.ts#L233-L245)  | 量化主库                    |
| `signal_events`        | [db.ts:247-261](src/main/db.ts#L247-L261)  | 量化主库                    |
| `model_recommendations`| [db.ts:263-293](src/main/db.ts#L263-L293)  | 量化主库                    |
| `signal_feedback`      | [db.ts:295-302](src/main/db.ts#L295-L302)  | 量化主库                    |
| `retraining_runs`      | [db.ts:304-323](src/main/db.ts#L304-L323)  | 量化主库                    |
| `dataset_policy_evaluations` | [db.ts:325-336](src/main/db.ts#L325-L336) | 量化主库（但 `auto_sync_meta` 会被迁出到 `sync_state`） |
| `labeling_tasks`       | [db.ts:370-389](src/main/db.ts#L370-L389)  | 量化主库                    |
| `strategies`           | [db.ts:407-425](src/main/db.ts#L407-L425)  | 量化主库（但盲训可能复用）   |
| `samples`              | [db.ts:391-405](src/main/db.ts#L391-L405)  | **共享**：盲训抽样本读此表  |

**重点**：

- `samples` 表盲训消费、量化生产；**作为共享表**
- `strategies` 表盲训若引用也作为共享表
- `dataset_policy_evaluations.id = 'auto_sync_meta'` 这条**特殊行**在 v0.1 迁移时改写为 `sync_state` 中一行

---

## 5. 盲训扩展表（仅 blind 子系统写）

> 现状：5 张表在 [blindDb.ts](src/main/blindDb.ts)，无外键约束

| 表                 | 现状位置                    | 拆分后归属              |
| ------------------ | --------------------------- | ----------------------- |
| `training_sessions`| [blindDb.ts:11-27](src/main/blindDb.ts#L11-L27) | 盲库                    |
| `trade_actions`    | [blindDb.ts:29-45](src/main/blindDb.ts#L29-L45) | 盲库                    |
| `session_reviews`  | [blindDb.ts:47-65](src/main/blindDb.ts#L47-L65) | 盲库                    |
| `labels`           | [blindDb.ts:67-83](src/main/blindDb.ts#L67-L83) | **盲库独占**（盲训独立后不再读量化 labels）|
| `training_profiles`| [blindDb.ts:85-108](src/main/blindDb.ts#L85-L108) | 盲库                    |
| `behavior_event`   | **v0.1 新增**               | 盲库（详见 [behavior-event-design.md](behavior-event-design.md)）|

**关键坑点（盲训独立后移除）**：

- 原 `db:saveLabel` 走盲库（[modelDbLabelingIpc.ts:32-58](src/main/ipc/modelDbLabelingIpc.ts#L32-L58)），`labeling:createLabel` 走主库（[modelDbLabelingIpc.ts:110-112](src/main/ipc/modelDbLabelingIpc.ts#L110-L112)），存在跨库同名 `labels` 风险
- **决策**：盲训独立 App 后，盲训侧**不再读**量化 `labels` 表；主库 `labels` 表保持现有语义，盲库 `labels` 保持现有语义
- 后续若要消除命名歧义：把主库 `labels` 重命名为 `model_labels`（一次性 migration，需 review 所有 `labeling:*` IPC 引用方）

---

## 6. 字段并集矩阵（关键字段在哪些表里被哪些子系统使用）

| 字段            | 出现表                                        | quant 写 | blind 写 | quant 读 | blind 读 |
| --------------- | --------------------------------------------- | -------- | -------- | -------- | -------- |
| `code`          | `stock_list` / `kline_*` / `samples` / `signal_candidates` / `model_recommendations` | ✓ | ✗ | ✓ | ✓ |
| `trade_date`    | `kline_daily` / `kline_15m` / `kline_5m`      | ✓ | ✗ | ✓ | ✓ |
| `session_id`    | `trade_actions` / `labels` / `session_reviews` / `behavior_event` | ✗ | ✓ | ✓（只读反查）| ✓ |
| `profile_id`    | `training_sessions` / `training_profiles` / `behavior_event` | ✗ | ✓ | ✗ | ✓ |
| `bar_index`     | `trade_actions` / `labels` / `behavior_event` | ✗ | ✓ | ✗ | ✓ |
| `signal_type`   | `signal_candidates` / `signal_events`         | ✓ | ✗ | ✓ | ✗ |
| `action_type`   | `trade_actions`                               | ✗ | ✓ | ✗ | ✓ |
| `payload_json`  | 多个表                                        | ✓ | ✓ | ✓ | ✓ |
| `created_at`    | 几乎所有表                                    | ✓ | ✓ | ✓ | ✓ |
| `status`        | 枚举表（多种枚举）                            | ✓ | ✓ | ✓ | ✓ |

读取原则：子系统用白名单字段列表（`SELECT col1, col2, ...`），不写 `SELECT *`。

---

## 7. 迁移机制

### 7.1 schema 版本号

- 主库：[db.ts:497](src/main/db.ts#L497) `CURRENT_SCHEMA_VERSION = 7`，通过 `PRAGMA user_version` 维护
- 盲库：当前**无版本号**（v0.1 必须加上）
- 新增 migration 必须遵循项目规则：
  1. 每个 migration 必须有 `description` 字段
  2. `ALTER TABLE` 前先 `PRAGMA table_info`
  3. INSERT/UPDATE 引用的列必须建表 SQL 和 migration 都包含

### 7.2 migration 文件

`packages/data-foundation` 内的 `migrations/` 目录：

```
migrations/
  shared/
    001_init_stock_list.sql
    002_init_kline_daily.sql
    003_init_kline_15m_5m.sql
    004_init_stock_kline_stats.sql
    005_init_app_preferences.sql
    010_add_sync_state.sql
  quant/
    100_init_signal_candidates.sql
    ...
  blind/
    200_init_training_sessions.sql
    201_add_profile_id.sql
    202_init_behavior_event.sql
```

数字递增代表执行顺序；shared 区段先于子系统区段。

### 7.3 迁移执行器契约

```ts
interface MigrationRunner {
  ensureSchema(db: Database.Database, scope: 'shared' | 'quant' | 'blind'): Promise<void>
  currentVersion(db: Database.Database): number
  applyMigration(db: Database.Database, migration: Migration): void
  rollback(db: Database.Database, targetVersion: number): void  // 仅 dev 用
}
```

约束：

- migration 通过事务执行（`db.transaction(() => { ... })`）
- 失败回滚 + 写 logger
- 写库异常时把库文件隔离到 `*.corrupt-<ts>.db`（沿用 [db.ts:quarantineCorruptDatabase](src/main/db.ts) 的设计）

---

## 8. 跨进程文件互斥

- DB 文件：`stock-trading.db` / `blind-training.db` / 外部行情库
- 锁文件：`<userData>/.locks/<dbname>.flock`
- 工具：`proper-lockfile`（npm）跨平台；macOS 退化用 `flock(2)` syscall
- 单一写入者：Menu Bar App 拿到写锁 → 量化 App 与盲训 App 都走 `readonly: true`
- 例外：写操作必须排队，按 FIFO 通过 SSE 通知主 App

---

## 9. v0.1 → v0.2 待办

| #   | 事项                                                           | 负责阶段 |
| --- | -------------------------------------------------------------- | -------- |
| 1   | 盲库加 `PRAGMA user_version` + `schemaMigrations` 数组         | W2       |
| 2   | `auto_sync_meta` 行从 `dataset_policy_evaluations` 迁出到 `sync_state` | W3 |
| 3   | `kline_30m/60m` 引用点决定建表或删除                           | W3       |
| 5   | 外部行情库路径优先级统一：env > app_preferences > repo default > main fallback（已实现，文档化） | W1 |
| 6   | `samples` / `strategies` 表归属（共享 vs 量化独占）             | W2       |
| 7   | Python 子系统读 `samples` / `strategies` 的 schema 文档化      | W4       |

---

## 10. 相关链接

- 拆分总览：[docs/monorepo-init.md](monorepo-init.md)
- Menu Bar 同步进程：[docs/menu-bar-app-spec.md](menu-bar-app-spec.md)
- 行为事件表：[docs/behavior-event-design.md](behavior-event-design.md)
- 安全网脚本：[scripts/safe-refactor.sh](scripts/safe-refactor.sh)
- 项目规则：[.trae/rules/project_rules.md](.trae/rules/project_rules.md)
