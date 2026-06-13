# ML 模型训练系统文档

> 最后更新：2026-04-23

## 系统架构

```
数据层:  kline_daily / kline_15m (SQLite)
标签层:  overnight_labeler.py → dataset_items
特征层:  FeatureBuilder (specs.py + builder.py)
模型层:  LightGBMTrainer / Ensemble
接口层:  cli.py (label / feature / model)
```

## 数据概况

| 数据源 | 表名 | 覆盖范围 | 数量 |
|--------|------|---------|------|
| 日线 | kline_daily | 2018-10 ~ 2026-04 | 5148股, ~4.5M bars |
| 15分钟 | kline_15m | 2025-03 ~ 2026-04 | 120股, ~600K bars |
| 上证指数 | kline_daily (sh000001) | 2005-09 ~ 2026-04 | 5000 bars |

## 特征规格版本

### v001 (23列) — 基础特征
价格结构: returns_1d/3d/5d/10d/20d, high_low_ratio, open_close_ratio
趋势: ma_5/10/20, price_ma_ratio
波动: rsi_14, atr_14, volatility_10d/20d
量能: volume_5d/20d_avg, volume_ratio
市场状态: is_uptrend/downtrend/range/volatile

### v002 (42列) — 增强特征 (+19)
扩展均线: ma_60, price_ma_60_ratio, ma_cross 信号
动量: momentum, roc
量价背离: volume_price_corr, obv_slope
波动扩展: atr_ratio, volatility_ratio, bb_position/width
滞后: returns_1d_lag1/2/3, rsi_14_lag1, volume_ratio_lag1
交叉: rsi_x_volume_ratio, returns_5d_x_volatility, momentum_10d_x_atr

### v003 (52列) — 反转策略 (+10)
隔夜收益分解: overnight_ret, intraday_ret + lag
收盘位置: close_position + lag
Garman-Klass 波动率: gk_volatility, gk_volatility_ratio
交叉: overnight_x_intraday, close_pos_x_volume_ratio

### v004 (57列) — 趋势策略 (+15 on v002)
突破指标: close_to_20d/60d_high
趋势强度: up_day_ratio_10d, continuous_up_days, trend_slope_10d
资金方向: vol_up_down_ratio
GK波动率 + 趋势交叉

### v005 (71列) — 大盘+截面 (+14 on v004)
指数相对: excess_return_1d/5d/20d, relative_strength/ratio
市场宽度: market_advance_ratio, market_avg_return_1d
截面排名: return_rank_1d/5d/20d, return_rank_x_volume_ratio
交叉: excess_return_x_volume_ratio, relative_strength_x_momentum

### v006 (89列) — 短线实战指标 (+14 on v005)
跳空强度: gap_pct, gap_x_volume, gap_above_20d_high, gap_fill_ratio
日内动量(OHLC代理): intraday_slope, upper_shadow_ratio, lower_shadow_ratio
量价确认: vol_price_confirm, vol_price_diverge, confirm_streak_5d
短期反转: max_drawdown_3d, consecutive_down_days, reversal_signal, oversold_rebound

### v007 (102列) — 多尺度特征 (+13 on v006)
EWMA衰减: ewma_return_span5/10, ewma_volume_ratio_span5/10, ewma_volatility_span5/10
多周期指标: rsi_6/28, rsi_cross, atr_7/28
跨尺度背离: momentum_divergence, ma_alignment_score

### v008 (108列) — 板块因子 (+6 on v007)
板块动量: sector_return_1d/5d, sector_advance_ratio
板块排名: sector_rank_1d (个股在板块内收益百分位)
板块超额: sector_excess_return_1d, sector_vs_market_1d

## 数据扩展

### 15min 数据 (2026-04-20 更新)
- 覆盖: 120股 → 500股, 600K → 2.5M bars
- 日期范围: 2024-12-16 ~ 2026-04-17
- Sina API 上限: ~5000 bars/股

### 行业分类
- 数据源: MAJOR_A_SHARES 内置列表 (127股, 46个行业)
- 存储: stock_list.industry 字段
- 覆盖: 主要大盘蓝筹股, 后续需扩展至全市场

## 标签生成策略

