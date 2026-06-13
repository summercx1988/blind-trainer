# 模型训练 Tab 流程重构方案

**版本：** v1.0  
**状态：** 待实施  
**日期：** 2026-04-29  
**影响范围：** 模型训练页面 Tab 结构、Alpha 研究页面  
**不影响：** 盲训工作台（完全隔离，详见第 7 节）

---

## 1. 问题诊断

### 1.1 当前流程

```
候选审核 → 标签审查 → 数据集冻结 → 特征工程 → 训练&评估 → 集成实验
```

### 1.2 核心问题

1. **因果倒置**：第一步"候选审核"要求用户逐只股票手动生成候选，无法批量操作全市场 5000+ 只股票。它不是流水线入口，而是研究/诊断工具。
2. **缺少策略打标入口**：Python 后端已支持全市场批量打标（隔夜/波段/日线），但前端没有批量打标 Tab。
3. **概念混淆**："候选审核"审核的是因子信号候选，"标签审查"审核的是波段标签质量，两者概念不同却并列。
4. **Alpha 研究太薄**：因子库完全空白，缺少 IC 时间序列/分布直方图/衰减曲线。

### 1.3 根本原因

系统把"因子信号候选"当成了流水线起点。正确认知是：

- **标签先于特征，特征先于模型**
- 先定义交易目标（什么是一个好交易）→ 生成标签 → 找能预测标签的特征 → 训练模型

---

## 2. 正确流程设计

```
标签与数据集                    特征与训练                 信号审核(可选)
┌─────────────────────┐    ┌────────────────────┐    ┌─────────────────┐
│ Step 1: 策略打标     │    │ Step 3: 特征构建    │    │ Step 5: 信号审核 │
│  全市场批量打标      │ →  │  选规格+构建       │ →  │  模型信号可视化  │
│  多种标签口径        │    │  严格真实数据模式   │    │  K线+买卖点叠加  │
│                     │    │                    │    │                 │
│ Step 2: 抽样审核     │    │ Step 4: 训练评估    │    │                 │
│  K线可视化检查       │    │  选引擎+调参       │    │                 │
│  手动修正标签        │    │  Walk-Forward验证   │    │                 │
│  冻结数据集          │    │  模型对比选择       │    │                 │
└─────────────────────┘    └────────────────────┘    └─────────────────┘
```

---

## 3. 实施内容

### 3.1 模型训练 Tab 重构

**旧 Tab 结构（6个）：**
```
candidate(候选审核) → review(标签审查) → dataset(数据集冻结) → features(特征工程) → train(训练&评估) → ensemble(集成实验)
```

**新 Tab 结构（4个）：**
```
labeling(标签与数据集) → features(特征与训练) → inspection(信号审核) → ensemble(集成实验)
```

#### 新 Tab 1：标签与数据集 (`labeling`)

合并旧 `candidate` + `review` + `dataset` 三个 Tab，形成紧凑的标签→数据集流程。

| 子功能 | 来源 | 改动 |
|--------|------|------|
| 策略打标面板 | 新增 | 调用已有的 `modeling:generateLabels` / `modeling:generateSwingLabels`，支持全市场批量打标 |
| 标签参数选择 | 新增 | label_method / threshold / holding_days / trend_filter 等，替代旧的 Outcome Gate 参数 |
| 标签结果概览 | 新增 | 正负样本比例、时间分布、行业分布 |
| 抽样K线审核 | 复用 `LabelInspectPanel` | 保留现有 K 线可视化审核功能 |
| 数据集管理 | 复用 `DatasetTab` 核心 | 创建草稿、策略预览、冻结、合并、对比 |
| 候选列表(可选) | 降级为子面板 | 从旧 CandidateTab 中提取候选列表展示，不再作为主入口 |

#### 新 Tab 2：特征与训练 (`features`)

合并旧 `features` + `train` 两个 Tab。

| 子功能 | 来源 | 改动 |
|--------|------|------|
| 特征构建 | 复用 `FeatureTab` | 不变 |
| 模型训练 | 复用 `TrainTab` | 不变 |
| Walk-Forward 面板 | 新增 | 调用 Python `model walk-forward`，展示窗口指标和稳定性评分 |

#### 新 Tab 3：信号审核 (`inspection`)

降级旧 `CandidateTab` 的核心功能为可选检查步骤。

| 子功能 | 来源 | 改动 |
|--------|------|------|
| 模型信号可视化 | 新增 | 选一个已训练模型 → 在 K 线上叠加买卖信号 |
| 单股票候选检查 | 从旧 CandidateTab 提取 | 保留单股票因子候选生成和审核功能 |

#### 新 Tab 4：集成实验 (`ensemble`)

保持不变。

---

### 3.2 Alpha 研究增强

#### 因子库浏览器（补全空壳）

- 从 `features/specs.py` 中提取因子元数据（名称、版本、类别）
- 按类别分组展示（趋势/动量/波动/量价/截面/微观结构）
- 显示每个因子的数据覆盖率

#### IC 分析增强

