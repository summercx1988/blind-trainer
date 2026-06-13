# Feature Pipeline Spec

**模块名：** `feature-pipeline`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

把数据集中的样本点转换成结构化训练特征，并严格避免未来信息泄漏。

## 2. 范围

负责：

- 定义特征规格版本
- 从历史窗口生成特征
- 输出 train / valid / test 特征文件

不负责：

- 训练会话 UI
- 模型注册

## 3. v1 特征方向

1. 价格结构特征
2. 趋势特征
3. 波动特征
4. 量能特征
5. 市场状态特征

示例：

- 过去 N bar 收益率
- 均线偏离
- RSI / ATR / 振幅
- 成交量均值比
- 局部高低点距离

## 4. 核心规则

1. 特征只能使用标签 bar 及其之前的数据。
2. 所有特征必须绑定 `feature_spec_version`。
3. 特征缺失要有统一填充策略。
4. 特征生成必须支持按数据集版本重跑。

## 5. 数据契约

```ts
interface FeatureSpec {
  version: string
  interval: string
  lookbackBars: number
  columns: string[]
}
```

## 6. 输出产物

```text
features/feature_spec_v001/
├── manifest.json
├── train.parquet
├── valid.parquet
├── test.parquet
└── columns.json
```

## 7. 接口设计

Python CLI：

- `trainer feature build --dataset dataset_v001 --spec feature_spec_v001`
- `trainer feature inspect --spec feature_spec_v001`

## 8. 实现建议

代码位置建议：

- `python/trading_trainer/features/specs.py`
- `python/trading_trainer/features/builder.py`

## 9. 验收标准

1. 同一数据集和特征规格应重复生成相同特征。
2. 特征列稳定，可被模型训练直接消费。
3. 不允许未来数据泄漏。