### 15分钟标签 (generate-overnight)
- 数据源: kline_15m
- 入场: 14:30-14:45 最后一根 bar 的 close
- 持仓窗口: D+1 ... D+N（最后一天截到 10:45）
- 标签默认口径: `label = 1 if return_pct >= threshold_pct else 0`（`--label-method exit_return`）
- 兼容口径: `max_return`（最高价触达）、`triple_barrier`（TP/SL/时间屏障）、`rank_top20`（按 entry_date 横截面收益排序）
- bar_timestamp: 前一交易日的日线时间戳（避免前视偏差）
- 选项: `--threshold`, `--holding-days`, `--trend-filter`, `--bar-period`, `--label-method`, `--triple-tp`, `--triple-sl`, `--rank-top-ratio`

### 日线标签 (generate-overnight-daily)
- 数据源: kline_daily
- 入场价: 当日 close（代理 14:57 尾盘价）
- 持仓窗口: D+1 ... D+N 全天
- 标签默认口径: `label = 1 if return_pct >= threshold_pct else 0`（`exit_return`）
- 兼容口径: `max_return` / `triple_barrier` / `rank_top20`
- 额外过滤: --trend-filter, --min-day-return

### 趋势过滤器
ma5_above_ma20 / close_above_ma20 / ma5_above_ma10_above_ma20 / close_above_ma60 / bullish_alignment
- 过滤在 feature_date（前一交易日）上检查，避免前视偏差

## 模型训练配置

### LightGBM 训练器
- **优化目标**: AUC（从 F1 改为 AUC，解决全正预测退化）
- **超参搜索**: Optuna 200 trials
- **CV策略**: 日分块 TimeSeriesSplit（同日所有股票在同一 fold）
- **正则化**: learning_rate 0.005-0.1, min_child_samples 20-100, reg_alpha/lambda 0.01-50
- **关键超参**: scale_pos_weight 用于类别不平衡

### 训练命令
```bash
# 生成标签
python3 -m trading_trainer.cli label generate-overnight-daily \
  --db ~/Library/Application\ Support/stock-trading-simulator/stock-trading.db \
  --dataset-name <name> --threshold 3.0 --trend-filter bullish_alignment --min-day-return 2.0 \
  --label-method exit_return

# 冻结数据集（SQL）
UPDATE dataset_versions SET status='frozen', frozen_at=strftime('%s','now')*1000 WHERE id='<ds_id>';

# 构建特征
python3 -m trading_trainer.cli feature build --dataset <name> --spec v005

# 训练
python3 -m trading_trainer.cli model train --dataset <name> --spec v005 \
  --task buy_signal --engine lightgbm --trials 200
```

### 集成模型
```python
from trading_trainer.models.ensemble import ensemble_predict
result = ensemble_predict(
    trend_model_id='<trend_model_id>',
    reversal_model_id='<reversal_model_id>',
    features_path='<test_parquet>',
    weight_trend=0.6,
)
```
- 输出: ensemble AUC、趋势/反转各自的 AUC、风格分布（%趋势 vs %反转）、平均分歧度

## 实验结果 (2026-04-21 更新)

### 最佳模型

| 配置 | 模型 | 数据 | Test AUC | Valid AUC | Test F1 | 样本量 |
|------|------|------|----------|-----------|---------|--------|
| **v008+sector** | **CatBoost** | **15min, 500股, t3%** | **69.8%** | **71.4%** | **52.8%** | **153K** |
| v008+sector | LightGBM | 15min, 500股, t3% | 68.8% | 71.2% | 9.3% | 153K |
| v005+rank | LightGBM | 15min, 120股 | 61.5% | 63.9% | — | 29K |
| v005+rank | LightGBM | daily扩展, 趋势3% | 60.3% | 60.2% | — | 140K |
| v006+rank | LightGBM | daily扩展, 趋势3% | 60.1% | 60.2% | — | 140K |
| v007+rank | LightGBM | daily扩展, 趋势3% | 60.0% | 60.2% | — | 140K |
| ensemble 60/40 | LightGBM | 15min | 62.1% | — | — | 4.4K |

