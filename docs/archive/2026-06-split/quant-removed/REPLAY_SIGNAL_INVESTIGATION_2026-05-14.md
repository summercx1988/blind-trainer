# Replay 信号调研记录（2026-05-14）

## 1. 调研目标

本次只做调研，不修改业务逻辑。核心问题：

1. `replay` 是否按特征规格要求，使用 `t-n ... t` 的历史数据对第 `t` 根 bar 进行预测？
2. 当历史不足、特征不成熟、样本不合规时，模型推理是否会拒绝输出？
3. 为什么 `模型部署 -> 推荐复盘` 看到的买点明显多于 `test` 回测，而且很多形态不像上涨买点？

## 2. 调研范围

- 活跃模型：`cb_20260514115718726635`
- 模型名称：`catboost-买点-v004-260514-01`
- 任务类型：`buy_signal`
- 特征规格：`v004`
- 期望 lookback：`60 bars`
- 样本周期：`1d`

数据来源：

- SQLite: `/Users/xudan/Library/Application Support/stock-trading-simulator/stock-trading.db`
- 模型评估：`python/models/cb_20260514115718726635.eval.json`
- 模型回测：`python/models/cb_20260514115718726635.backtest.json`
- 调研脚本输出：`tmp_analysis/replay_signal_quality_report.json`

## 3. 代码链路结论

### 3.1 replay 的推理链路

当前 `replay` 路径为：

`runHistoricalReplay`  
-> `runHistoricalReplayScan()`  
-> `runPredictReplayCli()`  
-> `predict_historical_replay()`  
-> `build_live_features()`  
-> `FeatureBuilder._compute_feature_frame()`  
-> `predict_batch()`

关键点：

1. 会先加载某只股票的整段历史 K 线。
2. 再一次性计算整段历史上**每一根 bar**的特征。
3. 然后对每一行特征直接打分。
4. `score >= threshold` 的 bar 会被记为 `buy`，并写入 `model_recommendations(source='replay')`。

### 3.2 是否存在明显未来函数

就 `v004` 日线特征而言，本次未发现明显未来函数。主要使用：

- `rolling(...)`
- `ewm(...)`
- `shift(1)`

也就是说，特征大体是基于 `t` 及之前的数据计算的。

### 3.3 是否存在“样本不合规则拒绝预测”

当前实现**基本没有**这层门槛。只要：

1. 股票有 K 线；
2. 特征表非空；

就会继续预测。

未发现以下保护：

1. 没有按 `spec.lookbackBars` 做最小历史长度硬校验。
2. 没有针对“关键特征未成熟”直接拒绝输出。
3. 没有 `hold / no_signal / invalid_sample` 这种显式拒绝态。

相反，大量缺失值会被统一填成 `0.0`：

- 特征生成末尾：`replace([np.inf, -np.inf], np.nan).fillna(0.0)`
- 训练/推理取特征时：缺列补 `0.0`，缺值也补 `0.0`

这意味着：**历史不足或特征未成熟的 bar，并不会被拦住，而是可能被“补零后继续预测”。**

## 4. 定量证据

### 4.1 模型回测 vs 推荐复盘来源分布

全库 `model_recommendations`：

- `replay`: `80,635`
- `backtest`: `771`
- `realtime`: `0`

活跃模型 `cb_20260514115718726635`：

- `backtest`: `142`
- `replay`: `24,893`

说明：

1. 推荐复盘页若不筛来源，看到的主体不是 `test` 回测，而是 `replay` 历史回放。
2. `replay` 的量级远大于 `backtest`，视觉上会形成“信号特别多”的强烈印象。

### 4.2 活跃模型 test 回测口径

来自 `python/models/cb_20260514115718726635.backtest.json`：

- 阈值：`0.85`
- test 样本：`632`
- 回测买入信号：`142`
- 成交笔数：`142`
- 执行率：`1.0`
- 平均收益：`4.8111%`
- 胜率：`93.66%`
- 每日平均信号数：`3.09`

说明：

1. test 回测信号很稀疏。
2. 它并不是“每根 bar 都报买点”，而是严格筛出一小撮高分样本。

