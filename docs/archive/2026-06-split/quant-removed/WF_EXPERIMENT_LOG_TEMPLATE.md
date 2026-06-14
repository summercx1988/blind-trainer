# Walk-forward 实验记录模板

> 日期：YYYY-MM-DD  
> 实验人：  
> 数据库：`<db_path>`  

## 1. 数据质量 Gate

- 质量报告：`python/models/minute_quality_15m_<timestamp>.json`
- 是否通过：`PASS / FAIL`
- 关键值：
  - covered_stocks =
  - median_trading_days =
  - low_bar_ratio_pct =
  - lag_trading_days =

## 2. 实验配置

- dataset_id:
- spec_version:
- engine:
- threshold:
- train_days / test_days / step_days:
- max_windows:
- max_positions_per_day:
- 训练标签口径（如 exit_return）:
- 持有期口径（如 D+2）:

## 3. 结果摘要

- 报告文件：`python/models/walk_forward_<dataset>_<spec>_<timestamp>.json`
- avg_auc:
- avg_f1:
- oos_cumulative_return:
- oos_sharpe:
- oos_executed_trade_count:
- max_positive_return_window_share:
- max_abs_return_window_share:
- max_trade_window_share:

## 4. 与基线对比

- 对比脚本输出：`python/models/wf_compare_<left>_<right>.json`
- 关键 delta：
  - delta.avg_auc =
  - delta.oos_cumulative_return =
  - delta.oos_win_rate =
  - delta.max_positive_return_window_share =

## 5. 结论与下一步

- 本轮结论：
- 风险点：
- 下一轮只改 1-2 个变量：
  1.
  2.
