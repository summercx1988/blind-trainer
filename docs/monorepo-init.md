# Monorepo 初始化与拆分路线 v0.1

> **⚠️ 已废弃（superseded）**：本方案已被 [split-plan-v2.md](split-plan-v2.md) 取代。
> v2 方案改为"两个独立 git repo + 共享 data-foundation npm 包"，砍掉了完整 monorepo、menu-bar 同步进程和 Web 版。
> 本文档仅作历史参考保留。

> 状态：草案 v0.1
> 目的：把当前单仓 Electron 桌面 App 演进为 pnpm workspaces monorepo，分离"数据底座 / 量化 / 盲训 / 同步进程"
> 范围：从"现状一仓一 App" → "monorepo + 多 App + 共享 packages"
> 节奏：6 阶段渐进式，每阶段可独立回退

---

## 0. 为什么是 monorepo

| 候选     | 优势                                            | 劣势                                                                |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| monorepo | 跨包重构成本低、共享类型一致、单仓单 CI         | 仓库变大、权限收口变难                                              |
| 多 repo  | 权限/部署隔离清晰                               | 跨 repo 重构成本高（盲训拆出后，量化那边要发包版本）                  |
| git branch | 零成本                                          | **不适合作为长期拆分工具**：branch 是临时偏离 → 合并机制，6 个月后必然走向拆 repo |

**结论**：用 monorepo（pnpm workspaces + Turborepo 可选）。

---

## 1. 目标仓库结构

```
stock-trading-platform/                       # 根
├── pnpm-workspace.yaml
├── turbo.json
├── package.json                              # 根 package.json（仅 devDeps + workspaces 协议）
├── tsconfig.base.json                        # 共享 TS 配置
├── apps/
│   ├── quant-desktop/                        # 原 Electron 量化 App（重构后）
│   ├── blind-desktop/                        # 原 Electron 平台型中"盲训模块"独立成 App
│   ├── menu-bar/                             # 独立 Menu Bar 同步进程
│   └── blind-web/                            # 未来 Web 端盲训（C 端）—— v0.3
├── packages/
│   ├── data-foundation/                      # 数据底座：DB 初始化 + migration + 类型
│   ├── db/                                   # better-sqlite3 封装 + flock
│   ├── ipc-contracts/                        # 跨进程 IPC 类型契约
│   ├── logger/
│   ├── market-data/                          # 行情同步（被 menu-bar / quant-desktop 共用）
│   ├── python-bridge/                        # Electron ↔ Python CLI 包装
│   ├── platform-store/                       # zustand store（按需被各 App 引用）
│   ├── ui/                                   # 共享 React 组件（KLineChart 等）
│   └── charts/                               # klinecharts 封装
├── python/                                   # 现有 Python 子工程，原样保留
│   ├── trading_trainer/
│   ├── scripts/
│   └── requirements.txt
├── scripts/
│   ├── safe-refactor.sh                      # 重构安全网（[scripts/safe-refactor.sh](scripts/safe-refactor.sh)）
│   └── validate-platform-contracts.mjs
├── docs/                                     # 本目录
└── data/                                     # 仓库根 data/（seed.db 等）
```

---

