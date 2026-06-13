# Sample Pool Spec

**模块名：** `sample-pool`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

负责从历史行情中抽取可训练样本 `TrainingSample`，保证样本满足匿名训练和后续评估需要。

## 2. 范围

负责：

- 股票池筛选
- K 线完整性校验
- 起始 bar 抽样
- 样本难度和市场状态打标
- 样本去重和冷却

不负责：

- 匿名化展示
- 会话状态管理
- 模型训练

## 3. 输入与输出

输入：

- 股票池筛选条件
- K 线周期
- 匿名等级
- warmup bar 数
- forward bar 数
- 难度和市场状态偏好

输出：

- `TrainingSample`
- 样本元信息
- 抽样原因和过滤统计

## 4. 核心规则

1. 每个样本必须具备足够 `warmup_bars` 和 `forward_bars`。
2. 默认排除 ST、长期停牌、上市时间过短和流动性过差标的。
3. 默认避免高重复采样，单标的单区间在冷却期内不能反复出现。
4. 每个样本必须绑定 `interval`、`start_bar_index` 和 `anonymize_level`。
5. 难度分数和市场状态标签必须可重算，不允许写死人工结论。

## 5. 数据契约

```ts
interface SamplePoolQuery {
  interval: '1d' | '60m' | '30m' | '15m' | '5m'
  warmupBars: number
  forwardBars: number
  anonymizeLevel: 'strict' | 'semi'
  regimeFilter?: Array<'uptrend' | 'downtrend' | 'range' | 'volatile'>
  difficultyRange?: [number, number]
}

interface TrainingSample {
  id: string
  stockCode: string
  interval: string
  startBarIndex: number
  warmupBars: number
  forwardBars: number
  regimeTag?: string
  difficultyScore?: number
  anonymizeLevel: 'strict' | 'semi'
}
```

## 6. 接口设计

TypeScript service:

```ts
interface SamplePoolService {
  drawSample(query: SamplePoolQuery): Promise<TrainingSample>
  previewSample(sampleId: string): Promise<TrainingSample>
  blacklistSample(sampleId: string, reason: string): Promise<void>
}
```

## 7. 处理流程

```text
读取股票池
  -> 执行可训练性过滤
  -> 拉取或读取本地 K 线缓存
  -> 枚举可用起点
  -> 计算 regime / difficulty
  -> 根据 query 采样
  -> 生成 TrainingSample
```

## 8. 实现建议

代码位置建议：

- `src/main/core/trainer/sample-selector.ts`
- `src/main/services/trainer/sample-pool-service.ts`

## 9. 验收标准

1. 抽样成功率高于 95%，失败时返回明确原因。
2. 任一样本都能回溯到原始股票和起始 bar。
3. 抽样结果不能越界读取未来数据。
4. 相同 query 下支持随机性，但必须可复现实验种子。
