# 股票交易模拟器系统架构

**版本：** v1.4  
**日期：** 2026-05-19  
**状态：** 当前有效  
**适用范围：** 当前仓库运行中的 Electron 桌面应用

## 1. 文档定位

本文档是当前代码的**架构真相文档**，用于说明系统分层、运行边界、核心模块关系和关键数据流。

配套文档分工如下：

1. `README.md`
   只保留项目简介、开发方式和简版架构概览。
2. `docs/ARCHITECTURE.md`
   维护当前生效的系统架构、模块边界和关键链路。
3. 阶段性方案文档
   维护架构优化、算法设计、研究平台等演进计划，不直接代表当前实现。

这也是比较常见的工程惯例：**README 放入口，独立架构文档放细节，方案文档放演进计划。**

## 2. 系统目标

系统当前承载三条业务主线：

1. 盲训子系统
   基于真实历史 K 线做逐 bar 模拟训练、动作记录、会话复盘。
2. 模型训练子系统
   完成趋势/波段候选生成、人工审核、数据集冻结、特征构建与模型训练评估。
3. 模型部署子系统
   完成模型仓库、活跃模型管理、信号推理、提醒反馈与再训练。

整体运行目标：

1. 维持桌面端单机可运行，不依赖独立后端服务。
2. 将高频交互留在 Electron 主进程与 Renderer 内部。
3. 将训练、特征、回测等离线能力交给 Python 子进程。
4. 通过 SQLite 和文件产物保持可追溯性。

## 3. 运行形态

当前系统是一个**本地单机桌面应用**，运行形态如下：

```text
React Renderer
  -> Preload Bridge
  -> Electron Main Process
  -> SQLite / Local Files
  -> Python CLI Subprocess
```

关键约束：

1. 不存在独立部署的 Web API 或后台服务。
2. 所有主数据、任务记录和大部分元信息都保存在本地 SQLite。
3. 模型、特征清单、评估报告等大文件保存在本地文件系统。
4. Python 以子进程方式调用，当前主要用于特征、训练、回测、预测相关离线任务。

## 4. 分层架构

### 4.1 总体分层

```text
┌───────────────────────────────────────────────┐
│ Renderer (React)                              │
│ - Dashboard                                   │
│ - BlindTrainingWorkbench                      │
│ - TrainingHistory                             │
│ - ModelTrainingWorkbench                      │
│ - DataManagement / Backtest / AiChat          │
├───────────────────────────────────────────────┤
│ Preload Bridge                                │
│ - window.electronAPI                          │
│ - IPC invoke contract                         │
├───────────────────────────────────────────────┤
│ Main Process (Node / TypeScript)              │
│ - app bootstrap                               │
│ - logger (electron-log)                       │
│ - db / session review                         │
│ - domain IPC handlers                         │
│ - market-data service                         │
│ - python cli runners                          │
├───────────────────────────────────────────────┤
│ Persistence / Local Runtime                   │
│ - SQLite                                      │
│ - models/ features/ reports                   │
│ - python/trading_trainer                      │
└───────────────────────────────────────────────┘
```

### 4.2 各层职责

#### Renderer

职责：

1. 页面状态与交互流程。
2. 工作台 UI 组合与数据展示。
3. 调用 `window.electronAPI` 获取数据或触发任务。

不负责：

1. 直接访问 SQLite。
2. 直接拉起 Python 任务。
3. 保存系统级状态真相。

#### Preload

职责：

1. 暴露 `window.electronAPI`。
2. 作为 Renderer 与 Main 的唯一桥接层。
3. 为关键建模链路暴露统一类型契约。

当前关键位置：

1. [src/preload/index.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/preload/index.ts)
2. [src/types/global.d.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/types/global.d.ts)

#### Main Process

职责：

1. 应用启动、窗口管理和种子库初始化。
2. IPC handler 注册和业务编排。
3. SQLite 访问与任务结果持久化。
4. 本地 Python CLI 调用。

当前入口：

1. [src/main/index.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/index.ts)

#### SQLite / 文件系统 / Python

职责：

1. SQLite 保存会话、标签、数据集、任务、模型元信息。
2. 文件系统保存模型产物、特征清单、报告。
3. Python 子系统执行特征构建、训练、回测、预测等任务。

