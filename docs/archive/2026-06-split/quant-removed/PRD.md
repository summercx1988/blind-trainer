# 主 PRD（总览索引）

**版本：** v1.1  
**状态：** 双子系统并行版  
**日期：** 2026-04-15

## 1. 总体产品定义

产品包含两个平行、相对独立的子系统：

1. 盲训子系统：目标是提升个人交易决策能力。
2. 模型训练子系统：目标是产出可用买卖点提醒模型。

两者共享底座，但业务闭环独立，不互相依赖上线。

## 2. 子系统边界

### 2.1 盲训子系统

1. 真实历史 K 线随机起点训练
2. 人工决策模拟盘执行
3. 会话记录与复盘分析

### 2.2 模型训练子系统

1. 经典量化因子候选买卖点
2. 人工审核、编辑、确认训练数据
3. 模型训练与评估
4. 第二期盘中实时提醒

## 3. 当前文档入口

1. 业务需求（BRD）：[BRD.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/BRD.md)
2. 盲训子系统 PRD：[PRD-blind-training.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/PRD-blind-training.md)
3. 模型训练子系统 PRD：[PRD-model-training.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/PRD-model-training.md)
4. 核心技术方案：[CORE_TECH_SOLUTION.md](/Users/xudan/Documents/trae_projects/stock-trading-simulator/docs/CORE_TECH_SOLUTION.md)

## 4. 当前代码已落地入口

当前 Electron 壳层已接入以下前台模块：

1. `训练总览`
2. `盲训工作台`
3. `训练复盘`
4. `模型训练`
5. `数据管理`

其中：

1. 盲训与模型训练仍是平行子系统。
2. `训练复盘` 服务于盲训闭环。
3. `数据管理` 同时服务于两条业务线的真实数据底座。

## 5. 研发优先级

### 5.1 盲训线

1. 样本真实化
2. 记录真实化
3. 复盘结构化

### 5.2 模型线

1. 候选信号生成
2. 人审确认链路
3. 数据集版本化
4. 模型训练评估
5. 盘中提醒（第二期）

## 6. 关键原则

1. 文档以代码与可交付范围为准。
2. 先保证子系统各自闭环，再做联动增强。
3. 所有训练与提醒结果必须可追溯到版本。
