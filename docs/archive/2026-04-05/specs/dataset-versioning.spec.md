# Dataset Versioning Spec

**模块名：** `dataset-versioning`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

把标签集合整理成可训练、可回溯、可冻结的数据集版本。

## 2. 范围

负责：

- 定义数据集版本元信息
- 从标签生成数据集项
- 训练/验证/测试切分
- 冻结数据集版本

不负责：

- 特征工程
- 模型训练

## 3. 数据集层级

建议三层：

1. `manual_seed`
2. `expanded_candidate`
3. `approved_training`

## 4. 数据契约

```ts
interface BuildDatasetInput {
  name: string
  labelPolicyVersion: string
  featureSpecVersion: string
  labelSources: Array<'manual' | 'reviewed'>
  splitStrategy: 'time' | 'instrument' | 'hybrid'
}
```

## 5. 核心规则

1. 只有 `accepted` 标签允许进入 `approved_training`。
2. 数据集冻结后内容不可原地修改，只能新建版本。
3. 数据集 manifest 必须记录标签来源、时间范围和样本统计。
4. 切分优先使用时间切分，避免随机打乱造成未来信息泄漏。

## 6. 输出产物

```text
datasets/dataset_v001/
├── manifest.json
├── items.parquet
├── splits.parquet
└── README.md
```

## 7. 接口设计

Python CLI：

- `trainer dataset build --name dataset_v001`
- `trainer dataset inspect --id dataset_v001`
- `trainer dataset freeze --id dataset_v001`

IPC：

- `modeling:listDatasets`
- `modeling:getDataset`

## 8. 实现建议

代码位置建议：

- `python/trading_trainer/datasets/builder.py`
- `python/trading_trainer/datasets/manifest.py`

## 9. 验收标准

1. 任一数据集都能追溯到标签来源。
2. 冻结后可重复产出同样的 items 和 splits。
3. 数据集版本之间差异可对比。
