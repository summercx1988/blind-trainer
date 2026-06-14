# 盲训 App 文档总目录

> 本目录仅服务于**盲训 App**（仓库 [summercx1988/blind-trainer](https://github.com/summercx1988/blind-trainer)）。
>
> 🎯 量化交易 App 文档请见 [summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator)。

## 当前代码对应的前台模块

1. `训练总览`：训练日历、累计收益、数据状态
2. `盲训工作台`：抽取随机起点 → K 线推进 → 买卖决策 → 复盘
3. `数据管理`：行情库初始化 / 手动同步 / 覆盖率诊断

> ⚠️ 量化相关模块（模型训练 / 模型部署 / Alpha 研究）已迁出至独立量化 App 仓库。

## 当前有效文档

### 拆分与同步
1. `split-plan-v2.md` — 拆分方案 v2（**关键**）
2. `monorepo-init.md` — 拆分总览 v1（**已废弃**，保留供历史参考）
3. `menu-bar-app-spec.md` — 菜单栏 App 规格（**已废弃**，改用双 App 拆分）

### 业务与产品
4. `PRD-blind-training.md` — 盲训子系统执行版 PRD
5. `BRD.md` — 业务目标（原文档，盲训部分仍有效）

### 架构与技术
6. `data-foundation-schema-v0.1.md` — 数据库 schema 契约（盲训仅用其中 `kline_daily` / `stock_list`）
7. `behavior-event-design.md` — 盲训事件表设计（sessions / actions / review）
8. `ARCHITECTURE.md` — 旧版架构文档（盲训部分仍有效，整体架构已变）
9. `CORE_TECH_SOLUTION.md` — 旧版技术方案（盲训部分仍有效）

### 历史归档
10. `archive/2026-04-26/MULTI_SESSION_SYNC_BUG.md` — 盲训多会话资金同步修复记录
11. `archive/2026-04-26/TRAINING_OVERVIEW_PNL_CALENDAR_FIX.md` — 训练总览收益口径修复记录
12. `archive/2026-04-05/` — 早期架构稿、历史 specs
13. `archive/2026-04-23/` — 已完成或被主文档吸收的阶段性方案

## 不在本仓库的文档

盲训仓库**不包含**以下文档（这些都已迁到量化 App 仓库）：

- `PRD-model-training.md` — 量化模型训练 PRD
- `[已完成]ML_MODEL_TRAINING.md` — 模型训练主文档
- `LABELING_STRATEGY_*` — 打标策略相关
- `QUANTITATIVE_SYSTEM_DEEP_ASSESSMENT.md` — 量化系统评估
- `agents/data_analyst/` — AI agent 协作角色
- `python/` — Python 训练子工程

> 完整量化文档见 [summercx1988/stock-trading-simulator/docs](https://github.com/summercx1988/stock-trading-simulator/tree/main/docs)。

## 拆分相关文档

- 拆分总方案：[`split-plan-v2.md`](split-plan-v2.md)
- 双子系统历史快照：量化仓库的 `archive/dual-system` 分支（tag `v-dual-backup`）
- 量化 App 仓库：[summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator)

## 使用顺序建议

1. 第一次接触本项目：先读 [`split-plan-v2.md`](split-plan-v2.md) 了解拆分背景。
2. 了解盲训训练流程：读 [`PRD-blind-training.md`](PRD-blind-training.md)。
3. 了解数据库结构：读 [`data-foundation-schema-v0.1.md`](data-foundation-schema-v0.1.md) 和 [`behavior-event-design.md`](behavior-event-design.md)。
4. 历史 bug 排查：翻 [`archive/2026-04-26/`](archive/2026-04-26/)。

## 待整理事项

- [ ] 简化 `BRD.md` / `ARCHITECTURE.md` / `CORE_TECH_SOLUTION.md`（当前仍是双子系统版本）
- [ ] 移除量化相关归档文档（仅保留盲训相关）
- [ ] 编写盲训专属 README（在 docs/ 下）
