# Desktop Shell And IPC Spec

**模块名：** `desktop-shell-and-ipc`  
**版本：** v0.1  
**状态：** draft

## 1. 目标

把所有训练与建模模块以可维护的方式接入现有 Electron 桌面壳和 IPC 体系。

## 2. 范围

负责：

- 页面导航
- renderer store
- preload API
- ipc handlers
- 长任务状态同步

不负责：

- 核心训练逻辑
- Python 训练实现细节

## 3. 页面建议

```text
顶部导航
├── 盲训工作台
├── 风格打标
├── 训练记录
├── 数据集与模型
├── 复盘分析
└── 风格画像
```

## 4. IPC 设计

### 4.1 simulation

- `simulation:startSession`
- `simulation:getSession`
- `simulation:applyAction`
- `simulation:step`
- `simulation:finish`
- `simulation:getReview`

### 4.2 labeling

- `labeling:listLabels`
- `labeling:createLabel`
- `labeling:updateLabel`
- `labeling:listReviewQueue`
- `labeling:reviewCandidate`

### 4.3 modeling

- `modeling:listDatasets`
- `modeling:getDataset`
- `modeling:listModels`
- `modeling:getModel`
- `modeling:runTask`

## 5. 长任务模型

对以下任务需要统一 job 机制：

1. 候选扩样
2. 特征生成
3. 模型训练
4. 模型评估

job 字段建议：

- `job_id`
- `job_type`
- `status`
- `progress_pct`
- `started_at`
- `finished_at`
- `error_message`

## 6. 实现建议

代码位置建议：

- `src/main/ipc/trainer/`
- `src/main/preload.ts`
- `src/renderer/stores/trainer.ts`
- `src/renderer/components/trainer/`

## 7. 核心规则

1. renderer 不直接持有未来 K 线全量数据。
2. Python 长任务不阻塞 Electron 主线程。
3. 所有 IPC 必须返回稳定 JSON schema。
4. 所有 job 都必须可轮询和可取消。

## 8. 验收标准

1. 训练、打标、数据集、模型页面能在同一壳内稳定工作。
2. 长任务状态可见且可恢复。
3. IPC schema 可被 CLI 或未来自动化复用。
