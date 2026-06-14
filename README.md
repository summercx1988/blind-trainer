# Blind Trainer — 盘感训练

> 基于真实历史 K 线的盲训工作台：在"信息遮蔽"环境下做模拟盘，刻意训练盘感与决策速度。
>
> 🎯 **这是盲训 App 仓库**。量化交易 App 单独维护：[summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator)。

[![Platform](https://img.shields.io/badge/platform-macOS-blue)]()
[![Electron](https://img.shields.io/badge/Electron-41-9feaf9)]()
[![React](https://img.shields.io/badge/React-19-149eca)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)]()

## 这是什么

**主观交易者的盘感训练工具**。从一个随机起点开始，看真实的历史 K 线（仅限你已看过的 K 根），在不知道后续走势的前提下做买卖决策，最后复盘你的判断。

核心理念：**信息遮蔽 → 倒逼真本事**。市场不会给你未来函数，盘感训练也不应该。

## 核心能力

| 模块 | 职责 |
| --- | --- |
| **训练总览** | 训练日历、累计收益概览、数据状态 |
| **盲训工作台** | 抽取随机起点 → 推进 K 线 → 买卖决策 → 会话结束复盘 |
| **数据管理** | 行情库初始化 / 手动同步 / 覆盖率诊断（**不自动同步**） |

## 训练工作流

```
1. 抽取样本        在 [2020-2026] 历史区间随机选一个起点
2. 推进 K 线        一次一根，K 线即"行情"——和真实盘一样
3. 买卖决策        根据当前可见 K 线判断：买入 / 卖出 / 观望
4. 复盘            会话结束，揭示后续 K 线，看你的判断对不对
5. 累计收益        训练日历展示每日盈亏，量化你的盘感
```

> 关键：每次只看到"已经发生过的 K 线"，**没有未来函数**。

## 技术栈

- **运行时**：Electron 41 + Node.js
- **UI**：React 19 + TypeScript 5 + Vite 8
- **状态**：zustand
- **存储**：better-sqlite3
  - 行情库（`stock-trading.db`）：约 880MB，597 万行日线
  - 盲训库（`blind-training.db`）：你的训练会话记录
- **数据源**：sina / tencent / baostock（手动触发，不自动同步）

## 快速开始

### 环境要求

- macOS 13+
- Node.js 20+

### 安装与运行

```bash
# 1. 克隆
git clone https://github.com/summercx1988/blind-trainer.git
cd blind-trainer

# 2. 安装 Node 依赖
npm install

# 3. 启动开发模式（Vite + Electron）
npm run dev
```

### 首次启动：加载种子数据

App 首次启动时会自动检测 `data/blind-seed.db` 种子库：

```bash
# 仓库中不包含种子（735MB，gitignore 排除）
# 从打包版本获取 seed 文件，或从其他已就绪的 blind-trainer 拷贝：
mkdir -p data
cp /path/to/blind-seed.db data/blind-seed.db

# 然后启动 App
npm run dev
```

> 种子加载后会自动复制到 `~/Library/Application Support/blind-trainer/stock-trading.db`，**后续启动不依赖种子**。
>
> 如需更新行情：在 App 内"数据管理"页手动触发同步。

## 目录结构

```
blind-trainer/
├── src/
│   ├── main/                # Electron 主进程
│   │   ├── db.ts            # 行情库 schema（仅日线 + 股票池）
│   │   ├── blindDb.ts       # 盲训库 schema（sessions / actions）
│   │   ├── services/        # market-data / seed-loader
│   │   └── ipc/             # 22 个 IPC 桥（数据 / 盲训）
│   ├── preload/             # contextBridge（window.electronAPI 契约）
│   ├── components/trading/  # 3 个主模块的 React 组件
│   │   ├── TrainingOverview.tsx     # 训练总览
│   │   ├── BlindTrainingWorkbench.tsx  # 盲训工作台
│   │   └── DataManagement.tsx       # 数据管理
│   ├── stores/              # zustand
│   ├── types/               # 共享类型
│   └── App.tsx              # 3 个 AppModule 路由
├── scripts/
│   └── generate-seed.py     # 种子数据生成（从全量库导出日线）
├── docs/                    # 设计文档
└── data/                    # blind-seed.db（git 排除）
```

## 数据存储

| 库 | 路径 | 大小 | 用途 |
| --- | --- | --- | --- |
| 行情库 | `~/Library/Application Support/blind-trainer/stock-trading.db` | ~885MB | 597 万行日线（2020-2026） |
| 盲训库 | `~/Library/Application Support/blind-trainer/blind-training.db` | 动态 | 训练会话、动作日志、复盘 |
| 种子 | `data/blind-seed.db` | 735MB | 首次启动自动加载（git 排除） |

> **路径覆盖**：可通过 `STOCK_TRADING_DB_PATH` / `STOCK_TRADING_BLIND_DB_PATH` 环境变量覆盖。

## 为什么是"盲"训

- **不显示名称**：抽到的股票只显示代码，不显示公司名（避免先入为主）
- **不显示后续**：每次推进只看当前 K 线及之前的 K 线，**不能偷看未来**
- **不自动同步**：行情库一旦就位就不主动更新，避免你无意中用到"训练时还没发生的 K 线"

## 双 App 拆分说明

本仓库是从 [summercx1988/stock-trading-simulator](https://github.com/summercx1988/stock-trading-simulator) **量化 App** 拆分出来的盲训独立 App（2026-06 完成）。

| | 量化 App | 盲训 App（这里） |
| --- | --- | --- |
| GitHub | summercx1988/stock-trading-simulator | summercx1988/blind-trainer |
| 主线 | `main` | `main` |
| 备份 | `archive/dual-system`（双子系统快照）<br>tag `v-dual-backup` | — |
| 行情库 | ~/.../stock-trading-simulator/trading.db | ~/.../blind-trainer/stock-trading.db |
| 同步 | 自动 15:15 + 手动 | **仅手动**（种子 + 手动更新） |
| 目标用户 | 量化研究者 | 主观交易者 / 盘感训练者 |
| 包含 Python 训练子工程 | ✅ | ❌ |
| 需要 K 线 15m/5m | ✅ | ❌（只用于展示日线） |

> 拆分细节见 [docs/split-plan-v2.md](docs/split-plan-v2.md)。
>
> 双子系统的历史快照（量化 + 盲训共存版本）保留在量化 App 仓库的 `archive/dual-system` 分支。

## 文档

| 文档 | 用途 |
| --- | --- |
| [docs/README.md](docs/README.md) | 文档总目录 |
| [docs/split-plan-v2.md](docs/split-plan-v2.md) | 双 App 拆分方案 |
| [docs/behavior-event-design.md](docs/behavior-event-design.md) | 盲训事件表设计 |
| [AGENTS.md](AGENTS.md) | 项目级 AI 协作入口规约 |

## 开发规约

提交前必跑：

```bash
npx tsc -b --noEmit   # TypeScript 编译检查
npm run lint          # ESLint
```

## 路线图

- [x] 抽取随机起点 + K 线推进
- [x] 买卖决策 + 复盘
- [x] 训练日历 / 累计收益
- [x] 拆分为独立 App
- [x] 5 年日线种子
- [ ] UIUX 专业化改造（C 端传播方向）
- [ ] 盘感指标：决策速度、胜率、盈亏比
- [ ] 多用户档案管理
- [ ] 导出训练报告

## License

私有项目。
