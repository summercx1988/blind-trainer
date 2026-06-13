# Session Review Scoring Spec

**模块名：** `session-review-scoring`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

根据训练会话和真实后续行情，输出收益、行为质量和复盘洞察。

## 2. 范围

负责：

- 交易收益统计
- MFE / MAE 统计
- 买点和卖点效率评分
- 跳过质量评分
- 行为纪律评分

不负责：

- UI 渲染
- 模型训练评估

## 3. 输入与输出

输入：

- `ReplaySession`
- `training_actions`
- 对应真实 candles
- `scoring_policy_version`

输出：

- `training_review`
- 可视化所需指标
- insight JSON

## 4. 指标定义

### 4.1 收益指标

- `realized_pnl_pct`
- `trade_win_rate`
- `profit_factor`
- `max_drawdown_pct`

### 4.2 过程指标

- `mfe_avg_pct`
- `mae_avg_pct`
- `avg_holding_bars`
- `overtrading_rate`

### 4.3 行为指标

- `entry_efficiency_score`
- `exit_efficiency_score`
- `discipline_score`
- `skip_quality`

## 5. 核心规则

1. 跳过样本不计入交易胜率。
2. `skip_quality` 单独评估为 `good / neutral / missed`。
3. 买点效率基于买入后窗口内的最大有利波动。
4. 卖点效率基于卖出前后窗口与局部极值偏离。
5. 所有评分都必须写入 `scoring_policy_version`。

## 6. 接口设计

```ts
interface SessionReviewScorer {
  evaluateSession(sessionId: string): Promise<TrainingReview>
  getVisualMetrics(sessionId: string): Promise<Record<string, unknown>>
}
```

## 7. 洞察输出

`insight_json` 至少包含：

- 连续犹豫 bar 数
- 早卖次数
- 迟卖次数
- 追涨倾向
- 扛单倾向
- 样本内错失趋势程度

## 8. 实现建议

代码位置建议：

- `src/main/core/trainer/session-review-scorer.ts`
- `src/main/application/trainer/simulation-app-service.ts`

## 9. 验收标准

1. 同一会话重复计算结果一致。
2. 每项评分都能解释其来源。
3. 复盘指标能驱动后续 UI 和画像统计。
