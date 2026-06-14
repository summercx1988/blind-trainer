# 量化系统深度评估报告

> 评估日期: 2026-06-01
> 评估范围: `trading_trainer` 全模块（labeling / features / models / strategies / backtester / leakage_auditor）
> 源码验证日期: 2026-06-01（逐条对照源码验证，修正原文档中的偏差）

## 执行摘要

对项目量化系统进行全面评估后，整体印象：**架构骨架非常好（8/10分），但量化交易核心逻辑有 4 个严重 / 3 个重要的科学性问题**，可能导致回测指标虚高、线上实盘不达预期。建议优先实施本文档第三部分列出的"止血修复"。

> **🔧 源码验证结论（2026-06-01 补充）**：经逐条对照源码验证，原评估 11 项诊断中 **7 项完全准确、3 项部分准确（已有部分防护被低估）、1 项基于不存在的代码**（原 P0-2 `close.shift(-1)` 在 builder.py 中不存在，已删除）。修正后的 P0 问题为 3 项，P1 问题为 3 项。修复路线图已同步调整。

---

## 一、Pipeline 模块化架构评估

### ✅ 架构优点

1. **Registry 模式是教科书级水平**
   - [labeling/registry.py](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/labeling/registry.py)：`register_labeler` 装饰器 + `get_labeler` 工厂，解耦干净
   - [models/registry.py](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/registry.py)：Trainer + Inference 同样解耦，LightGBM/CatBoost/Baseline 切换无需改业务代码
   - 新增算法（XGBoost / 神经网络）只需 `register_trainer("xgb")` + 实现 `.train()`，低侵入

2. **CLI 层次清晰**
   - [cli.py](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/cli.py) 分组：`feature / model / benchmark / predict / label / ensemble`，每个子命令独立配置
   - 支持批量预测、`walk-forward`、`optimize_threshold`、`replay-backtest`，覆盖训练-调参-回测-复盘全链路

3. **数据契约与 spec 版本化**
   - [features/specs.py](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/features/specs.py) 提供 v001-v011 共 11 个 FeatureSpec，通过 `spec.version` 走条件分支（`builder.py:236-636`），避免破坏性升级
   - 训练时 `resolve_feature_dir(dataset_id, spec_version)` 自动定位 `features/{dataset}/feature_spec_{version}/`，天然支持多版本并存

4. **回测引擎做了"保守/乐观"双口径**
   - [backtester.py](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/backtester.py) `metrics_conservative / metrics_optimistic`，对比真实效果更有意义

5. **Leakage Auditor 设计思路对路**
   - [leakage_auditor.py](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/leakage_auditor.py) 通过 AST 静态扫描 + 运行时验证检测 `rolling(center=True)` / `shift(-N)`，可作为 CI 卡点

