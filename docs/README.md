# 盲训 App 文档总目录

> 本目录仅服务于**盲训 App**（仓库 [summercx1988/blind-trainer](https://github.com/summercx1988/blind-trainer)）。
>
> 📊 量化交易 App 文档请见 [summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator)。

## 当前代码对应的前台模块

1. `训练总览`：训练日历、累计收益、数据状态
2. `盲训工作台`：抽取随机起点 → K 线推进 → 买卖决策 → 复盘
3. `数据管理`：行情库初始化 / 手动同步 / 覆盖率诊断

## 当前有效文档

### 业务与产品
1. [BRD.md](BRD.md) — 业务需求文档（拆分后重写，v2.0）
2. [PRD-blind-training.md](PRD-blind-training.md) — 盲训子系统执行版 PRD

### 架构与技术
3. [ARCHITECTURE.md](ARCHITECTURE.md) — 系统架构（拆分后重写，v2.0）
4. [CORE_TECH_SOLUTION.md](CORE_TECH_SOLUTION.md) — 核心技术方案（拆分后重写，v2.0）
5. [split-plan-v2.md](split-plan-v2.md) — 双 App 拆分方案

### 数据库
6. [data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md) — 数据库 schema 契约（盲训仅用 `kline_daily` / `stock_list`）
7. [behavior-event-design.md](behavior-event-design.md) — 盲训事件表设计

## 历史归档

### 拆分相关（2026-06 拆分时归档）
- [archive/2026-06-split/quant-removed/](archive/2026-06-split/quant-removed/) — 拆分时移出的量化相关文档（27 份，**仅作历史参考**，本仓库不再维护）
- [archive/2026-04-26/](archive/2026-04-26/) — 早期盲训问题修复记录

### 更早期归档
- [archive/2026-04-05/](archive/2026-04-05/) — 早期架构稿、历史 specs
- [archive/2026-04-23/](archive/2026-04-23/) — 已被主文档吸收的阶段性方案

## 不在本仓库的文档

盲训仓库**不包含**以下文档（这些都已迁到量化 App 仓库）：

- `PRD-model-training.md` — 量化模型训练 PRD
- `[已完成]ML_MODEL_TRAINING.md` — 模型训练主文档
- `LABELING_STRATEGY_*` — 打标策略相关
- `QUANTITATIVE_SYSTEM_DEEP_ASSESSMENT.md` — 量化系统评估
- `agents/data_analyst/` — AI agent 协作角色
- `python/` — Python 训练子工程

> 完整量化文档见 [summercx1988/stock-trading-simulator/docs](https://github.com/summercx1988/stock-trading-simulator/tree/main/docs)。

## 使用顺序建议

1. **第一次接触本项目**：先读 [`split-plan-v2.md`](split-plan-v2.md) 了解拆分背景
2. **了解盲训业务**：读 [`BRD.md`](BRD.md)
3. **了解代码架构**：读 [`ARCHITECTURE.md`](ARCHITECTURE.md)
4. **了解技术决策**：读 [`CORE_TECH_SOLUTION.md`](CORE_TECH_SOLUTION.md)
5. **了解 PRD**：读 [`PRD-blind-training.md`](PRD-blind-training.md)
6. **了解数据库**：读 [`data-foundation-schema-v0.1.md`](data-foundation-schema-v0.1.md)
