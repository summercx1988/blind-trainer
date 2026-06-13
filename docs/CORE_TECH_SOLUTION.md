# 核心技术方案（双子系统并行）

**版本：** v1.2  
**日期：** 2026-04-15  
**状态：** 与当前代码对齐

## 1. 技术目标

在一个 Electron 桌面应用中承载两个平行子系统，并保持共享底座、业务闭环独立：

1. 盲训子系统：提升主观决策能力。
2. 模型训练子系统：因子候选 + 人审 + 训练 + 信号提醒。

核心原则：

1. 子系统边界清晰。
2. IPC 契约可追溯且类型一致。
3. 数据可复算、可回放、可审计。

## 2. 当前落地架构（代码级）

```text
Renderer (React)
├── App Shell (src/App.tsx)
│   ├── Dashboard (src/components/trading/Dashboard.tsx)
│   ├── Blind Training (src/components/trading/BlindTrainingWorkbench.tsx)
│   ├── Training History (src/components/trading/TrainingHistory.tsx)
│   ├── Model Training (src/components/trading/ModelTrainingWorkbench.tsx)
│   └── Data Management (src/components/trading/DataManagement.tsx)
├── blind domain
│   ├── types.ts
│   ├── sampleFactory.ts
│   └── tradingEngine.ts
└── history
    └── ReplayChart.tsx

Preload (src/preload/index.ts)
├── db.*
├── labeling.*
├── simulation.*
├── modeling.*
└── data.*

Main Process (src/main)
├── ipc/blind.ts
├── ipc/model.ts
├── ipc/modelDbLabelingIpc.ts
├── ipc/modelDatasetIpc.ts
├── ipc/modelResearchIpc.ts
├── ipc/modelSignalRetrainingIpc.ts
├── ipc/modelDatasetPolicyStore.ts
├── ipc/modelFactorCandidateService.ts
├── ipc/modelSignalInferenceService.ts
├── ipc/modelFeedbackRetrainingService.ts
├── ipc/data.ts
├── services/market-data.ts
└── db.ts

Storage
├── SQLite (会话、动作、标签、候选、数据集、模型、提醒、反馈、再训练)
├── Filesystem (特征产物、模型文件、评估报告)
└── seed.db / 本地增量同步缓存
```

## 3. 子系统边界

### 3.0 当前前台信息架构

1. `训练总览`：全局状态与快捷入口。
2. `盲训工作台`：盲训主执行面板。
3. `训练复盘`：盲训历史筛选、动作明细、回放查看。
4. `模型训练`：候选审核到训练评估的完整工作台。
5. `数据管理`：真实行情底座初始化与同步。

### 3.1 盲训子系统（独立闭环）

依赖：

1. `data:getRandomSamples` / `data:getKline`
2. `db:saveSession` / `db:saveTradeAction` / `db:finishSession`
3. `db:getSessionReview` / `db:listSessions`

不依赖：

1. 候选因子生成与审核流程
2. 模型训练与激活流程

### 3.2 模型训练子系统（独立闭环）

依赖：

1. `modeling:*` 全链路（候选、审核、数据集、训练、评估、提醒、反馈、再训练）
2. `data:sync` / `data:getStockList` 等数据能力

不依赖：

1. 盲训会话执行状态机

## 4. IPC 契约现状（与代码一致）

### 4.1 `db:*`

1. `getStatistics`
2. `saveSession`
3. `finishSession`
4. `saveTradeAction`
5. `saveLabel`
6. `updateLabelStatus`
7. `getSessionLabels`
8. `getSessionActions`
9. `getSessionReview`
10. `exportLabelsCSV`
11. `listSessions`

### 4.2 `simulation:*`

1. `startSession`
2. `getSession`
3. `applyAction`
4. `step`
5. `finish`
6. `getReview`

### 4.3 `labeling:*`

1. `runTask`
2. `getTask`
3. `listTasks`
4. `getResults`
5. `getSummary`

### 4.4 `modeling:*`

覆盖：候选生成/审核、数据集版本治理、特征构建、模型训练、评估、激活、推理、反馈与再训练。

### 4.5 `data:*`

