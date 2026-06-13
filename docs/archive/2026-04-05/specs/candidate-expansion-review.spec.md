# Candidate Expansion Review Spec

**模块名：** `candidate-expansion-review`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

把自动扩样和人工抽检连接起来，防止自动标签直接污染正式训练集。

## 2. 范围

负责：

- 接收扩样候选结果
- 构建审核队列
- 抽样优先级排序
- 人工审核通过或驳回
- 审核结果回流

不负责：

- 特征生成
- 最终模型训练

## 3. 核心流程

```text
扩样生成候选
  -> 写入 proposed labels
  -> 构建 review queue
  -> 用户逐条审核
  -> accepted / rejected / needs_review
  -> accepted 样本可进入数据集版本
```

## 4. 抽检优先级

优先审核：

1. 置信度低的候选
2. 与历史风格冲突的候选
3. 高收益但低一致性的候选
4. 新股票、新市场状态下的候选

## 5. 数据契约

```ts
interface ReviewQueueItem {
  labelId: string
  stockCode: string
  interval: string
  barIndex: number
  labelType: string
  confidence: number
  reviewPriority: number
}
```

## 6. 接口设计

IPC：

- `labeling:listReviewQueue`
- `labeling:acceptCandidate`
- `labeling:rejectCandidate`
- `labeling:markNeedsReview`

Python CLI：

- `trainer expand-candidates --dataset dataset_v001`
- `trainer build-review-queue --batch 200`

## 7. 核心规则

1. 所有自动扩样标签初始状态为 `proposed`。
2. 只有 `accepted` 标签能进入正式训练集。
3. 被 `rejected` 的候选必须保留原因，供后续误差分析。
4. 审核结果必须可回流到下一次扩样和训练流程。

## 8. 实现建议

代码位置建议：

- `python/trading_trainer/expansion/`
- `src/renderer/components/trainer/CandidateReviewQueue.tsx`

## 9. 验收标准

1. 扩样标签不会直接绕过审核。
2. 审核队列支持按优先级工作。
3. 被接受和被拒绝的候选都可统计。
