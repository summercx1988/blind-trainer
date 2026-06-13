# Replay Session Engine Spec

**模块名：** `replay-session-engine`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

负责匿名训练会话的生命周期、仓位状态、动作执行和逐 bar 推进。

## 2. 范围

负责：

- 开始会话
- 恢复会话
- 应用动作
- 计算成交价
- 推进到下一 bar
- 结束会话

不负责：

- 标签建模
- 模型训练

## 3. v1 交易规则

1. 单标的单会话。
2. 仅做多。
3. 单仓位模型，只支持 `flat` 和 `long`。
4. 买卖均按当前 bar 收盘价成交。
5. 不处理部分成交。

## 4. 状态机

```text
idle -> running -> finished
idle -> running -> skipped
idle -> running -> aborted
```

仓位状态：

```text
flat <-> long
```

## 5. 数据契约

```ts
interface ReplaySession {
  id: string
  sampleId: string
  status: 'running' | 'finished' | 'skipped' | 'aborted'
  currentBarIndex: number
  positionState: 'flat' | 'long'
  entryPrice?: number
  startedAt: string
  finishedAt?: string
}

interface ApplyActionInput {
  sessionId: string
  actionType: 'buy' | 'sell' | 'hold' | 'idle' | 'skip' | 'finish'
  confidence?: number
  note?: string
}
```

## 6. 接口设计

```ts
interface ReplaySessionService {
  startSession(sampleId: string): Promise<ReplaySession>
  restoreSession(sessionId: string): Promise<ReplaySession>
  applyAction(input: ApplyActionInput): Promise<ReplaySession>
  step(sessionId: string): Promise<ReplaySession>
  finish(sessionId: string): Promise<ReplaySession>
}
```

## 7. 核心规则

1. `flat` 状态下只允许 `buy / idle / skip / finish`。
2. `long` 状态下只允许 `sell / hold / idle / finish`。
3. `buy` 和 `sell` 的成交价为当前 bar close。
4. 每次动作都必须记录一条 `training_action`。
5. `skip` 立即结束会话并标记 `skipped`。
6. 到达样本末尾时自动结束会话。

## 8. 异常处理

以下情况必须拒绝动作：

1. 会话已结束
2. 当前仓位与动作不匹配
3. 当前 bar 不存在
4. 重复提交同一动作请求

## 9. 实现建议

代码位置建议：

- `src/main/core/trainer/replay-session-engine.ts`
- `src/main/services/trainer/replay-session-service.ts`
- `src/main/services/trainer/session-repository.ts`

## 10. 验收标准

1. 会话恢复后状态与动作历史一致。
2. 任意动作都能重放出同样的仓位变化。
3. 会话推进不出现越界和双写。
4. 结束后的身份揭示和复盘可正常触发。
