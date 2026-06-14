# 特征探索与因子挖掘工作台技术方案

**版本：** v0.1  
**状态：** 需求评估 + 技术方案草案  
**日期：** 2026-04-28  
**关联页面：** `模型训练` 的孪生研究页面  
**建议页面名：** `特征探索` / `因子挖掘`

## 1. 背景与判断

当前 `模型训练` 页面已经覆盖候选审核、标签审查、数据集冻结、特征构建、训练评估和集成实验，适合做“稳定执行”。但对量化模型开发来说，页面仍偏任务表单，缺少研究者需要的连续推理现场：

1. 不能在同一上下文中解释“为什么这样打标、为什么这个因子有效、为什么模型结果可信”。
2. 标签、数据集、特征、统计分布、可视化和训练指标分散在不同页签，难以形成实验笔记。
3. 缺少类似 JupyterLab / SageMaker Studio / Vertex AI Workbench / Databricks Notebook 的“参数 + Cell + 输出 + 产物追溯”范式。
4. 当前后端已有大量能力，但没有以研究 pipeline 的方式组织，例如标签抽样检查、数据集策略分析、PnL 归因、walk-forward、特征规格、训练任务和模型报告。

结论：新增一个与 `模型训练` 平行的孪生页面是合理的。它不替代当前页面，而是把同一套参数和产物组织成 Notebook 式研究工作台，用于数据打标理解、因子挖掘、特征诊断、统计分析、模型训练复盘和校正建议。

## 2. 产品定位

### 2.1 页面边界

`模型训练` 页面：

1. 面向稳定操作。
2. 以任务入口、任务列表、模型版本和激活为主。
3. 强约束流程：候选 -> 审核 -> 数据集 -> 特征 -> 训练。

`特征探索 / 因子挖掘` 页面：

1. 面向研究和诊断。
2. 以 Notebook cell、图表、统计摘要、代码/参数快照和实验报告为主。
3. 支持从当前配置页一键带入参数，允许反复跑局部 cell。
4. 输出可回写到当前训练链路：候选配置、标签策略、特征规格、训练任务、模型备注和实验报告。

### 2.2 目标用户

1. 量化研究：验证标签口径、挖掘因子、比较特征版本。
2. 模型开发：分析训练样本、特征重要性、过拟合、阈值和 walk-forward 稳定性。
3. 交易复盘：把模型信号、盲训 PnL、真实反馈串起来看。

## 3. 参考范式

本方案借鉴以下稳定产品范式，但在本地 Electron 应用内做轻量化落地：

1. Jupyter Notebook / JupyterLab：以 Markdown cell、Code cell、输出区域组织研究过程，支持富媒体输出。
2. SageMaker Studio / SageMaker Notebook：在一个工作区内做数据探索、可视化、训练、实验追踪和 pipeline 管理。
3. Vertex AI Workbench：托管 JupyterLab 环境和 notebook 执行，强调可复现的 notebook 文件和执行结果。
4. Databricks + MLflow：notebook 用于交互研究，MLflow/元数据表用于跟踪实验、参数、指标、模型和 dashboard。

这些范式对当前项目的启发是：不要只堆表单，要把“研究上下文、执行单元、结果输出、实验追踪、产物回写”做成一体。

参考链接：

