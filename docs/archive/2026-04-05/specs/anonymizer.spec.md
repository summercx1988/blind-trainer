# Anonymizer Spec

**模块名：** `anonymizer`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

把真实历史样本转成匿名训练视图，严格隔离未来信息并降低先验识别风险。

## 2. 范围

负责：

- 隐藏股票代码和名称
- 隐藏或弱化日期、价格、成交量
- 只暴露当前 bar 之前的可见窗口
- 提供受控的逐 bar 前进视图

不负责：

- 样本抽样
- 训练会话持久化

## 3. 匿名等级

### 3.1 `strict`

- 隐藏代码和名称
- 隐藏绝对日期
- 价格归一化到相对基准
- 成交量只显示相对值或分位数

### 3.2 `semi`

- 隐藏代码和名称
- 保留日期
- 保留绝对价格

## 4. 数据契约

```ts
interface AnonymizedBar {
  visibleIndex: number
  timestampLabel: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

interface AnonymizedView {
  sessionId: string
  sampleId: string
  mode: 'strict' | 'semi'
  visibleBars: AnonymizedBar[]
  currentBarIndex: number
  canStepForward: boolean
}
```

## 5. 核心规则

1. 任何时刻只返回 `<= currentBarIndex` 的数据。
2. `strict` 模式下首根可见 bar 收盘价默认归一化为 `100`。
3. `strict` 模式下日期显示为 `Bar N` 或相对时间。
4. 真正的股票身份只允许保存在受限内部映射中，不下发到 renderer。
5. 匿名视图必须可逆到真实样本，但恢复能力只允许在主进程内部使用。

## 6. 接口设计

```ts
interface AnonymizerService {
  createInitialView(sampleId: string): Promise<AnonymizedView>
  stepForward(sessionId: string): Promise<AnonymizedView>
  revealIdentity(sessionId: string): Promise<{ stockCode: string; stockName?: string }>
}
```

`revealIdentity` 只允许会话结束后调用。

## 7. 处理流程

```text
接收 TrainingSample
  -> 读取真实 candles
  -> 根据 anonymizeLevel 处理时间/价格/量能
  -> 裁剪到当前可见窗口
  -> 返回 AnonymizedView
```

## 8. 风险控制

高风险泄漏点：

1. tooltip 中显示真实时间戳
2. ECharts 或 KLineChart 内部交互暴露原始数据
3. renderer 缓存全量 candles

要求：

- renderer 永远只拿到可见部分
- 全量 candles 只在 main process 或受控 worker 中保留

## 9. 验收标准

1. 训练过程中 UI 上不能看到未来 bar。
2. `strict` 模式无法通过绝对价格快速反推标的。
3. 会话结束前不得通过搜索或调试信息暴露真实身份。