## 5. 主进程模块边界

### 5.1 应用入口

1. [src/main/index.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/index.ts)
   负责窗口创建、DB 初始化、IPC 注册、种子库升级和兜底网络初始化。

### 5.2 基础设施

1. [src/main/logger.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/logger.ts)
   基于 `electron-log` 的统一日志模块。Main 进程所有日志写入 `~/logs/main.log`（5MB 自动轮转），Renderer 通过 `app:log` IPC 桥接写入同一文件。开发环境 console 级别为 debug，生产环境文件级别为 info。
2. [src/main/db.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/db.ts)
   SQLite 连接、DB 路径管理与 Schema Migration。当前版本 v5，v5 新增 `model_versions`（test_auc/accuracy/f1/precision/recall/train_auc）、`model_training_tasks`（test_auc/accuracy/f1）、`retraining_runs`（train_samples/test_samples/test_accuracy/test_f1/feature_count）的指标独立列，并自动回填旧数据。
3. [src/main/services/market-data.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/services/market-data.ts)
   行情同步与股票列表初始化。
4. [src/main/services/auto-sync.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/services/auto-sync.ts)
   自动同步调度器。每个交易日 15:15 自动执行增量同步（日线 + 15m），记录上次同步时间。
5. [src/main/sessionReview.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/sessionReview.ts)
   会话复盘统计逻辑。
6. [src/main/marketDb.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/marketDb.ts)
   市场行情库路径解析与只读 K 线加载。路径优先级为环境变量、`app_preferences.market_db_path_v1`、仓库 `data/trading.db`、主库兜底。

### 5.3 IPC 域划分

1. [src/main/ipc/blind.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/blind.ts)
   盲训会话、动作、资料和 profile 管理。
2. [src/main/ipc/data.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/data.ts)
   股票池、K 线、数据同步和覆盖率检查。
3. [src/main/ipc/modelDbLabelingIpc.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelDbLabelingIpc.ts)
   手工标签、盲训标签导出和旧标签队列兼容接口。
4. [src/main/ipc/backtest.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/backtest.ts)
   回测与阈值优化。
5. [src/main/ipc/model.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/model.ts)
   模型域组装层，继续承载尚未完全拆出的建模逻辑，并负责注册子模块。

### 5.4 模型域内部模块

当前模型域已形成“组装层 + 子模块”的结构：

1. [src/main/ipc/modelDatasetIpc.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelDatasetIpc.ts)
   数据集、特征、训练、预测、模型产物读取等 handler 注册。
2. [src/main/ipc/modelCliRunner.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelCliRunner.ts)
   特征构建与训练任务型 CLI 统一入口。
3. [src/main/ipc/modelFeatureCalculator.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelFeatureCalculator.ts)
   周期工具、时间转换、模型产物定位、实时特征计算。
4. [src/main/ipc/modelSignalInferenceService.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelSignalInferenceService.ts)
   活跃模型推理、自动扫描、信号落库。
5. [src/main/ipc/modelFactorCandidateService.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelFactorCandidateService.ts)
   因子候选生成。
6. [src/main/ipc/modelFeedbackRetrainingService.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelFeedbackRetrainingService.ts)
   反馈样本回灌与再训练编排。
7. [src/main/ipc/modelSignalRetrainingIpc.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelSignalRetrainingIpc.ts)
   信号反馈和再训练相关 handler。
8. [src/main/ipc/modelDatasetPolicyStore.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelDatasetPolicyStore.ts)
   数据集冲突策略评估与统计。
9. [src/main/ipc/platformResult.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/platformResult.ts)
   `PlatformResult<T>` 统一返回辅助。
10. [src/main/ipc/modelDbLabelingIpc.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelDbLabelingIpc.ts)
    标签 CRUD / 旧标签导出兼容层。
11. [src/main/ipc/modelResearchIpc.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/modelResearchIpc.ts)
    Alpha 研究页的数据集、特征任务和因子分析入口。

## 6. 前端模块边界

### 6.1 顶层页面

