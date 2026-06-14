# Changelog

本项目所有重要变更记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

> 🎯 盲训 App 仓库：[summercx1988/blind-trainer](https://github.com/summercx1988/blind-trainer)
>
> 📊 量化交易 App 独立仓库：[summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator)

## [2026-06-14] 拆分完成

### Added
- **独立 App**：从 `summercx1988/stock-trading-simulator` 拆分为盲训独立 App。
- **种子数据**：`data/blind-seed.db`（735MB，597 万行日线，2020-2026）+ 首次启动自动加载。
- **关闭 auto-sync**：避免与量化 App 重复拉取（"盲"训的核心约束）。

### Changed
- **package.json name**：`stock-trading-simulator` → `blind-trainer`，userData 路径独立。
- **模块裁剪**：删除 57 个量化文件（模型 / Alpha / 部署 / Python 子工程），保留 35 个盲训文件。
- **App.tsx**：8 模块 → 3 模块（训练总览 / 盲训工作台 / 数据管理）。
- **README.md**：从原项目"通用 README"重写为盲训专属 README。
- **AGENTS.md**：重写为"盲训 App 协作规约"。
- **docs/README.md**：明确"只服务盲训"。

### Removed
- 量化模块（数据基座 / AI 助手 / Alpha 探索 / 模型训练 / 模型部署 / 量化复盘）
- Python 训练子工程
- `agents/data_analyst/` 工具（已迁出至量化仓库）
- 15m / 5m K 线相关表
