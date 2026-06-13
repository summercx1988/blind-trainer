# Model Registry Inference Spec

**模块名：** `model-registry-inference`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

管理模型版本生命周期，并提供离线或准在线推理能力，服务于扩样和风格对照。

## 2. 范围

负责：

- 模型版本登记
- 激活与归档
- 模型元信息查询
- 批量推理

不负责：

- 模型训练
- 训练 UI

## 3. 数据契约

```ts
interface ModelVersion {
  id: string
  name: string
  datasetVersionId: string
  featureSpecVersion: string
  taskType: 'buy_signal' | 'sell_signal' | 'joint_signal' | 'style_score'
  artifactPath: string
  status: 'training' | 'active' | 'archived' | 'failed'
}
```

## 4. 核心规则

1. 模型不能在 `failed` 状态下被激活。
2. 同一任务允许多模型并存，但默认只允许一个 `active`。
3. 推理时必须检查特征规格版本是否匹配。
4. 所有推理输出都应记录模型版本号。

## 5. 接口设计

Python CLI：

- `trainer registry register --model-dir model_v001`
- `trainer registry activate --id model_v001`
- `trainer infer batch --model model_v001 --dataset dataset_v001`

IPC：

- `modeling:listModels`
- `modeling:getModel`
- `modeling:activateModel`

## 6. 输出

推理输出应至少包含：

- `stock_code`
- `interval`
- `bar_index`
- `task_type`
- `score`
- `threshold`
- `model_version_id`

## 7. 实现建议

代码位置建议：

- `python/trading_trainer/registry/`
- `src/main/application/trainer/modeling-app-service.ts`

## 8. 验收标准

1. 模型版本可浏览、可激活、可归档。
2. 推理结果可回溯到模型版本。
3. 扩样和风格对照可直接消费推理输出。