1. [src/components/trading/Dashboard.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/Dashboard.tsx)
2. [src/components/trading/BlindTrainingWorkbench.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/BlindTrainingWorkbench.tsx)
3. [src/components/trading/TrainingHistory.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/TrainingHistory.tsx)
4. [src/components/trading/ModelTrainingWorkbench.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/ModelTrainingWorkbench.tsx)
5. [src/components/trading/DataManagement.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/DataManagement.tsx)
6. [src/components/trading/BacktestPage.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/BacktestPage.tsx)
7. [src/components/trading/AiChat.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/AiChat.tsx)

### 6.2 模型训练工作台子页

模型训练工作台采用“顶层容器 + 训练阶段 tab”结构：

1. [src/components/trading/model/LabelingDatasetTab.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/model/LabelingDatasetTab.tsx)
   标签与数据集：策略打标、抽样审查、数据集管理。
2. [src/components/trading/model/FeatureTrainTab.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/model/FeatureTrainTab.tsx)
   特征与训练：特征构建、训练任务、Walk-Forward 面板。
3. [src/components/trading/model/EnsembleTab.tsx](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/components/trading/model/EnsembleTab.tsx)
   集成实验。

保留但已降级为子能力或兼容能力的组件：

1. `CandidateTab`：单股候选检查 / 诊断，不再作为流水线入口。
2. `DatasetTab`：被 `LabelingDatasetTab` 复用。
3. `FeatureTab` / `TrainTab`：被 `FeatureTrainTab` 复用。

模型部署工作台采用独立容器：

1. `RegistryTab`
2. `PredictTab`
3. `SignalTab`
4. `RetrainingTab`

当前特点：

1. 顶层只维护少量共享状态，如数据集列表、股票选项、活跃模型摘要。
2. 多数交互状态仍保留在 tab 内部，尚未引入全局 store。

## 7. 关键数据流

### 7.1 盲训会话流

```text
用户进入盲训
  -> Renderer 请求随机样本
  -> Main 从 SQLite / K 线数据中取样
  -> 前端逐 bar 推进并记录动作
  -> 会话结束后写入 session / action / review
```

### 7.2 标签生成流

```text
Renderer 提交标签生成参数
  -> modeling:generateSwingLabels
  -> Main 解析 marketDb / labelDb
  -> modelCliRunner 调用 Python swing_labeler CLI
  -> Python 从 marketDb 读取 kline_daily
  -> Python 写入 labelDb.signal_candidates
  -> Main 返回任务结果
  -> Renderer 进入抽样审查 / 数据集冻结
```

当前“贪心打标”入口实际策略名为 `greedy_uptrend_segment_v1`，实现位于 [python/trading_trainer/labeling/swing_labeler.py](/Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/labeling/swing_labeler.py)。实现已经包含趋势段构造、Swing Low/High、周线锚、L1 trend filter、候选评分和 beam search，不是纯从左到右贪心。

### 7.3 特征构建流

```text
冻结数据集
  -> modeling:createFeatureBuildTask
  -> modelCliRunner 启动 Python feature build
  -> feature_build_tasks 落库
  -> manifest 写入 features/ 目录
```

### 7.4 模型训练流

```text
冻结数据集 + 已完成特征构建
  -> modeling:createModelTrainingTask
  -> modelCliRunner 启动 Python model train
  -> model_training_tasks 落库
  -> model_versions / model_evaluations 写库
  -> 模型产物与评估报告写入本地文件
```

当前训练标签契约（v1.5+ 修复）：

1. 训练标签基于 Triple Barrier 结果映射：`take_profit → buy / y=1`，`stop_loss → sell / y=0`，`expired → 排除`（不进入训练集）。
2. 已移除随机负采样：标签全部由信号内部 Triple Barrier 二分类产生，避免训练/推理特征分布不一致。
3. 模型产物（artifact）元信息扩展：除原有模型文件外，统一写入 `positive_class`、`lookback_bars`、`label_distribution`，供推理路径一致性校验与可追溯。

### 7.5 模型预测流

```text
Renderer 发起 predictLive / predictBatch / predictSeries
  -> Main 调用对应 Python CLI 或本地推理逻辑
  -> 返回预测结果
  -> 部分链路可继续写 signal_events
```

