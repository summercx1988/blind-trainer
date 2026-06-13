# 股票操盘训练与风格建模系统 - 数据模型

**版本：** v0.1  
**状态：** 数据模型草案  
**日期：** 2026-03-27

## 一、目标

本文定义 `trading-trainer` 项目的核心实体、状态流转和持久化建议。

数据模型分三层：

1. `运行时层`
   训练会话、动作、评分
2. `标签层`
   手工标签、候选标签、审核结果
3. `建模层`
   数据集版本、特征版本、模型版本、评估结果

## 二、实体关系

```text
MarketInstrument
  -> TrainingSample
      -> TrainingSession
          -> SessionAction
          -> SessionReview

MarketInstrument
  -> StyleLabel
      -> DatasetItem
          -> DatasetVersion
              -> ModelVersion
                  -> ModelEvaluation

TrainingSession
  -> ShadowStrategyRun
```

## 三、核心实体

### 3.1 `market_instruments`

表示可训练的股票标的元信息。

关键字段：

- `stock_code`
- `stock_name`
- `market`
- `listing_date`
- `status`
- `industry`
- `is_st`

### 3.2 `training_samples`

表示从历史 K 线切出来的一段训练样本窗口。

关键字段：

- `id`
- `stock_code`
- `interval`
- `start_bar_index`
- `warmup_bars`
- `forward_bars`
- `regime_tag`
- `difficulty_score`
- `anonymize_level`
- `created_at`

### 3.3 `training_sessions`

表示一次真实训练过程。

关键字段：

- `id`
- `sample_id`
- `status`
- `started_at`
- `finished_at`
- `current_bar_index`
- `position_state`
- `realized_pnl_pct`
- `benchmark_return_pct`
- `skip_quality`
- `scoring_policy_version`

状态枚举：

- `running`
- `finished`
- `skipped`
- `aborted`

### 3.4 `training_actions`

表示一次 bar close 动作。

关键字段：

- `id`
- `session_id`
- `bar_index`
- `action_type`
- `fill_price`
- `position_state_before`
- `position_state_after`
- `confidence`
- `note`
- `created_at`

动作枚举：

- `buy`
- `sell`
- `hold`
- `idle`
- `skip`
- `finish`

### 3.5 `training_reviews`

表示一次训练会话的复盘结果。

关键字段：

- `id`
- `session_id`
- `trade_win_rate`
- `realized_pnl_pct`
- `max_drawdown_pct`
- `mfe_avg_pct`
- `mae_avg_pct`
- `entry_efficiency_score`
- `exit_efficiency_score`
- `discipline_score`
- `skip_quality`
- `insight_json`

### 3.6 `style_labels`

表示人工或自动生成的风格标签。

关键字段：

- `id`
- `stock_code`
- `interval`
- `bar_index`
- `label_type`
- `source`
- `status`
- `confidence`
- `label_policy_version`
- `review_decision`
- `note`
- `created_at`
- `updated_at`

标签类型枚举：

- `executable_buy`
- `executable_sell`
- `no_action`

来源枚举：

- `manual`
- `expanded`
- `reviewed`
- `model_inferred`

状态枚举：

- `proposed`
- `accepted`
- `rejected`
- `needs_review`
- `archived`

### 3.7 `dataset_versions`

表示一份可训练数据集的版本。

关键字段：

- `id`
- `name`
- `parent_version_id`
- `status`
- `label_policy_version`
- `feature_spec_version`
- `created_at`
- `created_by`
- `sample_count`
- `buy_count`
- `sell_count`
- `no_action_count`
- `manifest_path`

状态枚举：

- `draft`
- `frozen`
- `archived`

### 3.8 `dataset_items`

表示某个数据集版本中的具体样本条目。

关键字段：

- `id`
- `dataset_version_id`
- `style_label_id`
- `stock_code`
- `interval`
- `bar_index`
- `split`
- `feature_row_key`

切分枚举：

- `train`
- `valid`
- `test`

### 3.9 `model_versions`

表示一版模型。

关键字段：

- `id`
- `name`
- `task_type`
- `dataset_version_id`
- `feature_spec_version`
- `training_code_version`
- `artifact_path`
- `metrics_json`
- `status`
- `created_at`

任务类型：

- `buy_signal`
- `sell_signal`
- `joint_signal`
- `style_score`

状态枚举：

- `training`
- `active`
- `archived`
- `failed`

### 3.10 `model_evaluations`

表示一版模型在某次评估中的结果。

关键字段：

- `id`
- `model_version_id`
- `evaluation_type`
- `dataset_version_id`
- `precision_score`
- `recall_score`
- `f1_score`
- `auc_score`
- `strategy_return_pct`
- `report_path`
- `created_at`

评估类型：

- `offline_classification`
- `time_split_backtest`
- `style_consistency_check`

### 3.11 `shadow_strategy_runs`

表示某次训练会话对应的影子策略结果。

关键字段：

- `id`
- `session_id`
- `strategy_code`
- `entry_count`
- `exit_count`
- `realized_pnl_pct`
- `max_drawdown_pct`
- `diff_summary_json`

## 四、关键关系约束

1. 一条 `training_session` 必须关联一条 `training_sample`。
2. 一条 `training_action` 必须关联一条 `training_session`。
3. 一条 `training_review` 必须关联一条 `training_session`。
4. 一条 `dataset_item` 必须关联一条 `style_label` 和一条 `dataset_version`。
5. 一条 `model_version` 必须关联一条主 `dataset_version`。
6. 一条 `model_evaluation` 必须关联一条 `model_version`。

## 五、状态流转

### 5.1 风格标签状态

```text
manual -> accepted
expanded -> proposed -> accepted / rejected / needs_review
accepted -> archived
```

### 5.2 数据集版本状态

```text
draft -> frozen -> archived
```

### 5.3 模型版本状态

```text
training -> active
training -> failed
active -> archived
```

## 六、文件化产物

### 6.1 数据集目录

```text
data/trading_trainer/datasets/dataset_v001/
├── manifest.json
├── labels.parquet
├── splits.parquet
└── README.md
```

### 6.2 特征目录

```text
data/trading_trainer/features/feature_spec_v001/
├── manifest.json
├── train.parquet
├── valid.parquet
└── test.parquet
```

### 6.3 模型目录

```text
data/trading_trainer/models/model_v001/
├── manifest.json
├── model.bin
├── metrics.json
└── feature_importance.csv
```

## 七、版本标识规则

建议命名：

- 数据集：`dataset_v001`
- 特征规格：`feature_spec_v001`
- 标签政策：`label_policy_v001`
- 模型：`model_v001`
- 评分规则：`scoring_policy_v001`

## 八、数据模型结论

1. 训练会话和标签元数据适合进 SQLite。
2. 大体量特征和模型产物适合文件化。
3. 任何训练结果都必须能回溯到标签政策、数据集版本和特征规格版本。