### Feature Importance (CatBoost v008, 15min 500股) ★ 最佳模型
1. gk_volatility — Garman-Klass 波动率
2. market_advance_ratio — 上涨股票占比
3. market_avg_return_1d — 全市场平均收益
4. high_low_ratio — 日内振幅
5. price_ma_60_ratio — 价格/60日均线比
6. **sector_vs_market_1d — 板块相对大盘超额**
7. close_to_60d_high — 接近60日高点
6. **sector_vs_market_1d — 板块相对大盘超额** ★ 新增板块因子
7. price_ma_60_ratio — 价格/60日均线比
8. volatility_10d — 10日波动率
9. ewma_volatility_span10 — 波动率EWMA
10. close_to_60d_high — 接近60日高点

### 关键教训
1. **AUC 优化 > F1 优化** — F1 优化导致全正预测退化（Recall=100%, Precision=正样本率）
2. **强正则化必要** — learning_rate < 0.05, min_child_samples > 40, reg_alpha > 0.5
3. **15min 数据量提升是关键** — 120股→500股, 29K→153K样本, AUC从61.5%→69.8%
4. **大盘因子有效** — market_advance_ratio 和 relative_strength 稳定进入 top 5
5. **板块因子有效** — sector_vs_market_1d 进入 top 6，板块轮动信息有预测力
6. **前视偏差防护** — bar_timestamp 必须指向前一交易日，所有特征在 feature_date 及之前计算
7. **CatBoost > LightGBM** — AUC +1pp，F1从9%→53%（Recall从5%→76%），ordered boosting对不平衡数据更友好
8. **v007 多尺度特征在更大模型中贡献更大** — ewma_return_span10, max_drawdown_3d 进入CatBoost top 15
9. **日线vs15min差距拉大** — 日线AUC天花板~60%，15min达到70%，入场精度是核心差异

## Builder 架构说明

### 数据切分比例（2026-04-23 更新）
- `FeatureBuilder._split_dataset()` 已调整为时间顺序 `70/10/20`（train/valid/test）。
- 调整前为 `70/15/15`，本次将测试集扩大到约 20%，用于更严格 OOS 检查与回测 sanity check。

### 截面特征预加载
v005+ 的截面特征（市场宽度、排名）在 `_preload_cross_sectional_data()` 中一次性预计算：
- `_index_daily`: 日期→指数收盘/收益
- `_market_daily`: 日期→全市场平均收益/上涨占比
- `_stock_rank_daily`: (code, date)→收益排名百分位
- `_stock_sector`: code→行业分类（v008+）
- `_sector_daily`: (sector, date)→板块平均收益/上涨占比（v008+）
- `_stock_sector_rank`: (code, date)→板块内收益排名百分位（v008+）

### 日分块 CV
`_time_series_cv()` 接收 `day_labels` 参数（bar_timestamp 数组），按唯一日期切分 fold，确保同日所有股票在同一 fold。

## 训练样本人工抽样检查面板（2026-04-23 新增）

- 入口: `模型训练 > 数据集冻结 > 检查标签`（DatasetTab 行内按钮）。
- 用途: 在同一界面并排查看 `stored_label`、`return_pct`、`max_return_pct`、`gap_return_pct` 与 K 线标记，快速做人工抽样核验。
- 核心指标: 面板统计卡包含“冲高但未兑现”计数（`max_only_candidate_count`），用于识别“最高收益触达但实际退出收益未达阈值”的样本。
- 快速识别 `max_only`:
  - 先看表格/详情中的 `label_alignment = max_only`。
  - 再结合“冲高但未兑现”统计卡和 `avg_max_return_pct` vs `avg_return_pct` 差值判断偏差规模。

## 已有模型资产

### 模型文件 (models/, 53MB, 34个模型)
| 模型ID | 引擎 | 特征 | 数据集 | Test AUC |
|--------|------|------|--------|----------|
| cb_20260421032755324763 | CatBoost | v008 | overnight_15m_ext_t3 (15min 500股) | **69.8%** |
| lgbm_20260420144628030766 | LightGBM | v008 | overnight_15m_ext_t3 | 68.8% |
| lgbm_20260420140907363128 | LightGBM | v008 | trend_daily_ext_t3 (日线) | 60.0% |
| lgbm_20260420125130927372 | LightGBM | v007 | trend_daily_ext_t3 | 60.0% |
| lgbm_20260420122825719443 | LightGBM | v006 | trend_daily_ext_t3 | 60.1% |
| lgbm_20260420120155337687 | LightGBM | v005 | trend_daily_ext_t3 | 60.3% |
| lgbm_20260420090212205064 | LightGBM | v005 | trend_daily_bullish_strong_t3 (日线趋势) | 59.4% |
| lgbm_20260420082045399115 | LightGBM | v004 | trend_daily_bullish_strong_t3 | 60.3% |
| lgbm_20260420055617982611 | LightGBM | v002 | overnight_15m_t1_d2window (15min 120股) | 62.3% |

