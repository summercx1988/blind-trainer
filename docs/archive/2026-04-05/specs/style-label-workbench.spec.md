# Style Label Workbench Spec

**模块名：** `style-label-workbench`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

提供历史样本上的手工风格打标能力，为后续数据集和模型训练提供高质量种子标签。

## 2. 范围

负责：

- 浏览历史 K 线窗口
- 手工标记买点、卖点、无操作
- 编辑标签备注和置信度
- 浏览标签历史和状态

不负责：

- 自动扩样
- 模型训练

## 3. 核心原则

1. 标签定义为“可执行点”，不是事后最优点。
2. 打标时不允许依赖未来数据生成特征。
3. 同一标签必须带 `label_policy_version`。
4. 标签修改不能覆盖历史，必须保留修订痕迹。

## 4. 主要界面

页面建议：

1. `历史 K 线区`
2. `标签面板`
3. `标签列表`
4. `审核状态面板`

## 5. 数据契约

```ts
interface CreateStyleLabelInput {
  stockCode: string
  interval: string
  barIndex: number
  labelType: 'executable_buy' | 'executable_sell' | 'no_action'
  confidence?: number
  note?: string
  labelPolicyVersion: string
}
```

## 6. 接口设计

IPC 建议：

- `labeling:listLabels`
- `labeling:createLabel`
- `labeling:updateLabel`
- `labeling:archiveLabel`
- `labeling:getLabelHistory`

## 7. 核心规则

1. 默认新建手工标签直接进入 `accepted`。
2. 标签编辑应产生新的修订记录。
3. 同一 bar 允许多个标签，但必须能看出哪个为当前有效版本。
4. `no_action` 必须明确采样原因或策略。

## 8. 实现建议

代码位置建议：

- `src/renderer/components/trainer/StyleLabelWorkbench.tsx`
- `src/main/application/trainer/labeling-app-service.ts`
- `src/main/services/trainer/style-label-repository.ts`

## 9. 验收标准

1. 能快速打三类基础标签。
2. 标签历史可追溯。
3. 标签数据可直接被 dataset builder 消费。
