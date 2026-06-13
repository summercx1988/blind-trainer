# Stock Trading Simulator

一个面向个人交易者的人机协同桌面应用，当前包含两个平行子系统：

1. 盲训子系统：在真实股票历史 K 线图上做随机起点模拟盘训练，提升主观决策能力。
2. 模型训练子系统：由趋势/波段因子提名候选买卖点，经人工审核后沉淀训练数据，再训练预测模型。
3. 模型部署子系统：管理活跃模型、准实时预测、提醒反馈与再训练闭环。

## 当前代码里的产品入口

1. `训练总览`：训练日历、收益概览、数据状态。
2. `盲训工作台`：真实样本抽取、动作执行、会话结束复盘。
3. `训练复盘`：历史会话筛选、动作明细、回放查看。
4. `模型训练`：趋势/波段候选审核、数据集冻结、特征构建、训练评估。
5. `模型部署`：模型仓库、准实时预测、提醒反馈、再训练。
6. `数据管理`：股票池初始化、增量同步、覆盖率检查。

## 技术栈

1. `Electron 41`
2. `React 19 + TypeScript`
3. `Vite 8`
4. `better-sqlite3`
5. 本地文件系统用于模型与评估产物落盘

## 架构概览

当前项目采用本地单机桌面架构：

1. `Renderer (React)` 负责页面与交互。
2. `Preload` 通过 `window.electronAPI` 暴露桥接契约。
3. `Main Process` 负责 IPC、SQLite、任务编排与 Python 调用。
4. `SQLite + 本地文件系统` 保存业务元数据、模型和特征产物。
5. `Python 子进程` 承担特征构建、模型训练、回测与部分预测任务。

详细架构请查看：

1. [docs/ARCHITECTURE.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/ARCHITECTURE.md)
2. [docs/ALPHA_RESEARCH_PLATFORM_ARCHITECTURE.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/ALPHA_RESEARCH_PLATFORM_ARCHITECTURE.md)
3. [docs/REVERSAL_REBOUND_LABELING_TECH_SPEC.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/REVERSAL_REBOUND_LABELING_TECH_SPEC.md)

## 目录概览

1. [src/App.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/App.tsx)：统一应用壳层与模块导航。
2. [src/components/trading](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading)：盲训、模型、复盘、数据管理等前端模块。
3. [src/main](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main)：Electron 主进程、SQLite、IPC、数据服务。
4. [src/preload/index.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/preload/index.ts)：Renderer 与 Main 的桥接层。
5. [docs](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs)：当前有效 BRD、PRD、技术方案与路线图。

## 本地开发

```bash
npm install
npm run build
```

如需前端调试：

```bash
npm run dev
```

如需 Electron 构建：

```bash
npm run electron:build
```

## 当前状态说明

1. 当前代码已接通双子系统核心页面入口，不再只有盲训和数据页可见。
2. `npm run build` 可通过。
3. Vite 构建仍存在上游插件 warning：`customResolver` 与 `freeze`，属于后续工程治理项。

更多背景请查看：

1. [docs/README.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/README.md)
2. [docs/BRD.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/BRD.md)
3. [docs/PRD.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/PRD.md)
4. [docs/ARCHITECTURE.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/ARCHITECTURE.md)
5. [docs/CORE_TECH_SOLUTION.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/CORE_TECH_SOLUTION.md)