### 特征文件 (features/, 585MB)
覆盖 v001~v008 全部规格，包括日线和15min数据集的各版本特征 parquet。

## 回测系统 (W11 完成)

### 回测引擎设计
- 入场: D+1 open（次日开盘价，保守）
- 退出(保守): D+N close（持有期末收盘价，N>=2）
- 退出(乐观): D+N high（持有期末价格路径上界）
- 仓位限制: 每日最多 10 只股票（按概率排序取 top N）
- CLI: `model backtest --model <id> --threshold <t>`
- 阈值优化: `model optimize-threshold --model <id> --objective sharpe`

### 2026-04-23 口径更新
- **信号数 != 成交笔数**：回测现在区分 `signal_count` 和 `executed_trade_count`。满足阈值只是候选信号，只有能按 D+1 开盘买入且能按 D+N 收盘结算的样本才计入交易绩效。
- **跳过原因显式暴露**：回测报告新增 `skipped_signal_count` 和 `skip_breakdown`，便于识别涨停买不到、缺少 D+N 收盘等原因。
- **主结果只看可成交保守收益**：`metrics_conservative` 是唯一主口径；`metrics_optimistic` 仅作为 D+N high 上界参考，不再混同为“可实现收益”。
- **报告内置指标定义**：backtest JSON 现在带有 `calculation_basis`、`metric_definitions`、`data_leakage_guardrails`，页面可直接展示回测口径说明。

### 防未来函数约束
- 测试样本只来自按时间顺序切分后的 `test.parquet`，不会混入 train/valid。
- 信号日 D 不允许同 bar 成交，统一从 D+1 open 执行。
- A 股 T+1 下，保守收益统一按 D+N close 结算（N>=2）。
- 缺少可执行后续行情的数据直接跳过，不会回填不可成交价格。
- 趋势过滤和标签特征日仍以 `feature_date = previous trading day` 为准，见 `overnight_labeler.py`。

### Walk-forward 验证（2026-04-23 新增）
- CLI: `model walk-forward`
- 目的: 每个滚动窗口独立训练，并只在未来窗口做 OOS 验证，避免“同一时间段训测混用”。
- 窗口定义: `train_days` / `test_days` / `step_days` 都按**交易日**滚动，不按分钟 bar 数滚动。
- 收益口径: 每个 OOS 窗口都复用 `BacktestEngine` 的保守成交逻辑（D+1 入场，D+N close 结算，含交易成本）。
- 输出: `models/walk_forward_<dataset>_<spec>_<timestamp>.json`，含：
  - `windows`（逐窗口分类指标 + 成交/跳过信息）
  - `oos_portfolio`（跨窗口聚合后的 OOS 组合指标）
  - `stability_summary`（单窗口收益/交易集中度，辅助识别“单窗口偶然盈利”）
  - `calculation_basis` / `metric_definitions` / `data_leakage_guardrails`（口径说明，可直接给前端展示）

示例：
```bash
python3 -m trading_trainer.cli model walk-forward \
  --dataset trend_daily_ext_t3 \
  --spec v008 \
  --engine lightgbm \
  --train-days 120 \
  --test-days 20 \
  --step-days 20 \
  --max-windows 6 \
  --threshold 0.75
```

### 15m 数据质量 Gate（2026-04-24 新增）

