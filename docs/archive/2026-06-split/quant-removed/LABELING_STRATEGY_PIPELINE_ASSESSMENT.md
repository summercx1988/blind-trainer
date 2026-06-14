# 标签策略与 Pipeline 模块化评估

**日期：** 2026-05-18  
**状态：** 调研 / 设计待办  
**范围：** 只评估当前 pipeline 是否支持“规则候选 -> 路径验收 -> 模型筛选”的多标签体系，不代表已实现。

## 1. 核心结论

当前 pipeline 已经具备多标签策略实验的基础：

1. `signal_candidates.source_strategy` 可以隔离不同打标算法。
2. `payload.run_meta.run_id` 支持按标签版本构建数据集。
3. `dataset_versions` / `dataset_items` 支持草稿、冻结、回滚和冲突策略。
4. 特征构建和模型训练已经从冻结数据集启动，适合做策略 A/B 实验。

但当前还不是完全模块化 pipeline：

1. 标签生成入口仍按算法硬编码：`generateSwingLabels` 与 `generateReversalReboundLabels` 分开。
2. Python CLI runner 也按算法拆成独立函数，新增标签器需要同时改 UI、IPC、runner、preload 类型。
3. `signal_candidates.payload` 是半结构化 JSON，不同标签器字段不完全统一。
4. marketDb 与 feature build 使用的数据源需要更强追溯，否则可能出现“标签读取 A 行情库、特征读取 B 行情库”的口径漂移。
5. 标签重跑会删除同策略候选并解除 `dataset_items.candidate_id` 引用，冻结样本仍保留，但候选详情回溯会变弱。

所以当前状态适合新增少量标签算法做实验；若目标是“快速替换任意节点”，下一步应把标签生成、验收、数据集冻结、特征构建、训练评估都收敛到统一 pipeline contract。

## 2. 推荐 Pipeline 抽象

建议把买点研究拆为 5 个可替换节点：

```text
Universe / Market Data
  -> Candidate Generator
  -> Path Labeler / Validator
  -> Dataset Builder
  -> Feature Builder
  -> Model / Rule Evaluator
```

### 2.1 Candidate Generator

职责：只提出候选买点，不决定真值。

例子：

1. 上涨趋势回踩候选。
2. 大级别反转 / 反弹候选。
3. 突破后回踩候选。
4. 低波动收敛后放量突破候选。
5. 经典策略候选：MA、MACD、BOLL、Breakout。

### 2.2 Path Labeler / Validator

职责：用未来路径定义真值，避免把主观规则直接当成可训练标签。

可替换方法：

1. Triple Barrier：止盈、止损、时间屏障。
2. Fixed Horizon Return：固定持有期收益。
3. Cross-sectional Rank：同日横截面未来收益排名。
4. Trend Scanning：多窗口趋势显著性。
5. MFE / MAE Quality：最大有利波动和最大不利波动比值。

### 2.3 Dataset Builder

职责：从候选或 run 构建冻结数据集。

当前已有能力：

1. 按 `run_id` / `source_strategy` 创建草稿。
2. 支持 `accepted/proposed/rejected` 状态过滤。
3. 支持冲突策略：保留全部 / 同 bar 保留最高分。

待增强：

1. 写入完整 label policy：候选规则版本、路径验收版本、参数、marketDb 指纹。
2. 记录样本角色：`candidate_buy`、`paired_sell`、`negative_candidate`、`rank_sample`。
3. 支持负样本策略显式化，而不是只隐含在训练阶段。

### 2.4 Feature Builder

职责：严格只使用 `feature_time <= signal_time` 的数据。

待增强：

1. 特征构建应读取并校验标签生成时的 marketDb/source metadata。
2. 对不同标签族允许不同 feature spec，例如趋势延续、底部反转、横截面排序。
3. 实时推理特征与离线训练特征需要覆盖率对齐报告。

### 2.5 Model / Rule Evaluator

职责：判断模型是否真的超过纯规则。

每个标签策略至少输出：

1. 样本区间。
2. 候选数 / 标签数 / 覆盖率。
3. 正负样本比例。
4. 胜率、盈亏比、平均持仓、最大回撤。
5. Walk-forward 稳定性。
6. 与纯规则 benchmark 的差值。

## 3. 标签策略清单

### 3.1 已有或已接入

| 策略名 | 定位 | 胜率/覆盖倾向 | 当前状态 | 备注 |
|---|---|---:|---|---|
| `greedy_uptrend_segment_v1` | 上涨趋势波段 | 中高胜率 / 中覆盖 | 已接入 | 适合趋势延续模型 |
| `reversal_rebound_segment_v1` | 大级别反转 / 反弹 | 高胜率 / 低中覆盖 | 已接入 | 适合独立反转模型 |
| 经典 MA/MACD/BOLL/Breakout | 规则 benchmark | 视规则而定 | Benchmark 定位 | 不建议直接当 ML 标签 |

### 3.2 建议新增：高胜率方向

