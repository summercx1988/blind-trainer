# 股票操盘训练与风格建模系统 - 总体架构

**版本：** v0.1  
**状态：** 架构草案  
**日期：** 2026-03-27

## 一、目标

本架构文档定义独立 future work 项目 `trading-trainer` 的总体分层、运行边界、数据流和模块关系。

目标是同时支撑两条主线：

1. `Blind Replay Trainer`
   匿名 K 线逐 bar 训练、复盘分析、影子策略对照
2. `Style Modeling Pipeline`
   手工打标、自动扩样、数据集版本、模型训练与评估

## 二、总体原则

1. 实时交互链路和离线训练链路分离。
2. 训练 UI 继续复用现有 Electron 桌面端。
3. 训练状态机、评分逻辑、匿名化逻辑保持可解释。
4. 风格打标和模型训练采用 Python 子系统承载。
5. 所有结果都必须可回溯到数据版本和规则版本。

## 三、分层架构

```text
┌─────────────────────────────────────────────────────────────┐
│                      macOS Desktop App                     │
├─────────────────────────────────────────────────────────────┤
│ Renderer (React)                                           │
│  - BlindTrainingWorkbench                                  │
│  - StyleLabelWorkbench                                     │
│  - SessionHistoryView                                      │
│  - ReplayReviewView                                        │
│  - DatasetModelCenter                                      │
│  - StyleProfileView                                        │
├─────────────────────────────────────────────────────────────┤
│ Preload / IPC Bridge                                       │
├─────────────────────────────────────────────────────────────┤
│ Main Process (Node.js / TypeScript)                        │
│  - SimulationAppService                                    │
│  - LabelingAppService                                      │
│  - ModelingAppService                                      │
│  - SQLite Repository                                       │
│  - MarketDataProvider                                      │
│  - PythonPipelineAdapter                                   │
├─────────────────────────────────────────────────────────────┤
│ Core (Pure Logic)                                          │
│  - SampleSelector                                          │
│  - Anonymizer                                              │
│  - ReplaySessionEngine                                     │
│  - SessionReviewScorer                                     │
│  - ShadowStrategyEngine                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│            Offline Python Labeling / Modeling              │
├─────────────────────────────────────────────────────────────┤
│  - Feature Pipeline                                        │
│  - Candidate Expansion                                     │
│  - Dataset Builder                                         │
│  - Model Trainer                                           │
│  - Model Evaluator                                         │
│  - MLflow / DVC Integration                                │
└─────────────────────────────────────────────────────────────┘
```

## 四、子系统边界

### 4.1 Electron 实时交互子系统

职责：

- 匿名训练样本发起
- K 线逐 bar 推进
- 买卖和持有动作记录
- 会话复盘与行为评分
- 手工风格打标
- 数据集和模型版本浏览

不负责：

- 大规模离线特征生成
- 批量扩样
- 模型训练和调参

### 4.2 Python 离线建模子系统

职责：

- 候选扩样
- 特征抽取
- 数据集构建
- 模型训练
- 模型评估
- 模型产物导出

不负责：

- 持续控制桌面端 UI 状态
- bar-by-bar 实时训练流程

## 五、数据流

### 5.1 训练会话流

```text
用户开始训练
  -> SampleSelector 抽样
  -> Anonymizer 生成匿名视图
  -> ReplaySessionEngine 维护仓位与动作
  -> SessionReviewScorer 生成收益与行为评分
  -> SQLite 持久化 session / action / review
```

### 5.2 风格打标流

```text
用户载入历史样本
  -> StyleLabelWorkbench 打标签
  -> 标签写入 SQLite
  -> 标签状态为 manual / accepted / rejected
  -> Dataset Builder 后续消费标签
```

### 5.3 自动扩样流

```text
种子标签集
  -> Feature Pipeline 生成候选特征
  -> Candidate Expansion 生成候选标签
  -> 人工抽样复核
  -> accepted 标签进入数据集版本
```

### 5.4 模型训练流

```text
Dataset Version
  -> Feature Pipeline
  -> Model Trainer
  -> Model Evaluator
  -> MLflow 记录实验
  -> 导出模型产物
  -> Model Registry 写入元信息
```

## 六、目录建议

### 6.1 文档目录

```text
docs/future_work/trading-trainer/
├── README.md
├── PRD.md
├── REQUIREMENTS_REVIEW.md
├── TECH_SELECTION.md
├── ARCHITECTURE.md
├── DATA_MODEL.md
├── ROADMAP.md
└── specs/
```

### 6.2 运行时代码目录建议

```text
src/main/application/trainer/
src/main/core/trainer/
src/main/services/trainer/
src/main/ipc/trainer/
src/renderer/components/trainer/
src/renderer/stores/trainer/
python/trading_trainer/
```

### 6.3 数据目录建议

```text
data/trading_trainer/
├── app.db
├── market_cache/
├── datasets/
├── features/
├── models/
├── exports/
└── reports/
```

## 七、关键接口边界

### 7.1 Electron 到 Python

通信方式建议：

1. v1 先使用 CLI 子命令 + JSON 文件输入输出
2. v2 需要更高频时再考虑本地 HTTP 服务

原因：

- CLI 更稳定
- 易于调试
- 不强依赖长期驻留进程

### 7.2 数据访问边界

1. 训练会话和标签元数据写入 SQLite。
2. 大体量特征、数据集清单、模型产物以文件目录管理。
3. `dataset_version_id` 和 `model_version_id` 作为跨层关联主键。

## 八、版本化原则

需要显式版本化的对象：

1. 标签政策版本
2. 匿名化规则版本
3. 特征规格版本
4. 数据集版本
5. 模型版本
6. 评分规则版本

## 九、性能目标

### 9.1 实时交互

- 开始训练 `< 500ms`
- 单步推进 `< 50ms`
- 复盘打开 `< 300ms`

### 9.2 离线任务

- 单批次候选扩样可以接受分钟级耗时
- 单模型训练可以接受分钟到小时级耗时
- 所有长任务都必须可中断、可重跑、可追溯

## 十、架构结论

1. 训练工作台和模型训练必须分层，不能做成一个大模块。
2. 现有 Electron 工程适合承接交互主线。
3. Python 子系统适合承接数据和模型主线。
4. SQLite + 文件化版本目录是当前最稳的真相层组合。