当前预测路径约束（v1.5+ 修复）：

1. v005+ 特征依赖横截面数据，`predict_live` 等推理路径在构建实时特征前必须预加载同日全市场横截面数据，否则特征分布与训练不一致。
2. 推理路径强制校验 `lookback_bars` 最小值，不足时拒绝推理并返回明确原因，避免历史窗口不足导致的静默偏差。

### 7.6 自动同步数据流

```text
应用启动
  -> auto-sync 启动定时检查（每 5 分钟）
  -> 到达交易日 15:15
  -> 更新 stock_list（Sina 分页拉取）
  -> 批量同步所有股票日线增量（Sina 250 bars）
  -> 批量同步所有股票 15m 增量（Sina 250 bars）
  -> 记录 lastAutoSync 到 DB meta 表
```

前端「数据管理」页面为唯一数据更新入口，支持手动触发全量增量更新和部分同步两种模式。自动同步状态（上次/下次同步时间）在页面中展示。

## 8. 数据层与应用使用

### 8.1 SQLite 文件

当前存在三个数据库语义：

1. 主库 `stock-trading.db`
   由 [src/main/db.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/db.ts) 管理，是模型训练、模型部署、数据管理元信息和兜底行情数据的主存储。
2. 盲训库 `blind-training.db`
   由 [src/main/blindDb.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/blindDb.ts) 管理，保存盲训会话、动作、复盘、profile 和盲训标签。首次启动时会从主库迁移旧盲训数据，但正常业务写入应进入盲训库。
3. 市场行情库
   由 [src/main/marketDb.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/marketDb.ts) 解析。它可以是外部行情库，也可以回退到主库。模型打标和部分推理 / 回测链路会读取该库中的 `kline_daily`、`kline_5m`、`kline_15m` 等表。

### 8.2 主库表域

主库当前同时承载以下表域：

1. 模型标签与数据集：`signal_candidates`、`candidate_review_logs`、`dataset_versions`、`dataset_items`、`labeling_tasks`。
2. 特征与训练任务：`feature_build_tasks`、`model_training_tasks`。
3. 模型注册与评估：`model_versions`、`model_evaluations`。
4. 模型信号与反馈：`signal_events`、`model_recommendations`、`signal_feedback`、`retraining_runs`。
5. 数据集策略评估：`dataset_policy_evaluations`。
6. 数据管理与行情兜底：`stock_list`、`kline_daily`、`kline_5m`、`kline_15m`、`stock_kline_stats`。
7. 应用配置：`app_preferences`。
8. 历史兼容：主库仍保留 `training_sessions`、`trade_actions`、`session_reviews`、`labels`、`samples`、`strategies` 等早期盲训 / 标签表；新盲训业务以 `blind-training.db` 为准。

### 8.3 各应用层数据库使用

1. 数据管理
   主要通过 `getDb()` 写入主库行情表、股票池、覆盖率统计和同步状态；市场行情库路径配置写入 `app_preferences`。
2. 盲训工作台
   会话、动作、复盘和 profile 写入 `blind-training.db`；样本和 K 线读取仍依赖数据管理提供的行情数据。盲训页面可只读调用模型推理结果用于 K 线叠加。
3. 模型训练
   标签候选、审查状态、数据集版本、特征任务、训练任务、模型元信息都在主库。Python 打标 CLI 从 marketDb 读取行情、向 labelDb 写入 `signal_candidates`。
4. Alpha 研究
   从主库读取冻结数据集和特征任务，从本地 feature manifest / parquet 读取实际特征产物，计算结果以 JSON 返回给 Renderer。
5. 模型部署
   从主库读取 `model_versions` 和模型任务产物路径；信号扫描、推荐、反馈和再训练记录写回主库。行情读取可能走 marketDb。
6. 回测
   读取主库中的模型与评估信息，读取行情数据完成回测。当前策略回测结果表仍未完全独立化，经典策略 benchmark 方案见相关方案文档。

### 8.4 解耦性与耦合性

已解耦部分：