- 脚本：`scripts/minute_data_quality_gate.py`
- 用法：
```bash
PYTHONPATH=python python3 scripts/minute_data_quality_gate.py \
  --db auto --period 15 --lookback-days 365 \
  --min-covered-stocks 300 --target-covered-stocks 500 \
  --min-median-trading-days 180 --min-bars-per-day 14 \
  --max-low-bars-ratio 0.05 --max-lag-trading-days 2
```
- 默认门槛（可参数化）：
  - 覆盖股票数 >= 300（目标 500）
  - 单股票覆盖交易日中位数 >= 180
  - 低完整性交易日（bars/day < 14）占比 <= 5%
  - 分钟数据相对日线最新日期滞后 <= 2 个交易日

### 当前回测的已知限制
- **旧数据集可能仍有口径错位**：默认标签已切换为 `exit_return` 并与保守回测更一致；但若复用历史 `max_return` 数据集或手动切回旧口径，仍会出现“会冲高”与“可兑现收益”错位。
- **当前更偏信号评估，不是完整组合回放**：净值曲线按“信号日期内已成交股票等权平均”形成日收益，再做逐日复利；尚未显式模拟跨日持仓重叠、资金占用、仓位滚动和延迟卖出。
- **高年化要谨慎解释**：当活跃交易天数较少且日收益较高时，252 日折算的年化收益会明显放大，更适合横向比较，不适合直接当成实盘口径。
- **阈值优化依赖分数校准质量**：如果模型概率分布压缩严重，多个阈值会得到非常接近的信号集，优化结果更多反映排序而非概率质量。

### 回测结果 (threshold=0.85, max_positions=10)

| 模型 | 交易数 | 胜率 | 平均收益 | 累计收益(保守) | 最大回撤 |
|------|--------|------|---------|---------------|---------|
| CatBoost v008 15min | 56 | 55.4% | +0.47% | -10.6% | -29.4% |
| LightGBM v008 15min | 5 | 100% | +3.88% | +3.9% | 0% |
| LightGBM v008 daily | 0 | — | — | — | — |

### 关键发现
1. **AUC 不等于盈利** — CatBoost AUC 69.8% 但保守退出累计 -10.6%
2. **退出策略是核心** — 保守 vs 乐观退出差距巨大（-10.6% vs +719%）
3. **高阈值才有效** — 阈值 0.85+ 模型才有正平均收益
4. **日线模型无信号** — 在高阈值下完全无法生成有效信号
5. **需要更精细的退出策略** — 盘中止盈/移动止损可能显著改善收益
6. **标签口径已修复为 exit_return** — 继续优化模型时需避免回到 `max_return` 旧口径，并通过“标签人工抽样检查”持续监控 `max_only` 样本占比
7. **执行率是新必看指标** — 超短线模型不能只看信号覆盖，还要看有多少信号能在 A 股涨跌停和 T+1 约束下真正成交

## 后续工作路线图

### P0: 回测框架（当前优先级）
构建专业回测系统，用交易指标评估模型实际效果：
- 信号生成：模型在测试集上输出概率 → 阈值过滤 → 买入信号
- 交易模拟：信号日14:30-14:45入场 → D+1...D+N 持仓 → 按实际价格退出
- 绩效指标：累计收益、年化收益、最大回撤、夏普比率、胜率、盈亏比
- 多模型对比：同一回测框架下对比 v002~v008 × LightGBM/CatBoost 的实际交易表现
- 输出：对比报告（每个模型的回测净值曲线和交易统计）

### P1: 数据质量提升
1. **15min 历史数据扩展** — Sina API 上限 ~5000 bars（~5个月），需要寻找更长历史数据源
2. **行业分类覆盖** — 仅127股有行业标签，需接入申万行业分类 API 扩展至全市场
3. **5min 数据** — 已有 kline_5m 表结构，可拉取更精细的入场价

### P2: 模型迭代
1. **LightGBM + CatBoost 集成** — 两个模型加权平均，可能再提升 1-2pp
2. **阈值优化** — 回测框架中搜索最优信号阈值（不一定是 0.5），但前提是先检查分数分布和校准情况
3. **标签重构** — 从“未来两日最高价触达”迁移到“post-cost 可兑现收益 / triple-barrier / 排序标签”
4. **特征选择** — 基于回测结果筛选有效特征，减少噪声列

### P3: 前端落地
1. 模型信号接入盲练/模拟交易界面
2. 模型对比面板（回测净值曲线并排展示）
3. 回测页固定展示口径说明、跳过原因和执行率
4. AI 对话界面（自然语言探索策略）