1. `init`
2. `sync`
3. `getKline`
4. `getRandomSamples`
5. `getStockList`
6. `getStats`
7. `syncKline`
8. `batchSync`
9. `getCandles`

## 5. 数据模型现状（SQLite）

### 5.1 盲训域

1. `training_sessions`
2. `trade_actions`
3. `session_reviews`
4. `labels`

### 5.2 模型域

1. `signal_candidates`
2. `candidate_review_logs`
3. `dataset_versions`
4. `dataset_items`
5. `feature_build_tasks`
6. `model_training_tasks`
7. `model_versions`
8. `model_evaluations`
9. `signal_events`
10. `signal_feedback`
11. `retraining_runs`
12. `dataset_policy_evaluations`

## 6. 本轮已完成的架构治理

1. `App.tsx` 已升级为五模块壳层导航，修复“核心页面存在但无法到达”的产品结构问题。
2. 壳层 UI 改为统一信息架构：左侧模块导航 + 主工作区 + 快捷切换，降低双子系统切换成本。
3. `Dashboard.tsx` 补齐快捷入口，不再只服务盲训单线流程。
4. `preload/index.ts` 从最小映射升级为强类型全量映射，修复 Renderer/Main 接口错配风险。
5. 盲训模块新增领域分层：
   - `blind/tradingEngine.ts`：交易规则与结算逻辑
   - `blind/sampleFactory.ts`：样本归一与回退样本构造
   - `blind/types.ts`：领域类型
6. 全局样式基线重置（去模板默认 dark/purple/fixed-width），避免样式污染。
7. `model.ts` 的 IPC 注册已开始分域拆分：
   - `modelDbLabelingIpc.ts`
   - `modelDatasetIpc.ts`
   - `modelCandidateIpc.ts`
   - `modelSignalRetrainingIpc.ts`
8. `signal/retraining` 核心业务函数已下沉到：
   - `modelFeedbackRetrainingService.ts`
9. `signal inference + auto scan` 核心函数已下沉到：
   - `modelSignalInferenceService.ts`
10. `candidate factor generation` 核心函数已下沉到：
    - `modelFactorCandidateService.ts`
11. `dataset policy` 基础存储/推荐逻辑已下沉到：
    - `modelDatasetPolicyStore.ts`
12. `window.electronAPI` 的类型声明已与 preload 新增数据接口继续对齐，降低前后端契约漂移。
13. `DataManagement.tsx` 已拆分为同步面板、股票列表、标注操作等子模块，降低单文件 UI 状态密度，并把标注结果提示从弹窗改为页内反馈。
14. `BlindTrainingWorkbench.tsx` 已拆分出连续训练状态条、会话工具栏、账户概览、动作面板、结果面板等子组件，交易逻辑继续留在主文件，降低 UI 与状态机耦合。

## 7. 剩余技术债与优化方向

1. `src/main/ipc/model.ts` 已完成候选/推断/再训练下沉，但数据集策略分析、特征构建与训练任务创建仍在单文件，建议继续拆分 `datasetPolicy / featureBuild / trainingTask` service。
2. `Dashboard / BlindTrainingWorkbench` 仍有继续细分空间，但当前盲训页已完成第一轮组件化，下一步更适合把样本加载、会话状态与动作执行抽成独立 hook。
3. 当前壳层导航仍使用本地 state 切页，后续可评估轻量 router 或 URL 状态同步，以支持深链接与恢复现场。
4. 构建仍存在上游插件 warning（`customResolver` / `freeze`），需在依赖升级窗口统一处理。
5. 回归测试仍以手工 + build 为主，建议补充关键域逻辑自动化测试，优先 `tradingEngine` 与模型侧纯函数。

## 8. 迭代建议顺序

1. 继续拆分主进程 `modeling` 业务函数，优先 `datasetPolicy` 与 `trainingTask`。
2. 为盲训交易引擎补最小单测集（买入/卖出/跳过/自动平仓）。
3. 为盲训页继续抽离 `useBlindTrainingSession` 一类状态 hook，其次继续细化 `Dashboard`。
4. 在模型线补齐更严格时间切分评估与可视化报告。