1. Renderer 不直接访问 SQLite，只通过 preload 暴露的 IPC 契约访问 Main。
2. 盲训运行数据已迁移到独立 `blind-training.db`，与模型训练表域分离。
3. 离线训练、特征、打标和研究能力通过 Python CLI 子进程运行，避免把重计算塞进 Renderer。
4. 模型主链路正在统一到 `PlatformResult<T>`，并有 [scripts/validate_platform_contracts.mjs](/Users/xudan/Documents/trae_projects/stock-trading-simulator/scripts/validate_platform_contracts.mjs) 做契约校验。

仍耦合部分：

1. Python CLI 直接读写 SQLite 表，尤其 `signal_candidates`、`dataset_versions`、`feature_build_tasks`、`model_training_tasks`，DB schema 变化会直接影响 Python。
2. marketDb 与主库的行情来源可分离，但特征构建当前仍主要围绕主库路径运行；若打标读取外部 marketDb、特征读取主库，可能产生标签 K 线与训练特征不一致。
3. 打标 UI、IPC、Python CLI 通过 `source_strategy` 字符串耦合；策略名变更会影响审查、数据集过滤和质量统计。
4. `signal_candidates` 同时承载趋势波段标签、未来反转/反弹标签、人工候选和反馈回灌样本，依赖 `source_strategy`、`factor_type`、`payload` 区分语义。
5. `model.ts` 仍保留较多历史数据集 / 标签逻辑，`modelDatasetIpc.ts` 中也有新逻辑，模型域尚未完全退化为纯组装层。
6. 标签重跑会删除同策略同股票范围内旧候选，并先解除 `dataset_items.candidate_id` 引用；冻结数据集样本本身不删除，但候选详情回溯会变弱。

## 9. 当前架构约定

### 9.1 当前正式契约

建模主链路正在统一到 `PlatformResult<T>`：

```ts
type PlatformResult<T> =
  | { success: true; data: T; error: null; code: null }
  | { success: false; data: null; error: { message: string }; code: string }
```

当前已覆盖：

1. 特征构建触发
2. 模型训练触发
3. 标签生成
4. 集成运行
5. 实时 / 批量 / 序列预测
6. 模型产物读取
7. 模型报告读取
8. 数据初始化
9. 数据增量同步
10. 15m 数据回补
11. 回测执行
12. 回测报告读取
13. 阈值优化
14. 盲训会话结束
15. 存档删除
16. 标签任务提交
17. 标签状态更新 / 评审
18. 信号反馈提交
19. 反馈候选回填
20. 全量 / 增量再训练触发
21. 模型激活 / 停用 / 重命名 / 删除 / 描述更新
22. 数据集策略预览 / 冻结 / 回滚 / 对比 / 合并
23. 候选信号生成 / 审核
24. 单次信号推理触发

当前最小契约校验脚本：

1. [scripts/validate_platform_contracts.mjs](/Users/xudan/Documents/trae_projects/stock-trading-simulator/scripts/validate_platform_contracts.mjs)
   用于校验 preload 与 `global.d.ts` 的关键 `PlatformResult<T>` 签名是否保持一致。

### 9.2 当前热路径保护原则

1. 实时推理链路不默认降级为“一次请求一个 Python CLI 进程”的统一方案。
2. 特征契约统一优先于运行时统一。
3. 未来若 Python 成为实时权威实现，应优先考虑本地常驻 worker，而不是直接按次 CLI。

## 10. 当前主要技术债

1. [src/main/ipc/model.ts](/Users/xudan/Documents/trae_projects/stock-trading-simulator/src/main/ipc/model.ts) 仍偏大，尚未完全退化为纯组装层。
2. ~~TS / Python 特征逻辑仍存在双实现，需要继续做契约统一和一致性校验。~~ → v1.4 已删除 TS 侧 buildLatestFeatureValues 死代码，所有推理统一走 Python CLI。
3. 少量查询型 IPC 与个别专用返回结构（如标签检查明细）仍未全面迁移到 `PlatformResult<T>`。
4. 前端跨页共享状态仍以局部 state 为主，是否引 store 需要在共享状态清单完成后再决定。
5. ~~打标入口文案仍叫"贪心打标"，但实现已经演进为趋势波段搜索与配对优化，命名与算法事实不完全一致。~~ → v1.4 Labeler Registry 支持任意标签策略，入口统一为 `label generate`。
6. ~~市场行情库与主库特征构建源需要继续统一，否则新打标算法接入后容易出现"标签来自 A 库、训练特征来自 B 库"的实验污染。~~ → v1.4 统一标签生成 CLI 接受 `--market-db` + `--label-db` 分离参数。