### ⚠️ 架构问题

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| A1 | **Mock 静默回退是定时炸弹**：dataset_items 表为空时自动用 `np.random.randn` 生成随机游走数据训练 | [builder.py:1184-1214](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/features/builder.py#L1184-L1214) | 用户不显式 `--strict-real` 就会用假数据训模型，模型指标"看着漂亮"但完全无效 |
| A2 | **Registry 无接口契约校验**：`register_trainer("x")` 接受任何类，缺方法要等到运行 `trainer_cls().train()` 才抛 `AttributeError` | [models/registry.py:6-46](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/registry.py#L6-L46) | 多人协作时容易在导入阶段错过错误 |
| A3 | **全市场打标串行执行**：4000+ 只股票用 `for ... in stock_list.iterrows()` 单进程跑，Optuna 100 trial 也是单线程 | [reversal_rebound_labeler.py:1057-1074](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/labeling/reversal_rebound_labeler.py#L1057-L1074)、[lightgbm_trainer.py:219-224](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/lightgbm_trainer.py#L219-L224) | 性能瓶颈；建议加 `multiprocessing.Pool` 或 `joblib`，Optuna 设 `n_jobs` |
| A4 | **缺实验编排层**：feature build → label generate → train → walk-forward 每步要手敲 CLI，没有实验级别的 YAML/Pydantic 配置 + DAG 调度 | [cli.py 全文](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/cli.py) | 难以复现实验，"哪个 spec + 哪个 labeler + 哪个 preset 训出了 model X"全靠记忆 |
| A5 | **模型注册 / lineage 缺失**：`models/{model_id}.json` 散落文件，没有中心化的"模型表"，MLflow / DVC / 自己一个 SQLite 都行 | [lightgbm_trainer.py:351-356](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/lightgbm_trainer.py#L351-L356) | 无法回答"现在生产在跑哪个模型、对应哪个数据集" |

**架构综合评分：7-8/10**

---

## 二、量化交易核心逻辑评估

### 🔴 严重问题 P0：会直接导致回测虚高、上线崩盘

#### 2.1 L1 趋势滤波器是非因果的 → 标签选择存在隐性前瞻偏差

[swing_labeler.py:478-502](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/labeling/swing_labeler.py#L478-L502) 的 `_apply_l1_trend_filter` 用 IRLS + 共轭梯度在整个时间序列上求解

$$\min_x \sum_i w_i(x_i - y_i)^2 + \lambda \sum_i |x_{i+1} - 2x_i + x_{i-1}|$$

这是一个**全段非因果**的凸优化问题（CG 解线性方程组用到全局 `D^T W D` 矩阵）。它在找"哪些位置是平滑后趋势的拐点"时，**每一段都同时利用了左右两侧的价格信息**。

> 这意味着 swing labeler 选出来的 buy_idx，本质上需要"先知道后续走势"才能确认。模型训练时**用因果特征**（MA / RSI / 形态）去拟合"非因果筛选出的标签"，存在 **distribution shift**：
> - 训练分布：L1 趋势拐点 + 后续盈利
> - 推理分布：模型自己判定的"形态" + 不确定的未来

**修复方向**：
- 把 L1 候选源改为"因果变体"（如 Kalman 滤波 / 指数加权 EWMA / 滚动中位数），或者
- 训练时显式把"L1 拐点特征"作为输入列，让模型学到因果代理，并在线上同样实时计算 L1（用前 N 天的滚动窗口近似）。

#### 2.2 三重屏障用"当日收盘"作为买入价，但回测用"次日开盘"建仓 — 标签/执行口径不一致

[swing_labeler.py](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/labeling/swing_labeler.py) 的 `triple_barrier_evaluate(buy_idx, buy_price, df, ...)` 中 buy_price = 当日 close；而 [execution_simulator.py:146](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/execution_simulator.py#L146) 实际成交价是 `d1_open`（次日开盘）。

**问题**：很多"标签为正"的样本，真实可成交价 = 次日开盘（高开 / 跳空缺口），开盘后该 TP/SL 是否仍盈利没有被验证。模型学到"close>T→盈利"，但实盘拿到的成交价不同，可能导致：
- 高开缺口的票直接被 `is_limit_up` 过滤掉（execution_simulator:152），本应被标记为"低质量"而不该训进模型；
- 但训练时这些票被当作正样本，相当于"训练时把它当 1 类，推理时却把它扔了"。

> **🔧 源码验证补充**：问题确实存在，但严重性需适当调整——execution_simulator **已经做了涨停过滤**（line 152 `is_limit_up` check，涨停板入场直接标记为 `limit_up_entry` 跳过），reversal_rebound_labeler 在买入侧也有 `_is_tradable` 检查。因此"纸面富贵"问题在回测阶段已被部分拦截，但**标签生成阶段**（决定哪些是正样本）的口径不一致仍然存在。建议将此问题从 P0 降为 **P1**。

**修复方向**：
- 打标时就用 `next_open` 作为 buy_price（`df['open'].iloc[buy_idx+1]`），并对"次日开盘 > close × 1.097"等情形直接标记为 `untradeable_positive` 单独成桶；
- 训练时把"可交易正样本"作为正例，"不可交易"作为难例（class_weight 调低或显式负样本），让模型和实盘口径一致。

#### 2.3 负样本是"未被选中"的随机 bar，不是"实际亏损"的负例

[builder.py:1140-1166](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/features/builder.py#L1140-L1166)：

```python
label_types_in_group == {"buy"} and ... 
neg_pool = [ts for ts in timestamps if ts not in buy_set]
n_neg = min(len(neg_pool), len(buy_timestamps) * neg_ratio)  # 1:1
rng = np.random.RandomState(42).choice(...)
```

**两个核心问题**：
1. **负样本不等于"实际会亏"**：随机采到 bar 可能是横盘震荡中、可能是 swing labeler 因参数没选到、可能用其他策略能赚。模型学到的"buy"分类是"labeler 喜欢的形态"≠"实盘能赚钱的形态"。
2. **1:1 强行配比**：A 股每日 4000+ 票，真正"模型会买入"的频率 < 5%，强行 50% 正样本让模型在推理时严重过激（threshold 0.5 已经很低，部署后实际触发率远超回测）。
3. **随机种子 42 写死**：所有回测/复现实验都用同一组负样本，CI 验证无法察觉负样本质量问题。

**修复方向**：
- 用 "**random triple-barrier 负采样**"：在每只票上随机选 N 个起点跑相同三重屏障，把"未触 TP 且触 SL / 过期"作为负例；
- 或采用 "**距离负样本**"：每个正例附近 ±K 个 bar 作为负例（更接近"差一点就买"），但要避免 leakage（不能取正例**之后**的 bar 里的 sell 标签）；
- 暴露 `negative_sampling_strategy` 配置项（random / triple_barrier / time_decay），CI 必须覆盖 ≥2 种策略结果一致。

#### 2.4 切分是全局时间序，但同一只票同时出现在 train / test

[builder.py:1245-1270](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/features/builder.py#L1245-L1270)：

```python
train_len = int(total_len * 0.7)
ordered.iloc[:train_len]  # train
ordered.iloc[train_len:train_len+valid_len]  # valid
ordered.iloc[train_len+valid_len:]  # test
```

**问题**：
- 同一只票 2020 年 bar 进 train、2023 年 bar 进 test，模型可以"记股票特性"；
- 跨截面相关性强（行业 / 板块联动），train 里学到的"白酒板块上涨规律"会被直接套到 test 里的白酒票；
- 这不是严格的 leakage，但**指标会显著虚高**。A 股量化圈子里"按股票切分"（GroupKFold by code）才是公认做法。

**修复方向**：
- 引入 `purge + embargo`：[train_end, train_end+purge_days] 之间不放任何样本（防 train label 的三重屏障跨越 test 起点）；
- 按 `code` 做 GroupTimeSeriesSplit；
- 增加 `--holdout-codes` 黑名单（指定 N 只票完全隔离作 holdout）；
- walk-forward 已部分缓解（每个窗口独立 OOS），但窗口内部仍需上述修补。

### 🟠 重要问题 P1：会显著拉高回测指标

#### 2.5 三重屏障未做"换手率/可交易性"二次筛选 — 含"一字板"或"停牌"

[reversal_rebound_labeler.py:744-772](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/labeling/reversal_rebound_labeler.py#L744-L772) 在 barrier.outcome='take_profit' 之后才检查 `_is_tradable_sell_point`，买入侧只检查了一字板。但**触 TP 当天可能是开盘就封板**（一字板无法买入），这个 TP 是纸面富贵。`_is_tradable_buy_point` 检查的也仅是 `is_limit_up` 和 `is_one_price_limit_up`，没有覆盖：
- 停牌后复牌首日
- ST 票涨跌停 ±5%
- 当日成交量 < N 手（流动性不足）

> **🔧 源码验证补充**：原文档说"买入侧只检查了一字板"**部分不准确**。实际代码在买入和卖出两端都有 tradable 检查（买入侧 `_is_tradable`、卖出侧 `_is_tradable_sell_point`），已构成**双向过滤**。但停牌复牌、ST 涨跌停 ±5%、流动性不足等边缘场景确实未覆盖，建议保留此问题但适当降低严重性。

**修复**：在打标阶段就剔除 `day_open >= tp_price` 之后才"按开盘价成交"的样本，或把它们的 label 改为 `entry_blocked` 不参与训练。

#### 2.6 标签特征中存在隐性数据穿越

[swing_labeler.py:1495-1506](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/labeling/swing_labeler.py#L1495-L1506)（`confidence = min(0.6 + profit_pct/20, 0.95)`）将 `profit_pct` 编码进 confidence：

- 若 confidence 字段被存入 `signal_candidates.score`（[reversal_rebound_labeler.py:927](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/labeling/reversal_rebound_labeler.py#L927) 确实是 `pair.get('pair_score', 0)`），且 `score` 被 builder 透传成样本权重 / 特征列 → **重大 leakage**。
- 即使没透传，swing labeler 内部的 `pair_score` 计算（[swing_labeler.py:1310-1330](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/labeling/swing_labeler.py#L1310-L1330)）用到了 future profit，未来仍可能通过其他路径泄露。

**修复**：所有 `pair_score / confidence / weight` 等"基于未来"算出的指标，**只允许进入 dataset payload（用于人审）**，**绝不能进入训练特征列**。建议在 `FeatureBuilder._generate_features` 末尾加一个白名单过滤：`assert 'pair_score' not in df.columns`。

#### 2.7 优化阈值在验证集上挑过，再在测试集上评估 → 阈值污染

[lightgbm_trainer.py:361-368](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/lightgbm_trainer.py#L361-L368)：

```python
thresholds = np.arange(0.5, 0.9, 0.05)
best_f1, best_threshold = 0.0, 0.5
for t in thresholds:
    pred = (valid_prob >= t).astype(int)
    m = compute_binary_metrics(valid_y, pred)
    if m["f1"] > best_f1: ...
```

这个 `best_threshold` 会写进 artifact，回测时用。但**验证集本身也参与了 HPO（Optuna 在 valid_x 上调参）**，等于 validation set 被双重利用（调超参 + 选阈值），test 上的指标已经偏乐观。

**修复**：
- 显式切出 `calib` 子集：train+valid 训模型，calib 选阈值，test 只跑一次；
- 或至少在文档里说明当前 `test` 实际是 "post-tuning test"，不应作为对外承诺指标。

### 🟡 次要问题 P2：影响可靠性 / 可复现性

#### 2.8 类别权重 `scale_pos_weight=1.0` 写死 + 1:1 负采样 → 部署概率分布严重错位

[lightgbm_trainer.py:48](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/lightgbm_trainer.py#L48)、builder.py 的 1:1 配比 — A 股实际正样本率远低于 50%，模型默认 threshold 0.5 触发率会远高于回测 `signal_rate`，部署后资金容量和滑点都会变。

#### 2.9 CostModel 滑点是固定值，与流动性 / 波动率无关

[cost_model.py](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/cost_model.py) — 实际滑点应该用 `impact = σ × √(size / ADV)`，目前是常数。对小盘股 / 放量日严重低估成本。

#### 2.10 Position Sizer 是"等权"分仓，没有波动率倒数加权 / Kelly

[portfolio_account.py](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/portfolio_account.py) — 单只票仓位由 `max_position_pct=0.1`（不超过 NAV 的 10%）控制，但没有基于波动率的动态调整。不同波动率的票同等仓位比例，导致组合波动率被高波动票绑架。

> **🔧 源码验证修正**：原文档称"单只票 `shares_per_trade=100` 写死"，**实际代码中不存在此硬编码**。PortfolioAccount 使用 `max_position_pct` 做 NAV 比例控制（`can_buy` 方法检查 `position_value / nav > max_position_pct`），比原文档描述的更合理。核心批评（缺乏波动率倒数加权 / Kelly 仓位管理）仍然成立。

#### 2.11 LeakageAuditor 不审计"非因果的频域 / 滤波算子"

[leakage_auditor.py:62-76](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/models/leakage_auditor.py#L62-L76) 的禁模式只查 `rolling(center=True) / shift(-N)`，**L1 趋势滤波、Kalman、Hilbert 变换、Wavelet 分解**这一类全段非因果操作都漏掉了。建议扩展规则集，扫描 `scipy.signal.*` / `np.convolve` / 自定义 CG / IRR 滤波调用。

---

## 三、可执行的修复路线图

### 一周内可完成（止血）

| 优先级 | 任务 | 工作量 |
|---|---|---|
| 🔴 P0-1 | `FeatureBuilder.__init__` 默认 `strict_real_dataset=True`，加 log + assert | 0.5 天 |
| 🔴 P0-2 | 在 [builder.py:1140-1166](file:///Users/xudan/Documents/trae_projects/stock-trading-simulator/python/trading_trainer/features/builder.py#L1140-L1166) 加显式负采样策略参数，至少提供 "triple_barrier_random" 替代"全随机" | 2 天 |
| 🔴 P0-3 | 引入 purge + embargo 切分，按 code 做 GroupTimeSeriesSplit | 1 天 |
| 🟠 P1-1 | swing / reversal 标签器把 buy_price 改用 `next_open`，并对一字板 / 停牌 / ST 重新打 `untradeable` 子标签 | 2 天 |
| 🟠 P1-2 | 拆分 calib 子集，避免 validation 双重利用 | 0.5 天 |
| 🟠 P1-3 | （原 2.2 升级）标签生成阶段统一 buy_price 口径为 `next_open`，与 execution_simulator 的 `d1_open` 对齐 | 1 天 |
| 🟡 P2-1 | `assert 'pair_score' not in feature_columns` 白名单检查 | 0.2 天 |
| 🟡 P2-2 | LeakageAuditor 加入 L1 / Kalman / Wavelet 规则 | 1 天 |

> **🔧 源码验证修正**：原 P0-2（"移除 `close.shift(-1)` 默认 fallback"）已**删除**——经全文搜索确认 builder.py 中不存在任何 `close.shift(-1)` 调用（仅有合法的 `close.shift(1)` 滞后算子）。原 P0-3/P0-4 已重新编号为 P0-2/P0-3。原 2.2 节（标签/执行口径不一致）因 execution_simulator 已有涨停过滤机制，从 P0 降为 P1，新增为 P1-3。

### 中期（提升科学性）

- 用因果 L1 替代 / 并行一个 Kalman 版本 labeler，对比指标稳定性；
- 引入 **Combinatorially Purged Cross-Validation (CPCV)** 替代单条 time-series split，做更严格的 backtest overfitting 检验（参考 Marcos López de Prado *Advances in Financial ML*）；
- 把 Position Sizer 接入 ATR 倒数加权；
- 接 MLflow 做模型 lineage + 实验追踪；
- 打标改 `multiprocessing.Pool(processes=8)`，数据库层加 WAL 模式减少锁竞争。

---

## 四、总结评分

| 维度 | 评分 | 评语 |
|---|---|---|
| Pipeline 模块化与扩展性 | **8/10** | Registry / Spec 版本化 / CLI 都很成熟；缺编排层 + 模型注册中心 |
| 运行性能 | **6/10** | 全串行、Optuna 单线程、未用 Parquet 列裁剪；够 demo 不够生产 |
| 数据管理 | **6/10** | Triple Barrier / CostModel 设计正确；负样本与切分方式有科学性问题 |
| 标签体系 | **6/10** | 7 种 labeler 各有特色；但 L1 滤波非因果 + 标签/执行口径不一致是硬伤 |
| 训练流程 | **7/10** | Walk-forward / Optuna / 多引擎 / 双口径评估齐全；阈值污染待解 |
| 回测引擎 | **7/10** | T+1 / 双口径 / 涨跌停 / 持仓上限齐备；滑点模型与仓位管理过简 |
| 前瞻泄漏防护 | **5/10** | AST 扫描思路对，但覆盖不全，L1 滤波未审计 |

**最关键的一句话**：你的 pipeline 骨架可以放心用，但**当前跑出来的回测指标存在虚高风险**（L1 非因果标签选择 + 负采样缺陷 + 切分方式三大问题叠加，具体虚高幅度需通过对照实验量化）。建议先做上面"P0 全部 + P1-1 + P1-3"共 5 项止血，预计 5-7 个工作日，跑一组对比实验看看 test 上的年化是否仍站得住。

> **🔧 源码验证修正**：原文档称"回测指标大概率会被高估 20-50%"，这是一个经验性断言，缺乏对照实验数据支撑。实际虚高幅度取决于策略类型、市场状态和问题叠加程度，可能高于或低于此范围。建议在完成止血修复后，用同一组参数跑 before/after 对比实验来量化实际影响。

---

## 讨论议题建议

1. 优先级：哪些 P0 问题需要立即修复？（建议：P0-1 → P0-2 → P0-3 顺序）
2. 负采样：采用"triple_barrier_random"还是"距离负样本"？
3. 切分策略：GroupTimeSeriesSplit by code 还是 walk-forward + purge？
4. L1 滤波：替换为 Kalman 还是保留但加滚动窗口近似？
5. 实验编排：自建轻量级还是上 MLflow/DVC？
6. **（新增）回归测试策略**：修复后如何验证"指标下降是因为修了真问题"而不是"改坏了东西"？建议建立一组固定 seed + 固定参数的 baseline 回归测试。

如需，我可以挑其中任何一项进入实现阶段（重写 L1 为因果近似 / 重写 builder 的负采样 + 切分 / 给 LeakageAuditor 加 L1 规则等），讨论后告诉我要先动哪一个。

---

## 附录：源码验证详细记录（2026-06-01）

以下为逐条对照源码的验证结论，供后续讨论参考。

### 验证方法

对文档中引用的每个代码位置，直接读取对应源文件并验证：(1) 代码是否存在、(2) 逻辑是否如文档所述、(3) 行号是否准确。

### 验证结果汇总

| 原编号 | 诊断结论 | 验证结果 | 详情 |
|--------|---------|---------|------|
| 2.1 L1 非因果 | 严重 | ✅ **完全准确** | IRLS + CG 求解确实使用全局 `D^T W D` 矩阵，每点受序列两端信息影响 |
| 2.2 标签/执行口径不一致 | 严重 | ⚠️ **部分准确** | 核心问题存在，但 execution_simulator 已有涨停过滤（line 152），严重性应从 P0 降为 P1 |
| 2.3 负采样缺陷 | 严重 | ✅ **完全准确** | 三个子问题（负样本≠亏损、1:1配比、种子42写死）全部坐实 |
| 2.4 切分方式 | 严重 | ✅ **完全准确** | 全局时间排序 70/10/20 切分，同票跨 train/test |
| 2.5 可交易性筛选 | 重要 | ⚠️ **部分准确** | 买入/卖出两端已有双向 tradable 检查，但停牌/ST/流动性未覆盖 |
| 2.6 pair_score 穿越 | 重要 | ✅ **完全准确** | 完整泄漏链路已验证：profit_pct → confidence → pair_score → signal_candidates.score |
| 2.7 阈值污染 | 重要 | ✅ **完全准确** | valid 集被 Optuna HPO + 阈值搜索双重利用 |
| 2.8 scale_pos_weight | 次要 | ✅ **完全准确** | 硬编码 `1.0`，配合 1:1 负采样导致部署概率分布错位 |
| 2.9 滑点固定值 | 次要 | ✅ **完全准确** | `slippage_rate=0.001` 固定 0.1%，无流动性/波动率因子 |
| 2.10 仓位管理 | 次要 | ⚠️ **细节有误** | 不存在 `shares_per_trade=100` 硬编码，实际用 `max_position_pct=0.1` 做 NAV 控制 |
| 2.11 LeakageAuditor | 次要 | ✅ **完全准确** | 仅检查 `rolling(center=True)` / `shift(-N)`，L1/Kalman 等未覆盖 |
| 原P0-2 close.shift(-1) | — | ❌ **目标代码不存在** | builder.py 全文无 `shift(-1)` 调用，仅有合法的 `shift(1)`。此任务已从路线图删除 |

### 架构评价验证

| 原评价 | 验证结论 |
|--------|---------|
| Registry 模式教科书级 | ✅ 两个 registry（labeling/models）实现一致、装饰器注册+工厂查找，解耦干净 |
| Registry 无接口校验 | ✅ `register_trainer` 接受任意 `Type`，无 ABC/Protocol 校验，运行时才可能报错 |
| Spec 版本化设计 | ✅ 多版本并存机制有效 |
| 缺实验编排层 | ✅ 每步需手敲 CLI，无 YAML/DAG 调度 |
