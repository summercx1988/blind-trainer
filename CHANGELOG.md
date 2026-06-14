# Changelog

本项目所有重要变更记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

> 🎯 盲训 App 仓库：[summercx1988/blind-trainer](https://github.com/summercx1988/blind-trainer)
>
> 📊 量化交易 App 独立仓库：[summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator)

## [2026-06-14] UI/UX 系统优化

> 基于本仓库 [ui-ux-financial-design skill](.trae/skills/ui-ux-financial-design/SKILL.md) + 新增 [ui-ux-pro-max skill](.trae/skills/ui-ux-pro-max/SKILL.md)。

### Added
- **UI/UX Pro Max skill**：安装到 `.trae/skills/ui-ux-pro-max/`，补充通用 UI 规则与交付检查清单（金融场景仍优先用 ui-ux-financial-design skill）。
- **Icons.tsx 共享组件**：10 个 SVG 图标（UserIcon / ChartBarIcon / GearIcon / CheckIcon / CloseIcon / CalendarIcon / TrendUpIcon / WalletIcon / TargetIcon / ClockIcon），位于 [src/components/common/Icons.tsx](src/components/common/Icons.tsx)。
- **Skeleton 骨架屏组件**：`Skeleton` / `SkeletonStatCard` / `SkeletonAccountCard`，带 shimmer 动画 + `prefers-reduced-motion` 适配，位于 [src/components/common/Skeleton.tsx](src/components/common/Skeleton.tsx)。
- **useCountUp hook**：数字滚动动画（300ms ease-out，尊重 `prefers-reduced-motion`），位于 [src/hooks/useCountUp.ts](src/hooks/useCountUp.ts)。
- **等宽字体变量**：`--font-mono`（JetBrains Mono / SF Mono fallback），位于 [src/index.css](src/index.css)。
- **CSS 动效**：面板 scale+fade（200ms）、结果摘要 fade-in，全部尊重 `prefers-reduced-motion`。

### Changed
- **盲训工作台布局**：上下堆叠 → 左右分栏（K线图 1fr + 操作面板 340px），符合 skill 规范"K线占视口主区域"。1024px 以下自动切回上下布局。
- **训练日历配色**：从 Material Design 涨绿跌红翻转为 **A股惯例涨红跌绿**（盈利 #e74c3c / #c0392b，亏损 #1b7e3e / #a5d6a7）。
- **账户卡片涨跌色**：`#ff8a80` / `#69f0ae` / `#a9feae` → `#e74c3c` / `#27ae60`（3 处 CSS），与统计卡片一致。
- **加载态升级**：TrainingOverview 从文字"加载中..."升级为 4 张骨架卡片 + 账户卡片骨架。
- **盲训周期收窄**：`PeriodType` 从 `'5m' | '15m' | '1d'` 收窄为 `'1d'`（AGENTS.md §2.1 约束）。
- **数据管理默认周期**：`['daily', '15m']` → `['daily']`。
- **SYNC_STRATEGIES**：移除 15m 相关策略。

### Removed
- **15 处 emoji 图标**：`👤 📊 ⚙ ✓ ✕ 📈 📅 💰 🎯 ⏱` 全部替换为 SVG 图标（符合 UI/UX Pro Max "禁止 emoji 图标"规则）。

### Fixed
- **aria-label 缺失**：交易按钮、开始训练、创建账户、关闭详情共 8 处补 aria-label；`actionError` 加 `role="alert"`。
- **拆分残件**：UI 仍暴露的 5m / 15m 选项已清除，与 AGENTS.md "盲训只用 kline_daily / stock_list" 约束对齐。

---

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
