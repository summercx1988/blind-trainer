# AGENTS.md — 项目级 AI 协作规约

> 这是给所有 AI coding agent（Claude / Cursor / Aider / Trae / ...）阅读的项目级入口规约。
> 单文件放项目根；多角色 agent 时按需在 `agents/<role>/AGENT.md` 叠加人格与工具清单。
> 调研依据：见 [docs/agent-data-analyst.md](docs/agent-data-analyst.md)

---

## 0. 项目一句话

stock-trading-simulator 是一个 macOS 平台型 App（Electron + React 19 + Vite 8 + TypeScript + better-sqlite3）+ Python 训练子工程。当前正在拆分为**两个独立 macOS App**（盲训 / 量化），通过共享 data-foundation npm 包复用 schema 与同步逻辑。详见 [docs/split-plan-v2.md](docs/split-plan-v2.md)。

---

## 1. 项目结构速查

```
stock-trading-simulator/
├── src/
│   ├── main/           # Electron 主进程：DB / IPC / 同步
│   ├── preload/        # contextBridge 桥
│   ├── components/     # React 组件
│   ├── stores/         # zustand
│   ├── types/          # 共享类型
│   └── App.tsx         # 8 个 AppModule 路由
├── python/             # 训练子工程（pandas / lightgbm / optuna）
├── scripts/            # 运维脚本（含 safe-refactor.sh）
├── docs/               # 设计文档 / 拆分方案
├── agents/             # AI agent 角色与工具（见 §4）
└── data/               # seed.db
```

详细：[docs/monorepo-init.md §1](docs/monorepo-init.md)

---

## 2. 关键约束（硬性，不可违反）

### 2.1 数据库

- **路径可被环境变量覆盖**：`STOCK_TRADING_DB_PATH` / `TRADING_DB_PATH` / `TRADING_MARKET_DB_PATH`
- **迁移必须带 `description`**（[.trae/rules/project_rules.md](.trae/rules/project_rules.md)）
- `ALTER TABLE` 前必须 `PRAGMA table_info`
- 命名约定见 [docs/data-foundation-schema-v0.1.md §2](docs/data-foundation-schema-v0.1.md)

### 2.2 Python 是权威实现

- 所有模型推理必须走 `runPredictBatchCli`，**禁止** TS 侧独立实现特征计算或推理
- confidence 公式：`min(1.0, |score - threshold| / max(threshold, 1 - threshold))`
- 最低置信度默认 0.85

### 2.3 代码风格

- `npx tsc -b --noEmit` 必须通过
- 不添加注释（除非用户明确要求）
- React 19 + Hooks；zustand 管状态

### 2.4 拆分期间

- 任何数据写入先确认是否在隔离库（`./scripts/safe-refactor.sh status`）
- 拆分工作必须落在 `refactor/split-blind-and-quant` 分支 + `<userData>-refactor` 数据目录

---

## 3. 不做的事

- **不要**给"应该买什么"的交易建议（本项目是研究 / 训练工具）
- **不要**上传任何用户数据到云端（一切本地）
- **不要**修改 `dataset_policy_evaluations` 之外的旧表结构做"绕过"（沿用现有 schema）
- **不要**在 React 组件里直接做 SQLite 写（必须走 IPC）
- **不要**假定跨平台；本项目 macOS 优先

---

## 4. agent 角色注册表

| 角色             | 配置文件                              | 主要工具                              | 适用任务                       |
| ---------------- | ------------------------------------- | ------------------------------------- | ------------------------------ |
| `data-analyst`   | [agents/data_analyst/AGENT.md](agents/data_analyst/AGENT.md) | [agents/data_analyst/scripts/](agents/data_analyst/scripts/) | 盲训行为数据分析               |
| `quant-research` | （v0.2 规划）                         | python CLI                            | 因子 / 模型 / 回测分析         |
| `sync-ops`       | （v0.2 规划）                         | Menu Bar HTTP / scripts/              | 行情同步 / 数据诊断            |
| `docs-writer`    | （v0.2 规划）                         | docs/ + markdown                      | 设计文档 / PR 描述             |

> **命名约定**：表格第一列的 `data-analyst` 是**角色 key 名**（可带连字符，方便人读）；对应 Python 包目录是 `agents/data_analyst/`（下划线，Python 语法要求）。两者不冲突。

新增 agent 角色：在 `agents/<role>/AGENT.md` 注册并在此表追加一行。

---

## 5. 工作流建议

### 5.1 新功能落地

1. 读相关 docs（`docs/`）
2. 在隔离分支上做：`./scripts/safe-refactor.sh start`
3. 写代码 + 跑 `npx tsc -b --noEmit`
4. 单测 / 端到端测试
5. `./scripts/safe-refactor.sh rollback` 演练通过

### 5.2 排查数据问题

1. 看 [docs/data-foundation-schema-v0.1.md](docs/data-foundation-schema-v0.1.md) 确认表结构
2. 用 [agents/data_analyst/scripts/behavior_summary.py](agents/data_analyst/scripts/behavior_summary.py) 等工具拉数据
3. **不要**直接 `UPDATE`/`DELETE` 任何生产表

### 5.3 写新 SQL 分析

- 优先走 [agents/data_analyst/scripts/](agents/data_analyst/scripts/) 脚本，避免散落 ad-hoc
- SQL 注释引用对应 docs 章节（如 `-- ref: docs/behavior-event-design.md §5.1`）
- 输出统一 JSON schema（见 [agents/data_analyst/AGENT.md](agents/data_analyst/AGENT.md)）

---

## 6. 工具与环境

| 工具           | 用途              | 命令                                                                                  |
| -------------- | ----------------- | ------------------------------------------------------------------------------------- |
| safe-refactor  | 拆分安全网        | `./scripts/safe-refactor.sh {start,dev,status,reset,verify,rollback}`                  |
| tsc            | TS 编译检查       | `npx tsc -b --noEmit`                                                                 |
| eslint         | lint              | `npm run lint`                                                                        |
| data_analyst   | 行为数据分析      | `python -m agents.data_analyst.scripts.behavior_summary --db <path>`                  |

---

## 7. 相关链接

- **拆分方案（最新）**：[docs/split-plan-v2.md](docs/split-plan-v2.md)
- 数据底座契约：[docs/data-foundation-schema-v0.1.md](docs/data-foundation-schema-v0.1.md)
- 行为事件表：[docs/behavior-event-design.md](docs/behavior-event-design.md)
- data_analyst agent：[agents/data_analyst/AGENT.md](agents/data_analyst/AGENT.md)
- Agent 工作模式调研：[docs/agent-data-analyst.md](docs/agent-data-analyst.md)
- 项目规则：[.trae/rules/project_rules.md](.trae/rules/project_rules.md)
- ~~Menu Bar 规格~~：[docs/menu-bar-app-spec.md](docs/menu-bar-app-spec.md)（已废弃）
- ~~拆分总览 v1~~：[docs/monorepo-init.md](docs/monorepo-init.md)（已废弃）