### 4.3 replay 与 backtest 的趋势形态对比

本次对活跃模型的 `replay` / `backtest` 信号日做了同口径 K 线状态统计：

| 指标 | backtest | replay |
| --- | ---: | ---: |
| 信号数 | 142 | 24,893 |
| 覆盖股票数 | 137 | 4,765 |
| `MA20` 向上占比 | 95.07% | 59.35% |
| `MA5 > MA20` 占比 | 91.55% | 51.84% |
| `close > MA20` 占比 | 90.14% | 52.17% |
| `avg_price_ma20_ratio` | 1.0264 | 0.9970 |
| `avg_up_day_ratio_10d` | 0.5268 | 0.4877 |
| `avg_trend_slope_10d` | 0.0926 | 0.0055 |

结论：

1. `backtest` 信号明显更接近上涨趋势中的买点。
2. `replay` 信号有接近一半甚至更多，发生在：
   - `close <= MA20`
   - `MA5 <= MA20`
   - `MA20` 不上行
3. 这与“我打标的买点基本都处于上升趋势中”的主观要求明显不一致。

### 4.4 replay 的信号密度异常高

| 指标 | backtest | replay |
| --- | ---: | ---: |
| 平均每日信号数 | 3.09 | 3556.14 |
| 每日信号中位数 | 2 | 3715 |
| 每日信号 p95 | 9 | 3825.5 |
| 单股票平均信号数 | 1.04 | 5.22 |
| 单股票信号中位数 | 1 | 6 |

结论：

1. `replay` 并不是“从 test 回测复刻信号”。
2. 它是在较短日期区间里，对全市场进行高密度逐 bar 扫描。
3. 该结果天然会造成“买点信号特别多”的现象。

### 4.5 历史不足样本仍然被预测

`v004` 的 `lookbackBars = 60`。  
但在活跃模型的 `replay` 结果中，仍然发现：

- `bar_index < 60`：`89` 条
- `bar_index < 20`：`19` 条

这说明：

1. 推理链路没有按 `lookbackBars=60` 做硬门槛拒绝。
2. 历史明显不足的样本仍然会输出买点。

典型例子：

- `920191`, `2026-05-14`, `probability=0.9701`, `bar_index=16`
- `920055`, `2026-05-14`, `probability=0.9807`, `bar_index=29`
- `603284`, `2026-05-14`, `probability=0.9803`, `bar_index=58`

其中 `603284` 甚至同时满足：

- `close < MA20`
- `MA5 < MA20`
- `MA20` 斜率非正

但仍输出高置信度 `buy`。

### 4.6 明显下降/弱趋势形态也被打出高分买点

典型 replay 例子：

1. `601998`, `2026-05-14`
   - `probability=0.9985`
   - `close < MA20`
   - `MA5 < MA20`
   - `MA20` 斜率非正
   - `up_day_ratio_10d=0.2`

2. `600138`, `2026-05-14`
   - `probability=0.9981`
   - `close < MA20`
   - `MA5 < MA20`
   - `MA20` 斜率非正

3. `600169`, `2026-05-14`
   - `probability=0.9980`
   - `close < MA20`
   - `MA5 < MA20`
   - `MA20` 斜率非正

这类样本与“上涨趋势中的买点”偏离明显。

## 5. 暂定结论

### 5.1 模型名义上仍是在预测买点

活跃模型的 `task_type = buy_signal`，训练数据集也确实包含 `buy/sell` 标签，因此从训练定义上看，它是在预测“像历史买点标签的 bar”。

### 5.2 但 replay 推理链路没有把“不合规样本”挡在门外

当前 replay 的主要问题不一定是“用了未来数据”，更像是：

1. 没有按 `lookbackBars` 做最小历史长度校验；
2. 没有关键特征成熟度校验；
3. 缺失值普遍补零，导致不成熟样本也能过模型；
4. 只有 `buy/sell` 二分类，没有 `hold/no_signal/invalid_sample`。

### 5.3 推荐复盘页当前很容易把两套口径混淆

`backtest`：

- 来源于 `test.parquet`
- 信号少
- 形态更接近上涨趋势

`replay`：