| 策略名建议 | 标签目标 | 候选来源 | 真值验收 | 优点 | 风险 |
|---|---|---|---|---|---|
| `trend_pullback_precision_v1` | 强趋势回踩后再启动 | MA20/60 上行、周线不弱、回踩 MA10/20 | Triple Barrier + 最小持仓 | 形态稳定，适合高胜率 | 样本少，错过急涨 |
| `breakout_retest_segment_v1` | 突破后回踩确认 | 箱体/前高突破后回踩不破 | Triple Barrier + 回撤约束 | 比追突破更稳 | 不回踩的强股会漏掉 |
| `relative_strength_leader_v1` | 强行业/强个股延续 | 行业相对强度 + 个股横截面排名 | Rank + Triple Barrier | 更接近“买强” | 依赖行业/指数数据质量 |
| `volatility_squeeze_breakout_v1` | 低波动收敛后扩张 | BOLL width / ATR 压缩 + 放量突破 | Triple Barrier | 捕捉趋势启动 | 假突破多 |
| `classic_signal_meta_label_v1` | 规则候选二次筛选 | MA/MACD/BOLL/Breakout 候选 | Triple Barrier / MFE-MAE | 最适合验证模型价值 | 容易同源过拟合 |

### 3.3 建议新增：高覆盖方向

| 策略名建议 | 标签目标 | 样本覆盖 | 真值口径 | 优点 | 风险 |
|---|---|---:|---|---|---|
| `fixed_horizon_return_v1` | 固定持有期收益 | 很高 | D+5/D+10/D+20 收益阈值 | 简单、覆盖高 | 噪声大，不看路径 |
| `cross_sectional_rank_top_v1` | 横截面相对强者 | 高 | 同日未来收益 Top 10%-20% | 类别分布稳定 | 熊市也会选出 Top |
| `daily_triple_barrier_all_v1` | 全样本路径标签 | 高 | 每日每股 TP/SL/时间障碍 | 交易路径更真实 | 参数敏感 |
| `trend_scanning_score_v1` | 未来趋势显著性 | 高 | 多窗口 OLS t 值 | 可做软标签 | 不天然等于可交易 |
| `mfe_mae_quality_v1` | 风险收益质量排序 | 高 | MFE / MAE、收益回撤比 | 适合 ranking | 解释门槛高 |

## 4. 建议实施顺序

### P0：先把 Pipeline Contract 固化

1. 新增统一标签生成入口：`modeling:generateStrategyLabels`。
2. 建立标签算法注册表：`algorithm -> python module -> supported params -> default source_strategy`。
3. 统一标签输出字段：
   - `label_family`
   - `candidate_sources`
   - `validator`
   - `entry_rule_version`
   - `label_policy_version`
   - `market_data_fingerprint`
   - `feature_time`
   - `signal_time`
   - `run_meta`
4. 数据集冻结时保存 label policy snapshot。

### P1：先做两个最有价值的新标签

1. `classic_signal_meta_label_v1`
   - 用经典策略只生成候选。
   - 用 Triple Barrier 判断候选是否值得做。
   - 与纯规则 benchmark 对比，验证模型是否有筛选价值。
2. `cross_sectional_rank_top_v1`
   - 提供高覆盖训练底座。
   - 适合训练排序模型或候选初筛模型。

### P2：补高胜率形态

1. `breakout_retest_segment_v1`
2. `trend_pullback_precision_v1`
3. `volatility_squeeze_breakout_v1`

### P3：组合与集成

1. 独立训练：趋势延续模型、反转反弹模型、meta-label 模型、横截面排序模型。
2. 用 ensemble 或 gating 合并信号。
3. 用 walk-forward 和真实回测决定是否上线。

## 5. 当前 Pipeline 对“规则 + 模型”范式的支持度

| 环节 | 当前支持度 | 评价 |
|---|---:|---|
| 多候选策略并存 | 70% | `source_strategy` 已够用，但入口硬编码 |
| 未来路径验收 | 65% | 反转标签已有 Triple Barrier，尚未抽公共 validator |
| 数据集版本化 | 80% | run-based draft 和 freeze 已可用 |
| 特征构建 | 65% | 能从冻结数据集构建，但数据源追溯需增强 |
| 模型训练 | 75% | LightGBM/CatBoost + Optuna 可用 |
| 策略 benchmark | 60% | 有方向和部分能力，结果表与页面仍需补齐 |
| 任意节点替换 | 45% | 需要统一 registry/contract 后才顺滑 |

## 6. 判断

当前 pipeline 可以支撑“新增 1-2 个标签策略并做研究验证”；但如果你的目标是“快速替换 pipeline 中任何一个节点”，现在还需要一次小型架构收敛。

最优路线不是立刻实现很多形态标签，而是先把打标节点抽象为：

```text
candidate_generator + path_validator + db_writer
```

这样后续新增任何买点逻辑，都只需要注册一个 generator 或 validator，而不是改 UI、IPC、runner、Python CLI 和数据集逻辑一整条链。
