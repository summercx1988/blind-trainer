# 量化模型优化执行手册（Runbook）

> 最后更新：2026-04-24
> 目标：先过数据质量门槛，再做 walk-forward 与标签/持有期实验，避免“单窗口偶然盈利”误判。

## 1. P0：15m 数据扩展与质量门槛

### 1.1 数据扩展

```bash
PYTHONPATH=python python3 scripts/data_fetcher.py sync_list auto
PYTHONPATH=python python3 scripts/data_fetcher.py sync_minute_batch auto 15 500
PYTHONPATH=python python3 scripts/data_fetcher.py sync_minute_extended auto 15 500
```

### 1.2 质量 Gate（硬门槛）

```bash
PYTHONPATH=python python3 scripts/minute_data_quality_gate.py \
  --db auto \
  --period 15 \
  --lookback-days 365 \
  --min-covered-stocks 300 \
  --target-covered-stocks 500 \
  --min-median-trading-days 180 \
  --min-bars-per-day 14 \
  --max-low-bars-ratio 0.05 \
  --max-lag-trading-days 2
```

返回码说明：
- `0`：通过，可进入模型实验阶段。
- `2`：未通过，先补数据再训练。

## 2. P1：Walk-forward 稳定性验证

```bash
PYTHONPATH=python python3 -m trading_trainer.cli model walk-forward \
  --dataset <dataset_id> \
  --spec v010 \
  --engine lightgbm \
  --threshold 0.75 \
  --train-days 120 \
  --test-days 20 \
  --step-days 20 \
  --max-windows 6 \
  --max-positions 10 \
  --db auto
```

walk-forward 报告新增 `stability_summary`：
- `max_positive_return_window_share`：盈利窗口中，最大单窗口收益贡献占比（建议 `< 0.35`）。
- `max_abs_return_window_share`：绝对收益贡献的最大单窗口占比（越低越稳）。
- `max_trade_window_share`：单窗口交易笔数占比（过高说明样本结构不稳）。

## 3. 版本对比（v009 vs v010 等）

```bash
python3 scripts/wf_compare.py \
  --left python/models/walk_forward_<v009>.json \
  --right python/models/walk_forward_<v010>.json \
  --output python/models/wf_compare_v009_v010.json
```

重点看：
- `delta.avg_auc`
- `delta.oos_cumulative_return`
- `delta.max_positive_return_window_share`（如果上升，说明收益更集中、更不稳）

## 4. 实验推进顺序（建议）

1. 数据覆盖扩展（先过 gate）
2. 固定参数重跑 v009/v010（形成统一基线）
3. 标签实验（`exit_return` vs 其它标签定义）
4. 持有期实验（D+2 / D+3 / D+4）
5. 最后才做特征与模型调参（避免在脏数据上调参）

## 5. 一键实验矩阵（持有期 x 标签口径）

新增脚本：`scripts/run_experiment_matrix.py`，可一键串行执行：
`打标 -> 特征 -> 训练 -> walk-forward`，并输出汇总 `json/csv`。

```bash
PYTHONPATH=python python3 scripts/run_experiment_matrix.py \
  --db auto \
  --spec v010 \
  --engine lightgbm \
  --trials 50 \
  --holding-days 3,4,5 \
  --label-methods exit_return,triple_barrier,rank_top20 \
  --threshold 1.0 \
  --signal-threshold 0.75 \
  --train-days 120 \
  --test-days 20 \
  --step-days 20 \
  --max-windows 6 \
  --output-dir python/models
```

关键参数：
- `--label-source daily|minute`：默认 `daily`，minute 时可配 `--bar-period`。
- `--codes 600519,000001`：可先小样本试跑；不传则自动全市场。
- `--triple-tp/--triple-sl`：`triple_barrier` 的止盈/止损百分比（默认回落到 `--threshold`）。
- `--rank-top-ratio`：`rank_top20` 的正样本比例（默认 0.2）。
- `--dry-run`：仅打印命令，不真正执行。

## 6. 记录规范

每次实验统一记录到：
- `docs/WF_EXPERIMENT_LOG_TEMPLATE.md`（复制为当日实验记录）
- 产物 JSON 放 `python/models/`