## 2. pnpm-workspace.yaml 草案

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'python'
```

可选：加 Turborepo：

```json
// turbo.json
{
  "pipeline": {
    "build":    { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev":      { "cache": false },
    "lint":     {},
    "typecheck":{ "dependsOn": ["^build"] },
    "test":     {}
  }
}
```

---

## 3. packages 清单

| 包                     | 责任                                                                  | 引用方                                                  | 依赖                                    |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------- |
| `data-foundation`      | SQLite migration、schema 类型、env 路径解析                          | 所有 apps + `db`                                       | `better-sqlite3`                        |
| `db`                   | `flock` 写锁、`readonly: true` 包装、连接池                            | 所有 apps                                               | `data-foundation`                       |
| `ipc-contracts`        | 跨进程 IPC 类型（`db:saveSession` request/response）                  | `quant-desktop` / `blind-desktop` / `menu-bar` / `blind-web` | 无                                      |
| `logger`               | 统一日志（pino + 日志目录）                                          | 所有 apps + `market-data`                              | `pino`                                  |
| `market-data`          | 同步调度、sina/tencent/baostock 三路、K 线落库                         | `menu-bar`（主）/ `quant-desktop`（降级）              | `data-foundation`、`db`、`logger`        |
| `python-bridge`        | `runPredictBatchCli`、stderr/stdout 解析、artifact path              | `quant-desktop`                                         | `node:child_process`                     |
| `platform-store`       | zustand store（active model / active profile / data stats）          | `quant-desktop` / `blind-desktop`                      | `ipc-contracts`                         |
| `ui`                   | 共享 React 组件（KLineChart、InfoHover、ResultSummary）               | `quant-desktop` / `blind-desktop` / `blind-web`         | React 19 / Vite                          |
| `charts`               | klinecharts 封装、indicator 计算                                       | `ui`                                                    | `klinecharts`                            |

---

## 4. apps 清单

| App                | 形态                       | 入口                                                        | 持有 DB 写权 |
| ------------------ | -------------------------- | ----------------------------------------------------------- | ------------ |
| `quant-desktop`    | Electron 主窗口 App        | `apps/quant-desktop/src/main/index.ts`（由 [src/main/index.ts](src/main/index.ts) 改写） | 否（`readonly: true`，同步走 menu-bar） |
| `blind-desktop`    | Electron 主窗口 App（macOS 平台型） | `apps/blind-desktop/src/main/index.ts`（裁剪 [src/main/index.ts](src/main/index.ts)） | 否 |
| `menu-bar`         | Electron Tray App（LSUIElement）| `apps/menu-bar/src/main/index.ts`                          | **是**（flock 写锁）|
| `blind-web`        | 纯 Web（Vite + React）     | `apps/blind-web/index.html`（v0.3）                        | 否（直连 menu-bar HTTP） |

---

## 5. 拆分阶段路线图

| 阶段  | 内容                                                                                                                                       | 验证                                                                              | 回退方式                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------- |
| **P0** | 文档定型：本文 + [data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md) + [menu-bar-app-spec.md](menu-bar-app-spec.md) + [behavior-event-design.md](behavior-event-design.md) | 4 份文档 review 通过                                                              | 不涉及代码                            |
| **P1** | 在**原仓**做"路径参数化"前置：让 [src/main/db.ts:7](src/main/db.ts#L7) `DB_PATH` 支持 `STOCK_TRADING_DB_PATH` 环境变量；同步 [marketDb.ts:20](src/main/marketDb.ts#L20) `resolveMarketDbPath` 已支持 | `./scripts/safe-refactor.sh start` 可启动隔离 dev；`rollback` 可回退              | `git revert`                          |
| **P2** | 初始化 monorepo 骨架（pnpm workspaces + `packages/data-foundation` 抽 `initTables`）                                                       | 根目录 `pnpm install` 通过；`apps/quant-desktop` 仍能跑（指向 packages 内代码）   | `git revert` + `pnpm install`         |
| **P3** | 抽 `packages/{db,ipc-contracts,logger,market-data}`；menu-bar App 雏形                                                                    | `apps/menu-bar` `pnpm dev` 启动 Tray + http server；同步仍能跑                   | 关闭 `apps/menu-bar`，回退到原 `src/main/services/auto-sync.ts` |
| **P4** | quant-desktop 改造：去掉 `startAutoSync`、去掉启动时的 seed upgrade；走 `readonly: true` 打开 DB；通过 HTTP 触发同步                          | 三进程并发不冲突；`./scripts/safe-refactor.sh verify` ok                          | menu-bar 关闭时 quant-desktop 走降级（自带单次 1d 增量） |
| **P5** | 引入 `behavior_event` 表 + `behavior:track` IPC；按 [behavior-event-design.md](behavior-event-design.md) 6 个事件挂 hook；同时落地 [AGENTS.md](../AGENTS.md) + [agents/data_analyst/](../agents/data_analyst/) 工具集 | 盲训 50 个 session 跑通，行为数据落库；`python -m pytest agents/data_analyst/tests/ -v` 全绿；`python -m agents.data_analyst.scripts.behavior_summary --db $BLIND_DB_PATH` 能出 3 个 section report | 关闭 `behavior:track` 入口 + 删 `agents/data_analyst/` 即可 |
| **P6** | blind-desktop 独立成 App；把 `BlindTrainingWorkbench` 完整迁出；quant-desktop 删 blind 相关 import                                          | 两个 App 各自 `pnpm dev` 启动；共享 menu-bar 的同步；数据互通                    | 把 `BlindTrainingWorkbench` 移回 quant-desktop `apps/quant-desktop/src/components/trading` |
| **P7** | blind-web 启动（v0.3）                                                                                                                     | 浏览器打开能玩盲训；走 menu-bar HTTP 拉行情                                       | 暂停 P7，仅维护 macOS 双 App         |

每阶段配套：

- `./scripts/safe-refactor.sh start` / `dev` / `status` / `rollback` 演练
- `npx tsc -b --noEmit`（项目规则硬要求）
- 关键 IPC 走 `scripts/validate-platform-contracts.mjs` 自动校验
- **P5 起新增**：`python -m pytest agents/data_analyst/tests/ -v` 必过

### 5.1 P5 子任务清单

1. 盲库建表：[src/main/blindDb.ts](../src/main/blindDb.ts) 加 `behavior_event`（参考 [docs/behavior-event-design.md §2](behavior-event-design.md)）
2. 加 `PRAGMA user_version` + 迁移数组（按 [docs/data-foundation-schema-v0.1.md §7.1](data-foundation-schema-v0.1.md)）
3. Preload 暴露 `behavior.track(payload)` → `behavior:track` IPC
4. 主进程 `src/main/ipc/behavior.ts`：批量写（5s flush）+ 失败重试 3 次吞日志
5. Renderer 侧 [src/components/trading/BlindTrainingWorkbench.tsx](../src/components/trading/BlindTrainingWorkbench.tsx) 6 个 hook 点挂 `useBehaviorTracker`
6. 跑盲训 50 个 session 积累数据
7. 跑 [agents/data_analyst/scripts/behavior_summary.py](../agents/data_analyst/scripts/behavior_summary.py) 验证 3 个 section 都有内容
8. 把命令写进 [AGENTS.md](../AGENTS.md) §6 工具表

### 5.2 P5 上线节奏

| 周次  | 内容                                                                          |
| ----- | ----------------------------------------------------------------------------- |
| W0    | 文档 review（本文 + [AGENTS.md](../AGENTS.md) + [agents/data_analyst/](../agents/data_analyst/)） |
| W1    | 盲库 `behavior_event` migration + PRAGMA user_version                          |
| W2    | `behavior:track` IPC + 批量写                                                  |
| W3    | Renderer 6 hook 点 + 开关埋点                                                  |
| W4    | 跑盲训 50 session，行为数据落库                                                |
| W5    | 5 个分析 SQL 写成 [behavior_summary.py](../agents/data_analyst/scripts/behavior_summary.py) 的 sections |
| W6    | 发布"行为分析与复盘对照表" 用户文档                                            |

---

## 6. IPC channel 命名规范

| 命名空间          | 范围                | 例                                                                 |
| ----------------- | ------------------- | ------------------------------------------------------------------ |
| `db:*`            | 盲库读写            | `db:saveSession` / `db:saveTradeAction` / `db:saveLabel` / `db:updateLabelStatus` / `db:getSessionActions` / `db:getSessionReview` / `db:listSessions` |
| `profile:*`       | 训练 profile        | `profile:list` / `profile:create` / `profile:load` / `profile:delete` / `profile:resetCapital` |
| `simulation:*`    | 模拟盘驱动          | `simulation:startSession` / `simulation:step` / `simulation:finish` |
| `behavior:*`      | 行为事件（v0.1 新）| `behavior:track` / `behavior:flush` / `behavior:getRecent`         |
| `data:*`          | 行情/同步（仅主）   | `data:init` / `data:sync` / `data:getKline` / `data:getStats` / `data:triggerIncrementalSync` |
| `modeling:*`      | 量化模型            | `modeling:listDatasets` / `modeling:createFeatureBuildTask` / `modeling:runSignalInference` |
| `backtest:*`      | 回测                | `backtest:run` / `backtest:report`                                |
| `research:*`      | Alpha 研究          | `research:factorIc` / `research:factorCorrelation`               |
| `app:*`           | 全局                | `app:quit` / `app:log`                                             |
| `aichat:*`        | AI 助手             | `aichat:getRecentSessions` / `aichat:getDefaultConfig`            |

**重要约束**：

- 同一 channel 名只能绑定到一个物理 DB 写操作（v0.1 修复 [modelDbLabelingIpc.ts](src/main/ipc/modelDbLabelingIpc.ts) 的 `db:saveLabel` vs `labeling:createLabel` 混用）
- 所有 channel 名进入 `packages/ipc-contracts/src/channels.ts` 常量化
- 跨进程（menu-bar → quant-desktop）走 HTTP/SSE，**不复用** IPC channel 命名

---

## 7. 共享类型演进

### 7.1 当前

[src/types/ipc.ts](src/types/ipc.ts) 一把梭，100+ 类型混在一起。

### 7.2 目标

`packages/ipc-contracts/src/`

```
channels.ts
db/
  session.ts            # SaveSessionInput / SaveSessionResult / SessionSummary
  trade-action.ts
  label.ts
  review.ts
profile/
  training-profile.ts
behavior/
  behavior-event.ts     # 新增
data/
  kline.ts
  sync-status.ts        # 新增（给 menu-bar 用）
modeling/
  dataset.ts
  training-task.ts
```

### 7.3 演进步骤

- P2：先把 `types/ipc.ts` 拆成多个文件，**不**改类型名
- P3：移到 `packages/ipc-contracts/src/`，**保持**类型名兼容
- P4+：按需重命名（breaking change 走 deprecation 提示）

---

## 8. 风险与回退

| 风险                                  | 概率 | 影响              | 缓解                                                            |
| ------------------------------------- | ---- | ----------------- | --------------------------------------------------------------- |
| monorepo 引入后 build 变慢             | 中   | DX 下降           | 用 Turborepo cache + 增量构建                                   |
| menu-bar 与 quant-desktop 写锁死锁    | 中   | 同步卡住          | 锁 30s 自动释放 + Tray 红色报警                                 |
| 盲训 Web 端不能跑本地 SQLite         | 高   | Web MVP 推迟      | v0.1 Web 端不写本地 DB，行为数据全走 menu-bar HTTP 转发         |
| `samples` / `strategies` 拆分后路径不一致 | 中 | quant 训练失败 | v0.1 在底座文档里明确"共享表"，由 `data-foundation` 统一 owner |
| `behavior_event` 写入拖慢 UI         | 低   | 训练卡顿          | 5s 批量 flush + 异步队列 + 失败吞掉                              |
| 仓体积膨胀                            | 中   | clone 变慢        | `pnpm` 软链 + `.gitignore` 收紧 + CI cache                      |

### 8.1 回退剧本

每阶段都准备：

```bash
# 1. 停止 menu-bar
osascript -e 'tell application "id.com.xudan.menu-bar" to quit'

# 2. 切回原仓 main
git checkout main

# 3. 启动原 quant-desktop（带 prod 库）
STOCK_TRADING_DB_PATH="$HOME/Library/Application Support/stock-trading-simulator/stock-trading.db" \
  npm run dev

# 4. 跑 safe-refactor.sh rollback
./scripts/safe-refactor.sh rollback
```

如果 P6 之后想完全回退到"单仓单 App"：直接 `git revert merge-of-p2-p6`，重装原 build。

---

## 9. 与 safe-refactor.sh 的衔接

| 阶段开始前 | 阶段结束后 |
| ---------- | ---------- |
| `./scripts/safe-refactor.sh start` | `status` 确认分支/DB 状态 |
| 切到 `refactor/split-blind-and-quant` 分支 | `verify` 检查 DB 完整性 |
| DB 复制到 `<userData>-refactor` 目录 | `rollback`（或合并到 main 后清理） |

脚本是 monorepo 演进的"地面安全网"——分支不丢、DB 可回退、env 可隔离。

---

## 10. 决策记录（ADR 摘要）

| #   | 决策                                                                  | 取舍说明                                                                                          |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | monorepo 而非 multi-repo                                              | 拆分初期跨包重构频繁；multi-repo 后期收益更大，但现阶段成本高                                      |
| 2   | pnpm workspaces（+ Turborepo 可选）                                   | 比 yarn workspaces 快；workspace 协议清晰                                                         |
| 3   | 单一写入者（menu-bar 持写锁）                                         | 避免多进程同时写 SQLite 的 WAL 抖动；读端用 `readonly: true` 即可                                  |
| 4   | 共享表用并集原则                                                      | quant-only / blind-only / shared 显式标记；不强行只保留"最小公倍数"                                |
| 5   | Menu Bar App 而非 launchd / launch-on-demand                         | 用户可见的同步状态是产品价值的一部分；用户可控的进程比系统服务更易调试                              |
| 6   | Web 端走 HTTP 不直连 SQLite                                           | 浏览器无本地文件 IO；menu-bar 作为统一入口把行为数据转发到本地库                                    |
| 7   | `behavior_event` MVP 仅 6 个事件                                      | 先验证 schema 与 SQL；后续按需扩展，避免 v0.1 收集"全量噪声"                                       |
| 8   | 不引入 soft delete / BOOLEAN                                          | 遵循 [data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md) P8/P9                         |
| 9   | 路径参数化前置（P1）                                                  | monorepo 改造之前必须先有 env 切换能力；否则后面无法隔离测试                                       |
| 10  | git branch 不用作长期拆分工具                                         | branch 适合临时偏离 → 合并；monorepo 才是长期多产品共存的形态                                       |

---

## 11. 阶段验收 checklist（P0-P7 通用）

- [ ] 对应阶段的代码 PR / 合并完成
- [ ] `npx tsc -b --noEmit` 无新增错误（项目规则硬要求）
- [ ] `npm run lint` 通过
- [ ] `node scripts/validate-platform-contracts.mjs` 通过
- [ ] `./scripts/safe-refactor.sh verify` DB 完整性 ok
- [ ] 至少一次 `./scripts/safe-refactor.sh rollback` 演练
- [ ] 阶段相关文档（4 份 docs/*）已更新或新增
- [ ] 与阶段相关的 IPC channel 命名遵循 §6 规范
- [ ] 新增表 / 字段按 [data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md) §7 migration 流程走

---

## 12. 相关链接

- Schema 契约：[docs/data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md)
- Menu Bar 同步进程规格：[docs/menu-bar-app-spec.md](menu-bar-app-spec.md)
- 行为事件表设计：[docs/behavior-event-design.md](behavior-event-design.md)
- 重构安全网脚本：[scripts/safe-refactor.sh](scripts/safe-refactor.sh)
- 项目规则：[.trae/rules/project_rules.md](.trae/rules/project_rules.md)
- 现状盘点参考：
  - 主库 schema：[src/main/db.ts](src/main/db.ts)
  - 盲库 schema：[src/main/blindDb.ts](src/main/blindDb.ts)
  - 外部行情库：[src/main/marketDb.ts](src/main/marketDb.ts)
  - 同步调度：[src/main/services/auto-sync.ts](src/main/services/auto-sync.ts)
  - 行情服务：[src/main/services/market-data.ts](src/main/services/market-data.ts)
  - 启动入口：[src/main/index.ts](src/main/index.ts)
  - 标签混用坑点：[src/main/ipc/modelDbLabelingIpc.ts](src/main/ipc/modelDbLabelingIpc.ts)
  - 反查盲库耦合点：[src/main/ipc/model.ts](src/main/ipc/model.ts) (L870, L1134)
  - App 模块与分组：[src/App.tsx](src/App.tsx) (L14, L26-111)
  - 平台 store：[src/stores/platformStore.ts](src/stores/platformStore.ts)
  - Preload 暴露结构：[src/preload/index.ts](src/preload/index.ts)
  - 盲训入口：[src/components/trading/BlindTrainingWorkbench.tsx](src/components/trading/BlindTrainingWorkbench.tsx)
  - Python 路径解析：[python/trading_trainer/db_path.py](python/trading_trainer/db_path.py)
