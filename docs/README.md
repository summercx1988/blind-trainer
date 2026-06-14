# 盲训 App 文档总目录

> 本目录服务于**盲训独立 App**（仓库 [summercx1988/blind-trainer](https://github.com/summercx1988/blind-trainer)）。

## 当前代码对应的前台模块

1. `训练总览`：训练日历、累计收益、数据状态
2. `盲训工作台`：抽取随机起点 → K 线推进 → 买卖决策 → 复盘
3. `数据管理`：行情库初始化 / 手动同步 / 覆盖率诊断

## 当前有效文档

### 业务与产品
1. [BRD.md](BRD.md) — 业务需求文档
2. [PRD-blind-training.md](PRD-blind-training.md) — 盲训子系统执行版 PRD

### 架构与技术
3. [ARCHITECTURE.md](ARCHITECTURE.md) — 系统架构
4. [CORE_TECH_SOLUTION.md](CORE_TECH_SOLUTION.md) — 核心技术方案

### 数据库
5. [data-foundation-schema-v0.1.md](data-foundation-schema-v0.1.md) — 数据库 schema 契约（盲训仅用 `kline_daily` / `stock_list`）
6. [behavior-event-design.md](behavior-event-design.md) — 盲训事件表设计

## 历史归档

- [archive/2026-04-26/](archive/2026-04-26/) — 早期盲训问题修复记录
- [archive/2026-04-05/](archive/2026-04-05/) — 早期架构稿、历史 specs
- [archive/2026-04-23/](archive/2026-04-23/) — 已被主文档吸收的阶段性方案
- [archive/2026-06-split/quant-removed/](archive/2026-06-split/quant-removed/) — 早期已废弃的实验性文档（不再维护）

> 旧版 `split-plan-v2.md` / `monorepo-init.md` / `menu-bar-app-spec.md` 等已移除。当前仓库不维护任何"双 App"或"monorepo"相关方案。

## 使用顺序建议

1. **第一次接触本项目**：先读 [`BRD.md`](BRD.md) 了解业务
2. **了解代码架构**：读 [`ARCHITECTURE.md`](ARCHITECTURE.md)
3. **了解技术决策**：读 [`CORE_TECH_SOLUTION.md`](CORE_TECH_SOLUTION.md)
4. **了解 PRD**：读 [`PRD-blind-training.md`](PRD-blind-training.md)
5. **了解数据库**：读 [`data-foundation-schema-v0.1.md`](data-foundation-schema-v0.1.md)