### 已解决的技术债

- ~~模型/数据集命名同质化~~ → v1.3 已通过序号+策略标签+日期后缀解决（[modelCliRunner.ts](src/main/ipc/modelCliRunner.ts)、[model.ts](src/main/ipc/model.ts)）。
- ~~高价值指标困在 JSON 列中，前端高频重复 JSON.parse~~ → v1.3 通过 Schema Migration v5 将 test_auc/test_accuracy/test_f1 等提取为独立列（[db.ts](src/main/db.ts)），前端优先使用列值。
- ~~feature_build_tasks / retraining_runs / labeling_tasks 等表无删除接口~~ → v1.3 新增 4 个删除 IPC + 1 个批量清理 IPC（[modelDatasetIpc.ts](src/main/ipc/modelDatasetIpc.ts)），前端 FeatureTab/RetrainingTab 新增删除按钮。
- ~~deleteTrainingTask 无运行状态检查~~ → v1.3 新增 running/queued 状态保护。
- ~~训练引擎/推理后端使用 if/elif 分发~~ → v1.4 引入 Registry 模式（`@register_trainer`/`@register_inference`），新增引擎 = 1 文件 + 装饰器。
- ~~walk_forward.py 硬编码 baseline/lightgbm，CatBoost 会静默走 lightgbm 路径~~ → v1.4+ 重构为 `get_trainer()` + `fit_window()` 统一训练，`get_inference()` 统一推理，消除全部 if/elif 分支。
- ~~TS 侧存在独立推理实现（predictLightGBM/buildLatestFeatureValues），与 Python 推理结果不一致~~ → v1.4 删除全部 TS 侧推理死代码，统一走 Python CLI。
- ~~modelFeatureCalculator.ts 残留 11 个无外部消费者的数学工具函数导出~~ → v1.5 Phase 6 全部清理。
- ~~数据集冻结时不记录 label policy 快照~~ → v1.5 Migration v7 新增 `label_policy_json` 列，`freezeDataset` 自动收集策略分布统计并写入。
- ~~walk_forward.py 训练逻辑仍使用 if/elif 区分引擎~~ → v1.5 每个 trainer 新增 `fit_window()` 静态方法，walk_forward 改为 `trainer_cls.fit_window()` 统一调用。
- ~~标签策略新增需改动 6+ 文件（Python labeler + TS runner + IPC + preload + 类型 + 前端面板）~~ → v1.4 Labeler Registry + 前端通用通道，新增标签器 = 1 Python 文件。
- ~~FeatureSpec 查表使用 11 层 if/elif~~ → v1.4 改为 `_SPECS` 字典查表 + `list_specs()`。
- ~~信号扫描只有 latest_snapshot 模式~~ → v1.4 新增 historical_replay 模式（全市场 × 日期范围）。

## 11. 架构文档维护约定

后续维护按下面规则执行：

1. 当前实现变化时，优先更新本文档。
2. 仅当“目标方案”变化时，更新对应方案文档。
3. 根 `README.md` 只维护：
   - 产品简介
   - 技术栈
   - 开发命令
   - 一段简版架构概览
   - 指向本文档的链接
4. 当某一架构方案失效时，移动到 `docs/archive/`，不要继续混在当前有效文档列表中。

## 12. 相关文档

1. [README.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/README.md)
2. [docs/README.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/README.md)
3. [docs/CORE_TECH_SOLUTION.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/CORE_TECH_SOLUTION.md)
4. [docs/GREEDY_UPTREND_LABEL_AND_BENCHMARK_PLAN.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/GREEDY_UPTREND_LABEL_AND_BENCHMARK_PLAN.md)
5. [docs/REVERSAL_REBOUND_LABELING_TECH_SPEC.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/REVERSAL_REBOUND_LABELING_TECH_SPEC.md)
