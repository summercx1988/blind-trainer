# Model Training Evaluation Spec

**模块名：** `model-training-evaluation`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

训练风格化买卖点模型，并在离线分类和时间切分回测两个维度上做评估。

## 2. 范围

负责：

- 基线模型训练
- 参数记录
- 评估报告生成
- 模型产物导出

不负责：

- 模型激活和在线推理

## 3. v1 模型策略

首选：

- `LightGBM` 二分类模型

任务拆分：

1. `buy_signal`
2. `sell_signal`

后续再考虑：

- `joint_signal`
- 序列模型

## 4. 输入与输出

输入：

- `dataset_version_id`
- `feature_spec_version`
- 超参数

输出：

- 模型产物目录
- 分类指标
- 时间切分回测报告
- 特征重要性报告

## 5. 核心规则

1. 训练必须固定随机种子。
2. 评估必须包含时间切分结果，不能只看随机验证集。
3. 评估结果必须保存到 `model_evaluations`。
4. 同一模型版本只能绑定一组主训练配置。

## 6. 指标要求

至少输出：

- Precision
- Recall
- F1
- AUC
- 命中信号数
- 信号驱动收益
- 分市场状态表现

## 7. 接口设计

Python CLI：

- `trainer model train --dataset dataset_v001 --spec feature_spec_v001 --task buy_signal`
- `trainer model evaluate --model model_v001`

## 8. 实现建议

代码位置建议：

- `python/trading_trainer/models/train.py`
- `python/trading_trainer/models/evaluate.py`

## 9. 验收标准

1. 任一模型都能回溯到训练数据和特征规格。
2. 训练结果能重复复现。
3. 评估报告能支持横向比较不同模型版本。
