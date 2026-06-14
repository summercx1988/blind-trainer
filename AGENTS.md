# AGENTS.md — 盲训 App 项目级 AI 协作规约

> 这是给所有 AI coding agent（Claude / Cursor / Aider / Trae / ...）阅读的项目级入口规约。

---

## 0. 项目一句话

**盲训独立 App**（macOS Electron App）：基于真实历史 K 线的"信息遮蔽"盘感训练工具。

本仓库从 [summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator) 拆分而来（2026-06），**只承载盲训模块**（训练总览 / 盲训工作台 / 数据管理）。

**量化模块**在独立仓库 [summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator)，历史快照见其 `archive/dual-system` 分支（tag `v-dual-backup`）。

技术栈：Electron 41 + React 19 + TypeScript 5 + Vite 8 + better-sqlite3。详见 [docs/split-plan-v2.md](docs/split-plan-v2.md)。

---

## 1. 项目结构速查

```
blind-trainer/
├── src/
│   ├── main/           # Electron 主进程
│   │   ├── db.ts       # 行情库（仅 kline_daily / stock_list）
│   │   ├── blindDb.ts  # 盲训库（sessions / actions / reviews）
│   │   ├── services/   # market-data / seed-loader
│   │   └── ipc/        # 22 个 IPC 桥
│   ├── preload/        # contextBridge 桥
│   ├── components/trading/  # 3 个模块的 React 组件
│   │   ├── TrainingOverview.tsx
│   │   ├── BlindTrainingWorkbench.tsx
│   │   └── DataManagement.tsx
│   ├── stores/         # zustand
│   ├── types/          # 共享类型
│   └── App.tsx         # 3 个 AppModule 路由
├── scripts/            # 种子生成 + 运维
├── docs/               # 设计文档
└── data/               # blind-seed.db（git 排除，735MB）
```

---

## 2. 关键约束（硬性，不可违反）

### 2.1 数据库

- **路径可被环境变量覆盖**：`STOCK_TRADING_DB_PATH` / `STOCK_TRADING_BLIND_DB_PATH` / `TRADING_DB_PATH`
- **迁移必须带 `description`**
- `ALTER TABLE` 前必须 `PRAGMA table_info`
- 命名约定见 [docs/data-foundation-schema-v0.1.md §2](docs/data-foundation-schema-v0.1.md)
- **盲训只用 `kline_daily` / `stock_list` 两张表**

### 2.2 数据同步策略

- **不自动同步**——盲训行情库一旦就位就不主动更新（避免训练中用到未来 K 线）
- 如需更新行情：用户进入"数据管理"页手动触发同步
- 首次启动：`data/blind-seed.db` 自动加载到 userData 库

### 2.3 代码风格

- `npx tsc -b --noEmit` 必须通过
- 不添加注释（除非用户明确要求）
- React 19 + Hooks；zustand 管状态

### 2.4 拆分后协作

- 任何修改前先确认在 `blind-trainer/` 目录下（不要改 `stock-trading-simulator/`）
- 不要回写量化模块相关代码（已迁出）
- 盲训相关修复记录应在本仓库 `docs/archive/` 累积

---

## 3. 不做的事

- **不要**给"应该买什么"的交易建议（本项目是研究 / 训练工具）
- **不要**上传任何用户数据到云端（一切本地）
- **不要**在 React 组件里直接做 SQLite 写（必须走 IPC）
- **不要**假定跨平台；本项目 macOS 优先
- **不要**主动同步行情数据（"盲"训的核心约束）

---

## 4. agent 角色注册表

> 盲训 App 当前**不内置** AI agent 角色。盲训行为数据分析相关需求通过环境变量将数据导出到量化 App 仓库的 `agents/data_analyst/` 工具使用。

| 角色 | 配置文件 | 主要工具 | 适用任务 |
| --- | --- | --- | --- |
| `data-analyst` | [summercx1988/stock-trading-simulator/agents/data_analyst/AGENT.md](https://github.com/summercx1988/stock-trading-simulator/blob/main/agents/data_analyst/AGENT.md) | python scripts | 盲训行为数据分析（通过量化仓库工具） |

---

## 5. 工作流建议

### 5.1 新功能落地

1. 读相关 docs（`docs/`）
2. 在 `main` 分支做（盲训 App 不需要 safe-refactor 拆分网）
3. 写代码 + 跑 `npx tsc -b --noEmit`
4. 启动验证：`npm run dev`
5. 提交：`git commit -m "feat: ..."` → `git push`

### 5.2 排查数据问题

1. 看 [docs/data-foundation-schema-v0.1.md](docs/data-foundation-schema-v0.1.md) 确认表结构
2. 看 [docs/behavior-event-design.md](docs/behavior-event-design.md) 确认盲训事件表
3. **不要**直接 `UPDATE`/`DELETE` 任何生产表

---

## 6. 工具与环境

| 工具 | 用途 | 命令 |
| --- | --- | --- |
| tsc | TS 编译检查 | `npx tsc -b --noEmit` |
| eslint | lint | `npm run lint` |
| seed-gen | 种子数据生成 | `python3 scripts/generate-seed.py` |

---

## 7. 相关链接

- **拆分方案（最新）**：[docs/split-plan-v2.md](docs/split-plan-v2.md)
- 数据底座契约：[docs/data-foundation-schema-v0.1.md](docs/data-foundation-schema-v0.1.md)
- 盲训事件表：[docs/behavior-event-design.md](docs/behavior-event-design.md)
- 量化 App 仓库：[summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator)
- 量化 App 数据分析工具：[summercx1988/stock-trading-simulator/agents/data_analyst/](https://github.com/summercx1988/stock-trading-simulator/tree/main/agents/data_analyst)
- ~~Menu Bar 规格~~：[docs/menu-bar-app-spec.md](docs/menu-bar-app-spec.md)（已废弃）
- ~~拆分总览 v1~~：[docs/monorepo-init.md](docs/monorepo-init.md)（已废弃）