- 来源于最新日期的全市场逐 bar 扫描
- 信号极多
- 趋势约束明显弱于 backtest

如果页面默认混看，就会得出“ML 输出明显有问题”的直观结论。就当前证据看，这个直观判断是合理的。

## 6. 待后续验证的问题

本次已基本确认 replay 的门槛缺失，但还有几项值得在改代码前继续核实：

1. `replay` 的高分信号中，有多少是“特征被大量补零后得到的高分”？
2. `replay` 的日期窗口（2026-05-06 ~ 2026-05-14）是否正好处于某种市场环境，导致模型输出塌向高分？
3. 活跃模型与上一版模型在 `replay` 结果中的分布差异，到底来自模型本身，还是来自扫描口径？
4. 是否存在特定板块/新股/北交所样本，对 replay 噪声贡献特别大？

## 7. 本次产物

1. 调研文档：`docs/REPLAY_SIGNAL_INVESTIGATION_2026-05-14.md`
2. 只读分析脚本：`tmp_analysis/analyze_replay_signal_quality.py`
3. 量化结果：`tmp_analysis/replay_signal_quality_report.json`

## 8. 当前建议

在修改代码前，优先把下面两件事继续调清：

1. **补零证据链**  
   直接抽 replay 高分样本，统计关键特征缺失/补零比例。

2. **来源隔离复盘**  
   后续所有结论先分开看：
   - `backtest`
   - `replay`

不要再把两者当成同一种“模型买点输出”。

## 9. 修复记录（2026-05-15）

本次已将 `模型部署 -> 推荐复盘 -> 历史回放` 调整为和单模型 backtest 更接近的口径。

### 9.1 新口径

历史回放不再把逐 bar 原始 `buy` 直接写入 `model_recommendations`，而是：

1. 按活跃模型的 `spec_version` 构建历史特征。
2. 按特征规格 `lookbackBars` 过滤历史不足样本。
3. 使用 ML 模型输出 `probability / score`。
4. 使用 backtest 推荐阈值筛出候选。
5. 将候选交给 `BacktestEngine`。
6. 由 `BacktestEngine` 执行每日 TopN、D+1 开盘入场、D+N 收盘退出、不可成交跳过。
7. 将回测报告中的 `trade_details` 写入 `model_recommendations(source='replay')`。

### 9.2 关键变更文件

- `python/trading_trainer/predict_live.py`
  - 新增 `build_replay_feature_dataset()`，负责 replay 特征构建与 lookback 过滤。
- `python/trading_trainer/models/backtester.py`
  - 新增 `run_model_replay_signals()`，复用回测引擎评估 replay 候选。
- `python/trading_trainer/cli.py`
  - 新增 `predict replay-backtest` CLI。
- `src/main/ipc/modelCliRunner.ts`
  - `runPredictReplayCli()` 改为调用 `predict replay-backtest`。
- `src/main/ipc/modelSignalInferenceService.ts`
  - 历史回放扫描改为写入回测报告明细。
  - 同模型、同周期、同日期范围的旧 `replay` 推荐会先清理，再写入新口径结果。
- `python/tests/test_replay_backtest.py`
  - 新增阈值 + 每日 TopN 回归测试。

### 9.3 验证

- Python 回归：
  - `PYTHONPATH=python pytest -q python/tests/test_replay_backtest.py python/tests/test_backtest_account.py`
  - 结果：`21 passed`
- CLI 冒烟：
  - `predict replay-backtest` 可生成包含 `test_samples / signal_count / executed_trade_count / trade_details` 的回测报告。
- 前端构建：
  - `npm run build -- --mode development` 当前仍失败，但失败点在既有文件：
    - `src/components/trading/model/IndexKlineChart.tsx`
    - `src/components/trading/model/LabelingDatasetTab.tsx`
  - 未指向本次修改的 `modelSignalInferenceService.ts` / `modelCliRunner.ts`。

### 9.4 后续注意

本次修复保留了 ML 分数作为唯一候选来源，没有引入 MA20 等技术指标作为交易过滤。  
MA20 / MA5 / 趋势斜率仍只建议用于审计与解释，不建议作为推荐复盘的二次交易决策条件。