- 新增 IC 时间序列（按月份）— Python 后端 `factor_analysis.py` 新增 `compute_ic_timeseries`
- 新增 IC 分布直方图 — Python 后端新增 `compute_ic_distribution`
- 新增 IC 衰减曲线（lag 1/3/5/10/20）— Python 后端新增 `compute_ic_decay`

---

## 4. 文件改动清单

### 4.1 新建文件

| 文件路径 | 说明 |
|---------|------|
| `src/components/trading/model/LabelingDatasetTab.tsx` | 新 Tab 1：标签与数据集 |
| `src/components/trading/model/FeatureTrainTab.tsx` | 新 Tab 2：特征与训练（合并旧 FeatureTab + TrainTab） |
| `src/components/trading/model/InspectionTab.tsx` | 新 Tab 3：信号审核 |

### 4.2 修改文件

| 文件路径 | 改动 |
|---------|------|
| `src/components/trading/ModelTrainingWorkbench.tsx` | Tab 定义改为 4 个，workflow steps 改为 3 步 |
| `python/trading_trainer/research/factor_analysis.py` | 新增 IC 时序/分布/衰减计算 |
| `src/components/trading/AlphaResearchWorkbench.tsx` | 因子库浏览器补全、IC 分析增加图表 |

### 4.3 不修改文件

| 文件路径 | 理由 |
|---------|------|
| `src/components/trading/BlindTrainingWorkbench.tsx` | 完全独立，不受影响 |
| `src/components/trading/blind-workbench/*` | 盲训子组件，完全独立 |
| `src/components/trading/blind/*` | 盲训工具模块，完全独立 |
| `src/main/ipc/blind.ts` | 盲训 IPC，完全独立 |
| `src/main/blindDb.ts` | 盲训独立数据库，完全独立 |
| `src/components/trading/model/CandidateTab.tsx` | 保留不删，新 Tab 3 复用其子功能 |
| `src/components/trading/model/DatasetTab.tsx` | 保留不删，新 Tab 1 复用其核心功能 |
| `src/components/trading/model/FeatureTab.tsx` | 保留不删，新 Tab 2 复用 |
| `src/components/trading/model/TrainTab.tsx` | 保留不删，新 Tab 2 复用 |
| `src/components/trading/model/EnsembleTab.tsx` | 保持不变 |

---

## 5. 实施分期

### P0-1：模型训练 Tab 重构

1. 新建 `LabelingDatasetTab.tsx`：策略打标面板 + 抽样审核 + 数据集管理
2. 新建 `FeatureTrainTab.tsx`：特征构建 + 训练评估
3. 新建 `InspectionTab.tsx`：信号审核（可选）
4. 修改 `ModelTrainingWorkbench.tsx`：新 Tab 定义 + 新 Workflow

### P0-2：Alpha 研究增强

1. `factor_analysis.py` 新增 IC 时序/分布/衰减
2. `AlphaResearchWorkbench.tsx` 因子库浏览器补全
3. `AlphaResearchWorkbench.tsx` IC 分析增加图表

---

## 6. 验收标准

1. 模型训练页面 Tab 从 6 个简化为 4 个，流程为：标签与数据集 → 特征与训练 → 信号审核 → 集成实验
2. 第一步是"策略打标"（全市场批量），不再是"单只股票候选审核"
3. 标签打完后可抽样 K 线审核并冻结数据集
4. 盲训工作台功能完全不受影响（零交叉依赖）
5. Alpha 研究因子库不再空白
6. IC 分析增加时间维度（按月 IC 序列）

---

## 7. 盲训工作台隔离证明

### 7.1 组件层隔离

盲训工作台 (`BlindTrainingWorkbench.tsx`) 不导入任何模型训练组件（CandidateTab、DatasetTab、FeatureTab、TrainTab、EnsembleTab、LabelInspectPanel）。

盲训的子组件 (`blind-workbench/` 9 个文件 + `blind/` 5 个文件) 全部自包含，无跨模块引用。

### 7.2 IPC 层隔离

盲训使用的 IPC 通道全部是 `db:*`、`profile:*`、`simulation:*`、`data:getRandomSamples`、`data:getCandles`。

模型训练使用的 IPC 通道全部是 `modeling:*`。

**零重叠。**

### 7.3 数据库层隔离

盲训使用独立数据库 `blind-training.db`（通过 `getBlindDb()` 访问）。

模型训练使用主数据库 `stock-trading.db`（通过 `getDb()` 访问）。

两个数据库的表完全不同。盲训库不包含 `signal_candidates`、`dataset_versions`、`dataset_items`、`feature_build_tasks`、`model_training_tasks`、`model_versions` 等模型训练相关表。

### 7.4 唯一交叉点

`BlindTrainingWorkbench.tsx` 第 183 行调用 `window.electronAPI?.predictSeries?.()` 在 K 线图上叠加显示已部署模型的买卖信号。这是一个**只读消费者关系**（读取模型推理结果用于展示），与模型训练 Tab 结构完全无关，仅依赖模型部署/推理功能。

**结论：本次重构不会对盲训工作台产生任何影响。**