1. [JupyterLab Notebook 文档](https://jupyterlab.readthedocs.io/en/stable/extension/notebook.html)
2. [Amazon SageMaker Notebooks](https://aws.amazon.com/sagemaker/unified-studio/notebooks/)
3. [SageMaker Unified Studio notebooks 文档](https://docs.aws.amazon.com/sagemaker-unified-studio/latest/userguide/notebooks.html)
4. [Databricks MLflow 文档](https://docs.databricks.com/aws/en/mlflow)

## 4. 当前代码能力评估

### 4.1 已具备能力

前端：

1. `src/components/trading/ModelTrainingWorkbench.tsx`
   - 已有候选审核、标签审查、数据集冻结、特征工程、训练评估、集成实验页签。
2. `src/components/trading/model/CandidateTab.tsx`
   - 已有候选生成、结果门槛参数、候选列表和审核动作。
3. `src/components/trading/model/LabelInspectPanel.tsx`
   - 已有批量波段标签生成、抽样审查、K 线可视化和标签详情。
4. `src/components/trading/model/DatasetTab.tsx`
   - 已有数据集草稿、冻结、回滚、合并、冲突策略评估、趋势/PnL/闭环归因。
5. `src/components/trading/model/FeatureTab.tsx`
   - 已有冻结数据集 + 特征规格 + 严格真实数据模式的构建入口。
6. `src/components/trading/model/TrainTab.tsx`
   - 已有训练任务、模型列表、指标对比和评估明细。

主进程 / IPC：

1. `modeling:*` 已覆盖候选、数据集、特征、训练、评估、推理、反馈、再训练。
2. `modelCliRunner.ts` 已能调用 Python CLI 构建特征和训练模型。
3. `global.d.ts` 已声明大部分 Renderer 可用 API。

Python：

1. `trading_trainer.cli label / feature / model` 已有标签、特征、训练、回测、阈值优化、walk-forward 命令。
2. `features/builder.py` 和 `features/specs.py` 支撑特征版本。
3. `models/lightgbm_trainer.py`、`catboost_trainer.py`、`walk_forward.py`、`backtester.py` 支撑训练和验证。
4. `labeling/overnight_labeler.py`、`swing_labeler.py` 和相关检查逻辑支撑标签质量分析。

数据层：

1. SQLite 已有 `signal_candidates`、`dataset_versions`、`dataset_items`、`feature_build_tasks`、`model_training_tasks`、`model_versions`、`model_evaluations`、`signal_events`、`signal_feedback`、`dataset_policy_evaluations`。
2. 文件系统已有 `features/` parquet 产物、`models/` 模型和报告产物。

### 4.2 主要缺口

1. 缺少研究实验实体：没有 `experiment`、`cell_run`、`artifact` 级别的追踪。
2. 缺少 Notebook 式前端：当前是 tab + form + table，不是 cell + output。
3. 缺少统一参数上下文：每个 tab 自己维护状态，不能形成一个 pipeline config。
4. 缺少因子研究 API：IC/RankIC、分箱收益、特征稳定性、缺失率、相关性、PSI、漂移检测等还没有前端契约。
5. 缺少报告导出：当前模型报告存在，但没有把一次研究过程导出为 Markdown / HTML / ipynb 的能力。
6. 缺少安全边界：如果直接嵌入完整 JupyterLab，需要处理本地任意代码执行、token、端口、文件访问和进程生命周期。

## 5. 推荐方案

建议采用两阶段策略：

### 5.1 P0：Notebook-like Pipeline Lab

先在 React 内实现 Notebook-like 页面，不直接嵌完整 JupyterLab。Cell 是产品化模板，由前端渲染，执行通过受控 IPC 调用现有 Python/SQLite 能力。

优点：

1. 与现有 Electron 安全模型兼容。
2. 复用现有 IPC、CLI 和数据表，开发成本低。
3. UI 可控，能把 K 线、表格、指标卡和报告做成一体。
4. 不允许任意 Python 代码，避免误删文件或污染环境。

缺点：

1. 不是真正的通用 notebook。
2. 自由研究能力弱于 JupyterLab。

### 5.2 P1：Local JupyterLab Bridge

在 P0 稳定后，再提供“打开高级 Notebook”能力：

1. 主进程启动本地 Jupyter Server / JupyterLab。
2. 使用随机 token、随机端口、项目内 `research/notebooks/` 工作目录。
3. 通过 `iframe` 或外部浏览器打开。
4. 自动生成 `.ipynb` 模板，注入当前 pipeline config。
5. 结果通过约定目录 `research/artifacts/<experiment_id>/` 回收。

建议 P1 不默认开放写入整个项目，只挂载必要目录：

1. `python/`
2. `features/`
3. `models/`
4. `research/`
5. Electron DB 路径只读优先，写入需通过 CLI 或 IPC。

## 6. 信息架构

新增主导航模块：

```ts
type AppModule =
  | 'overview'
  | 'blind'
  | 'model'
  | 'research'
  | 'deploy'
  | 'data'
  | 'aichat'
```

建议模块定义：

```ts
{
  id: 'research',
  label: '特征探索',
  category: 'Research Lab',
  summary: '以 Notebook pipeline 方式分析标签、样本、因子、特征、模型和回测稳定性。',
  outcome: '把模型训练过程解释清楚，并沉淀可复现的因子挖掘实验。',
  focus: ['标签诊断', '因子挖掘', '统计分析', '模型复盘']
}
```

页面布局：

1. 顶部：Pipeline Context Bar
   - 数据集、周期、标的范围、日期范围、标签方法、特征规格、训练引擎、trials。
   - 从当前 `模型训练` 页面导入参数。
   - 保存为 experiment。
2. 左侧：Cell Outline
   - 数据准备、标签诊断、样本分析、因子挖掘、特征构建、模型训练、评估报告。
3. 主区：Notebook Cells
   - 每个 cell 可运行、折叠、复制配置、查看日志、导出输出。
4. 右侧：Artifact Inspector
   - 当前实验的 dataset、feature_task、model_task、model_id、report、图表和日志。

## 7. Pipeline Cell 模板

### Cell 0：实验上下文

目的：统一所有 downstream cell 的参数来源。

参数：

1. `experiment_name`
2. `code_scope`: 全市场 / 股票池 / 单股 / 自定义列表
3. `period`: `5m` / `15m` / `1d`
4. `date_range`
5. `candidate_limit`
6. `outcome_gate_settings`
7. `label_method`: `exit_return` / `max_return` / `triple_barrier` / `rank_top20`
8. `holding_days`
9. `feature_spec`
10. `engine`: `catboost` / `lightgbm`
11. `trials`
12. `threshold`
13. `walk_forward_config`

输出：

1. 参数摘要卡。
2. 当前可用数据集、特征任务、模型任务状态。
3. 可复现 CLI 命令预览。

### Cell 1：数据覆盖与质量检查

目的：训练前确认行情数据是否足够。

输入：

1. 标的范围。
2. 周期。
3. 日期范围。

输出：

1. 股票覆盖率。
2. 日线 / 15m / 5m bar 数。
3. 缺口分布。
4. 最新数据日期。
5. 低质量标的列表。

复用：

1. `data:getStats`
2. `data:checkSufficiency`
3. SQLite `stock_kline_stats`

### Cell 2：候选信号生成与门槛解释

目的：解释候选如何产生，以及 outcome gate 如何筛掉低质量点。

输入：

1. 标的、周期、回看条数。
2. 因子策略集。
3. 结果门槛参数。

输出：

1. 候选数量、买卖比例、因子分布。
2. outcome tag 分布。
3. 分因子的通过率。
4. 候选 K 线叠加图。
5. 可回写的 outcome gate 建议。

复用：

1. `generateCandidates`
2. `listCandidates`
3. `getOutcomeGateSettings`
4. `updateOutcomeGateSettings`

### Cell 3：标签策略与打标审计

目的：理解不同 label method 对正负样本、收益口径和偏差的影响。

输入：

1. `label_method`
2. `threshold`
3. `holding_days`
4. `trend_filter`
5. `min_day_return`

输出：

1. 正样本比例。
2. `exit_return` vs `max_return` 差异。
3. `max_only` 样本数量。
4. 收益分布图。
5. 标签口径风险提示。

复用：

1. `generateLabels`
2. `getDatasetLabelDetails`
3. `LabelInspectPanel` 中的 K 线检查逻辑。

### Cell 4：人工抽样与标签修正

目的：把抽样审查放入研究 pipeline。

输出：

1. 分层抽样队列。
2. K 线 + 标签标记 + 前瞻收益路径。
3. 接受 / 拒绝 / 编辑动作。
4. 审核日志。

复用：

1. `getSwingReviewQueue`
2. `getSwingLabelDetails`
3. `reviewSignalCandidate`

### Cell 5：数据集冻结与版本对比

目的：在冻结前理解样本构成与冲突策略。

输出：

1. 样本数、标的数、周期分布、标签分布。
2. `keep_all` vs `single_best` 对比。
3. 冲突 bar 样本预览。
4. 与历史冻结版本重叠率。
5. 推荐冻结策略。

复用：

1. `previewDatasetDraftPolicies`
2. `createDatasetDraft`
3. `freezeDataset`
4. `compareDatasets`
5. `mergeDatasetsToDraft`
6. `listDatasetPolicyEvaluations`

### Cell 6：样本 EDA 与统计分析

目的：让训练样本的统计性质可见。

输出：

1. 样本时间分布。
2. 标的覆盖和行业覆盖。
3. 正负样本比例。
4. 按周期 / 因子 / 标签来源 / 市场阶段的分层统计。
5. 训练 / 验证 / 测试切分后的分布差异。
6. 缺失率、异常值、收益偏态和长尾样本。

新增 Python 能力：

```text
trading_trainer.research.dataset_profile
```

建议指标：

1. `positive_rate`
2. `sample_count_by_month`
3. `sample_count_by_code`
4. `label_distribution_by_factor`
5. `split_distribution`
6. `return_distribution`
7. `outlier_samples`

### Cell 7：特征构建与特征体检

目的：构建特征后立即检查是否可训练。

输出：

1. 特征规格说明。
2. train / valid / test 样本数。
3. 特征列数量。
4. 缺失率 Top N。
5. 零方差 / 低方差特征。
6. 相关性过高特征对。
7. 训练/测试漂移 PSI。

复用：

1. `createFeatureBuildTask`
2. `listFeatureBuildTasks`
3. `features/<dataset>/feature_spec_<version>/manifest.json`
4. parquet 文件。

新增 Python 能力：

```text
trading_trainer.research.feature_profile
```

### Cell 8：因子挖掘

目的：发现可解释、稳定、可交易的因子。

输出：

1. 单因子 IC / RankIC。
2. 分箱收益。
3. 多空组合收益代理。
4. 因子覆盖率。
5. 因子稳定性：按月份、周期、行业、市场阶段。
6. 因子相关性聚类。
7. 因子候选推荐。

建议指标：

1. `ic_mean`
2. `ic_std`
3. `ic_ir`
4. `rank_ic_mean`
5. `top_bin_return`
6. `bottom_bin_return`
7. `monotonicity_score`
8. `coverage`
9. `turnover_proxy`
10. `stability_score`

新增 Python 能力：

```text
trading_trainer.research.factor_mining
```

注意：

1. 因子分析必须严格使用 `feature_time <= signal_time`。
2. 不能用未来收益字段作为训练特征。
3. 分箱收益只能作为研究输出，不得回写到 feature parquet。

### Cell 9：可视化分析

目的：让研究过程可检查。

图表：

1. K 线 + 候选点 + 标签点 + 模型信号。
2. 收益分布直方图。
3. 因子分箱收益图。
4. 因子相关性热力图。
5. IC 时间序列。
6. 特征缺失率条形图。
7. train/valid/test 分布对比。
8. 回测资金曲线和回撤曲线。

前端实现：

1. K 线继续用 `klinecharts`。
2. 统计图 P0 可用 CSS/SVG/Canvas 轻量实现。
3. 如引入图表库，建议只引入一个库，优先考虑 `echarts` 或 `recharts`，避免图表体系分裂。

### Cell 10：模型训练与解释

目的：把训练从“点击开始”变成可解释的训练实验。

输出：

1. 训练参数。
2. 训练日志。
3. train/valid/test 指标。
4. 特征重要性。
5. 混淆矩阵。
6. 阈值扫描。
7. 错误样本 Top N。
8. 与当前 active model 对比。

复用：

1. `createModelTrainingTask`
2. `listModelTrainingTasks`
3. `listModels`
4. `listModelEvaluations`
5. `getModelReport`
6. `backtest:optimizeThreshold`

新增建议：

1. LightGBM / CatBoost 训练器输出标准化 `feature_importance`。
2. 训练报告写入统一 JSON schema，前端不再从非结构化文本中猜字段。

### Cell 11：Walk-forward 与交易检验

目的：避免只看单次 test 指标。

输出：

1. 每个窗口的样本范围。
2. 每个窗口的分类指标。
3. 每个窗口的保守回测收益。
4. 窗口稳定性评分。
5. 阈值敏感性。
6. 最大回撤和日均交易。

复用：

1. `model walk-forward`
2. `model backtest`
3. `model optimize-threshold`

### Cell 12：结论与回写

目的：把研究结论回到产品闭环。

可回写对象：

1. outcome gate 设置。
2. 数据集草稿 / 冻结版本。
3. 特征规格候选。
4. 模型训练任务。
5. 模型描述。
6. 实验报告。

输出：

1. `实验结论`
2. `建议动作`
3. `风险点`
4. `可复现命令`
5. `关联产物 ID`

## 8. 数据模型设计

新增 SQLite 表：

```sql
CREATE TABLE IF NOT EXISTS research_experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft', 'running', 'completed', 'archived')),
  base_dataset_id TEXT,
  config_json TEXT NOT NULL,
  summary_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS research_cell_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  cell_key TEXT NOT NULL,
  cell_type TEXT NOT NULL
    CHECK(cell_type IN ('context', 'data_quality', 'candidate', 'label', 'dataset', 'eda', 'feature', 'factor', 'visual', 'train', 'walk_forward', 'report')),
  status TEXT NOT NULL
    CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input_json TEXT,
  output_json TEXT,
  stdout TEXT,
  stderr TEXT,
  error_message TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (experiment_id) REFERENCES research_experiments(id)
);

CREATE TABLE IF NOT EXISTS research_artifacts (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  cell_run_id TEXT,
  artifact_type TEXT NOT NULL
    CHECK(artifact_type IN ('json', 'markdown', 'html', 'csv', 'parquet', 'png', 'model', 'dataset', 'feature_manifest', 'notebook')),
  title TEXT NOT NULL,
  path TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (experiment_id) REFERENCES research_experiments(id),
  FOREIGN KEY (cell_run_id) REFERENCES research_cell_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_research_experiments_updated
  ON research_experiments(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_cell_runs_exp
  ON research_cell_runs(experiment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_research_artifacts_exp
  ON research_artifacts(experiment_id, created_at);
```

不建议复制已有模型产物。`research_artifacts` 应保存引用，例如：

1. `dataset_id`
2. `feature_task_id`
3. `model_task_id`
4. `model_id`
5. `manifest_path`
6. `report_path`

## 9. IPC 契约设计

新增 `research:*` IPC：

```ts
researchListExperiments(limit?: number): Promise<UnknownRecord[]>
researchGetExperiment(experimentId: string): Promise<UnknownRecord>
researchCreateExperiment(input: {
  name?: string
  baseDatasetId?: string
  config: UnknownRecord
}): Promise<UnknownRecord>
researchUpdateExperimentConfig(
  experimentId: string,
  patch: UnknownRecord
): Promise<UnknownRecord>
researchRunCell(input: {
  experimentId: string
  cellKey: string
  cellType: string
  params?: UnknownRecord
}): Promise<UnknownRecord>
researchListCellRuns(
  experimentId: string,
  limit?: number
): Promise<UnknownRecord[]>
researchListArtifacts(
  experimentId: string
): Promise<UnknownRecord[]>
researchExportReport(
  experimentId: string,
  format: 'markdown' | 'html' | 'ipynb'
): Promise<UnknownRecord>
```

对应文件建议：

1. `src/main/ipc/modelResearchIpc.ts`
2. `src/main/ipc/modelResearchService.ts`
3. `src/main/ipc/modelResearchPythonRunner.ts`
4. `src/components/trading/ModelResearchWorkbench.tsx`
5. `src/components/trading/research/*`

## 10. Python 模块设计

新增模块：

```text
python/trading_trainer/research/
├── __init__.py
├── cli.py
├── dataset_profile.py
├── feature_profile.py
├── factor_mining.py
├── model_diagnostics.py
├── report_builder.py
└── schemas.py
```

新增 CLI：

```bash
python3 -m trading_trainer.research.cli dataset-profile \
  --dataset <dataset_id> --db <db_path>

python3 -m trading_trainer.research.cli feature-profile \
  --dataset <dataset_id> --spec <spec_version> --db <db_path>

python3 -m trading_trainer.research.cli factor-mine \
  --dataset <dataset_id> --spec <spec_version> --target return_pct --db <db_path>

python3 -m trading_trainer.research.cli model-diagnostics \
  --model <model_id> --db <db_path>

python3 -m trading_trainer.research.cli build-report \
  --experiment <experiment_id> --format markdown --db <db_path>
```

输出统一要求：

1. stdout 最后一行必须是 JSON。
2. JSON 必须包含 `success`、`metrics`、`tables`、`charts`、`artifacts`。
3. 图表 P0 返回结构化数据，由前端渲染；P1 可额外生成 PNG/HTML。

## 11. 前端组件设计

建议组件树：

```text
ModelResearchWorkbench
├── ResearchHeader
├── PipelineContextBar
├── ResearchLayout
│   ├── CellOutline
│   ├── NotebookCanvas
│   │   ├── NotebookCell
│   │   ├── CellToolbar
│   │   ├── CellOutput
│   │   ├── ChartOutput
│   │   ├── TableOutput
│   │   └── KlineOutput
│   └── ArtifactInspector
└── ExperimentDrawer
```

Cell 状态：

```ts
type CellStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'

interface ResearchCellDefinition {
  key: string
  title: string
  type: string
  description: string
  requiredParams: string[]
  runLabel: string
}
```

P0 先做固定模板 cell，不做任意 cell 新增。后续再支持自定义 Markdown cell 和 Python cell。

## 12. 与当前模型训练页的孪生关系

共享参数：

1. `dataset_id`
2. `spec_version`
3. `task_type`
4. `engine`
5. `trials`
6. `strict_real_dataset`
7. `outcome_gate_settings`
8. `label_method`
9. `holding_days`

共享产物：

1. 候选信号：`signal_candidates`
2. 数据集：`dataset_versions` / `dataset_items`
3. 特征：`feature_build_tasks` / `features/`
4. 模型：`model_training_tasks` / `model_versions`
5. 评估：`model_evaluations`
6. 反馈：`signal_events` / `signal_feedback`

跳转关系：

1. `模型训练 -> 特征探索`
   - 带入当前页签的参数，创建或打开 experiment。
2. `特征探索 -> 模型训练`
   - 回到稳定操作台，继续冻结、训练、激活。
3. `特征探索 -> 模型部署`
   - 直接查看模型版本、准实时预测和反馈。

## 13. 安全与资源控制

P0 安全策略：

1. 不执行用户输入的任意 Python 代码。
2. 所有 cell 只调用白名单 IPC / CLI。
3. Python 子进程 stdout/stderr 截断保存，避免数据库膨胀。
4. 大表输出只保存摘要和文件引用。
5. 长任务必须可取消。

P1 JupyterLab 安全策略：

1. 随机端口 + 随机 token。
2. 只绑定 `127.0.0.1`。
3. 独立工作目录 `research/notebooks/`。
4. 关闭远程访问。
5. Electron 退出时清理 Jupyter 进程。
6. 页面明确提示：高级 Notebook 可执行本机代码。

## 14. 分期计划

### P0.1：文档与入口

1. 新增技术方案文档。
2. 新增导航占位与页面骨架。
3. 建立 `research_experiments` / `research_cell_runs` / `research_artifacts` 表迁移。

验收：

1. 能创建实验。
2. 能保存 pipeline config。
3. 能显示固定 cell outline。

### P0.2：核心只读分析 cell

实现：

1. 实验上下文。
2. 数据质量。
3. 数据集画像。
4. 特征体检。
5. 因子挖掘只读报告。

验收：

1. 选择冻结数据集和特征规格后，可生成完整 profile。
2. 输出包含表格、指标卡和至少 3 类图表。
3. 所有输出可追溯到 experiment 和 cell_run。

### P0.3：训练诊断与回写

实现：

1. 模型训练 cell。
2. 模型诊断 cell。
3. walk-forward cell。
4. 报告导出。
5. 回写模型描述 / outcome gate / 数据集草稿。

验收：

1. 能从研究页触发或引用训练任务。
2. 能对比 active model。
3. 能导出 Markdown 实验报告。

### P1：JupyterLab Bridge

实现：

1. 本地 JupyterLab 启停。
2. 自动生成 `.ipynb` 模板。
3. 从实验上下文打开 notebook。
4. 产物目录回收。

验收：

1. 可打开包含当前参数的 notebook。
2. notebook 可读取必要数据和特征产物。
3. 研究产物可回到 Electron 页面查看。

## 15. 验收标准

功能验收：

1. 新页面能从现有模型训练页导入配置。
2. 一个实验能完整跑通：数据检查 -> 标签诊断 -> 数据集画像 -> 特征体检 -> 因子挖掘 -> 训练诊断 -> 报告导出。
3. 每个 cell 有状态、输入、输出、日志和产物引用。
4. 输出能解释标签质量、样本分布、因子有效性、特征风险和模型稳定性。
5. 研究结论能回写到当前生产式训练链路。

质量验收：

1. 不破坏现有 `模型训练` 页面。
2. 不改变已有训练/评估口径。
3. 所有研究任务可追溯、可重复。
4. 失败时给出可读原因。
5. 大任务不会阻塞 Renderer。

安全验收：

1. P0 不执行任意代码。
2. P1 JupyterLab 仅本地 token 访问。
3. Electron 退出时清理研究子进程。

## 16. 待决问题

1. 页面最终命名：`特征探索`、`因子挖掘`，还是 `研究工作台`。
2. P0 是否引入图表库；如果引入，建议统一一个。
3. 是否允许用户自定义 Python cell；建议放到 P1。
4. 因子挖掘指标的第一版范围：建议先做 IC/RankIC、分箱收益、缺失率、相关性、PSI。
5. JupyterLab 是否作为默认能力打包；建议不默认打包，先检测本机环境，缺失时给安装指引。

## 17. 推荐下一步

1. 先做 P0 Notebook-like 页面，而不是直接嵌完整 JupyterLab。
2. 优先实现只读研究分析，减少对现有训练链路的风险。
3. 把 `dataset_profile`、`feature_profile`、`factor_mining` 三个 Python 模块作为第一批能力。
4. 新增 experiment/cell/artifact 三张表，形成研究过程追踪。
5. 在当前 `模型训练` 页增加“打开特征探索”入口，把已选参数带过去。
