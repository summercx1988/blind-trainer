# Changelog

本项目所有重要变更记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### Fixed

- **训练-推理特征分布不一致**：`predict_live` 推理路径未预加载横截面数据，导致 v005+ 特征在推理时分布偏移。现已统一预加载同日全市场横截面数据。
- **随机负采样引入分布偏差**：已用 Triple Barrier 信号内部二分类替换随机负采样。训练标签由 Triple Barrier 结果映射：`take_profit → buy / y=1`，`stop_loss → sell / y=0`，`expired → 排除`。
- **预测路径 lookback 缺失校验**：推理路径未强制 `lookback_bars` 最小值，历史窗口不足时会静默产生偏差。现已强制校验，不足时拒绝推理并返回明确原因。
- **模型产物元信息缺失**：artifact 未记录正类、lookback 与标签分布，无法做一致性校验。现已统一写入 `positive_class`、`lookback_bars`、`label_distribution`。

### Removed

- 移除 `task_type` UI 选项，仅保留 `buy_signal` 任务类型。
