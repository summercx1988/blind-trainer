# Shadow Strategy Compare Spec

**模块名：** `shadow-strategy-compare`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

在同一历史样本上，用规则型影子策略对照用户操作，辅助复盘和风格定位。

## 2. 范围

负责：

- 基础规则策略生成信号
- 与用户会话动作对照
- 输出差异报告

不负责：

- 模型训练
- 自动替代用户下单

## 3. v1 策略清单

建议先做：

1. 趋势突破
2. 均线回踩续涨
3. 均值回归

## 4. 对照维度

- 入场时间差
- 出场时间差
- 收益差
- 最大回撤差
- 交易次数差
- 风格相似度

## 5. 数据契约

```ts
interface ShadowStrategyRun {
  id: string
  sessionId: string
  strategyCode: string
  realizedPnlPct: number
  maxDrawdownPct: number
  diffSummaryJson: Record<string, unknown>
}
```

## 6. 接口设计

TypeScript service：

```ts
interface ShadowStrategyService {
  runForSession(sessionId: string, strategyCodes: string[]): Promise<ShadowStrategyRun[]>
}
```

## 7. 核心规则

1. 影子策略只能在用户会话结束后运行。
2. 对照必须使用和用户完全相同的样本窗口。
3. 影子策略结果仅用于分析，不回写用户动作。

## 8. 实现建议

v1 建议直接在 TypeScript 内实现规则策略，并复用 `trading-signals`。

代码位置建议：

- `src/main/core/trainer/shadow-strategies/`
- `src/main/services/trainer/shadow-strategy-service.ts`

## 9. 验收标准

1. 用户会话可稳定对照 1-3 个影子策略。
2. 差异报告可在复盘 UI 中展示。
3. 影子策略不会影响原会话评分。
