# 幻化量方 Alpha 研究平台 — 架构设计

**版本：** v1.0  
**状态：** 实施中（第一期）  
**日期：** 2026-04-28  
**替代：** `FEATURE_EXPLORATION_FACTOR_MINING_TECH_SPEC.md`（已废弃）

## 1. 架构总览

### 1.1 当前系统诊断

```
                        当前系统能力全景
┌─────────────────────────────────────────────────────────┐
│                    ✅ 已有（稳固）                        │
│                                                         │
│  数据层    ████████  日线/15m/5m K线 + 股票池 + 同步     │
│  打标层    ████████  日内8规则 + 日线6波段 + 质量门控     │
│  特征层    ████████  v001-v011 (179因子) + Parquet管线   │
│  训练层    ████████  CatBoost/LightGBM + 评估指标         │
│  部署层    ████████  模型仓库 + 信号推理 + 反馈闭环       │
│  回测层    ██░░░░░░  CLI存在但功能简陋                    │
│  因子层    ░░░░░░░░  完全缺失（无IC/IR/分箱/稳定性）      │
│  监控层    ░░░░░░░░  缺失（无模型衰减/因子漂移检测）      │
└─────────────────────────────────────────────────────────┘
```

**核心问题**：从数据到模型的上半身已建好，但从模型到策略的下半身——因子研究、回测验证、风险归因——是空的。

### 1.2 三引擎架构

```
                    新架构：三引擎 + 一底座

    Alpha 研究引擎          策略验证引擎          生产运营引擎
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │ 因子库管理     │      │ Walk-Forward │      │ 信号推理      │
    │ IC/IR 分析   │  →   │ 回测 + 归因   │  →   │ 绩效监控      │
    │ 因子发现      │      │ 阈值优化      │      │ 因子衰减      │
    │ 特征体检      │      │ 策略对比      │      │ 再训练触发    │
    └──────────────┘      └──────────────┘      └──────────────┘
           ↑                                            │
           │              ┌──────────────┐              │
           └──────────────│  实验管理中心  │──────────────┘
                          │  一键复现     │
                          │  版本对比     │
                          └──────────────┘
```

---

## 2. 引擎一：Alpha 研究引擎（🔴 P0，新页面）

### 2.1 定位

因子从开发到入库的完整生命周期管理。这是整个系统价值最高的模块。

### 2.2 功能设计

**Tab 1：因子库浏览器**
- 展示所有 feature spec 版本（v001-v011）的因子列表
- 按类别分组（趋势/动量/波动/量价/截面/微观结构）
- 每个因子：名称、公式、所属 spec 版本、数据覆盖率

**Tab 2：单因子 IC 分析**（核心）
- 选择冻结数据集 + feature spec 版本
- 输出 RankIC 均值、标准差、IR
- IC 时间序列图（按月份）
- IC 分布直方图
- IC 衰减曲线（lag 1/3/5/10/20）

> IR 口径说明（2026-05 更新）  
> - 单因子 IR：按月 RankIC 序列计算 `IR = mean(monthly_rank_ic) / std(monthly_rank_ic)`。  
> - 最小有效条件：月度样本不少于 6 个月，且 `std >= 1e-3`。  
> - 页面总览 `IC IR`：所有可计算单因子 IR 的均值（并展示可计算因子数）。  
> - 旧口径（跨因子均值/标准差比值）已废弃，不再用于评估稳定性。

**Tab 3：因子分箱收益**
- 5/10 分箱，每箱平均收益 + 胜率
- 单调性判断
- 多空组合收益（Top - Bottom）

**Tab 4：因子相关性矩阵**
- 热力图
- >0.7 高亮
- 聚类树状图

### 2.3 Python 模块

```text
python/trading_trainer/research/
├── __init__.py
├── factor_analysis.py    # IC/IR/分箱/相关性/稳定性
└── cli.py                # CLI 入口
```

输出统一 JSON schema：

```json
{
  "success": true,
  "metrics": { "ic_mean": 0.03, "ic_ir": 0.5, ... },
  "factor_details": [{ "name": "adx", "ic": 0.04, "rank_ic": 0.05, ... }],
  "tables": { "ic_by_month": [...], "bin_returns": [...] },
  "charts": { "correlation_matrix": [[...]], "ic_timeseries": [...] }
}
```

### 2.4 前端组件

```
AlphaResearchWorkbench
├── AlphaHeader（数据集/spec选择器 + 运行按钮）
├── FactorListPanel（因子库 + 分类筛选）
├── ICAnalysisPanel（IC时间序列 + 分布直方图）
├── BinReturnPanel（分箱收益柱状图）
└── CorrelationPanel（相关性热力图）
```

### 2.5 导航位置

```diff
  overview    → 训练总览
  blind       → 盲训工作台
  model       → 模型训练（现有打标/数据集/特征/训练）
+ alpha       → Alpha 研究（新增）
  deploy      → 模型部署
  data        → 数据管理
  aichat      → AI 助手
```

---

## 3. 引擎二：策略验证引擎（🟠 P1，增强现有页面）

### 3.1 定位

模型到策略的桥梁。不建新页面，增强 TrainTab 和集成实验页。

### 3.2 增强列表

| 增强 | 载体 | 说明 |
|------|------|------|
| Walk-Forward 面板 | TrainTab 新子页签 | 窗口指标表 + 稳定性评分 + 时间轴可视化 |
| 阈值优化集成 | TrainTab | 训练完成后自动跑 optimize-threshold，输出阈值-收益曲线 |
| 策略对比雷达图 | EnsembleTab | 多模型横向对比：AUC / 年化 / 回撤 / 夏普 / 胜率 |

---

## 4. 引擎三：生产运营引擎（🟡 P2，增强部署页）

### 4.1 定位

模型上线后的持续监控。

### 4.2 增强列表

| 增强 | 载体现状 | 说明 |
|------|---------|------|
| 信号绩效面板 | 新子页签（Signal Performance） | 信号累计收益 / 采纳率 / 胜率 |
| 因子衰减监控 | 新子页签 | IC 定期对比，衰减 >30% 告警 |
| 自动再训练触发 | RetrainingTab | 可配置触发规则 |

---

## 5. 实验管理中心（横切底座）

### 5.1 策略

**不新建 3 张表**。扩展现有 `model_training_tasks` 表：

```sql
ALTER TABLE model_training_tasks ADD COLUMN experiment_name TEXT DEFAULT '';
ALTER TABLE model_training_tasks ADD COLUMN experiment_config_json TEXT DEFAULT '{}';
ALTER TABLE model_training_tasks ADD COLUMN experiment_tags TEXT DEFAULT '';
```

### 5.2 能力

- 按实验名分组查看关联产物（数据集 → 特征 → 训练 → 评估 → 模型）
- 对比两个实验的关键指标
- 一键复现（用保存的 config_json 重新触发）

---

## 6. 与原方案的差异

| 维度 | 原方案 | 本方案 |
|------|--------|--------|
| 定位 | 一个 12-Cell 研究工作台 | 三引擎架构 |
| 因子研究 | 一个 Cell | 独立引擎页面（核心价值） |
| DB 设计 | 3 张新表 | 0 张新表（扩展现有） |
| IPC 数量 | 15 个 | 3-4 个 |
| JupyterLab | P1 完整实现 | 砍掉 |
| 第一期 | 骨架 + 只读 Cell | 因子 IC 分析完整闭环 |

---

## 7. 实施分期

### 🥇 第一期：Alpha 引擎 MVP（当前）

| 任务 | 关键产出 |
|------|---------|
| `python/trading_trainer/research/__init__.py` | 包初始化 |
| `python/trading_trainer/research/factor_analysis.py` | IC/RankIC/分箱/相关性计算 |
| `python/trading_trainer/research/cli.py` | CLI 入口 `factor-analyze` |
| `src/main/ipc/modelResearchIpc.ts` | research IPC（`research:listDatasets` / `research:listFeatureTasks` / `research:factorAnalyze`） |
| `src/components/trading/AlphaResearchWorkbench.tsx` | 三面板页面骨架 |
| `src/App.tsx` | 新增 `alpha` 导航项 |

**验收**：选数据集+v011 spec → 看到每个因子的 IC/IR 和分箱收益

### 🥈 第二期：策略验证闭环

- Walk-Forward 面板
- 阈值优化集成
- 实验管理 + 对比

### 🥉 第三期：生产运营增强

- 信号绩效监控
- 因子衰减检测
- 自动再训练触发

---

## 8. 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 图表库 | ECharts（已有 klinecharts） | 热力图/树状图/雷达图原生支持 |
| 数据分析 | Python pandas+numpy | 已有基础设施 |
| 因子分析输出 | JSON | 数据驱动渲染 |
| 实验管理 | 扩展 model_training_tasks | 不建新表 |
| IPC 模式 | 复用 ok/fail + DI 工厂函数 | 一致性优先 |

---

## 9. 文件索引

| 文件路径 | 状态 |
|---------|------|
| `python/trading_trainer/research/__init__.py` | 🔴 待创建 |
| `python/trading_trainer/research/factor_analysis.py` | 🔴 待创建 |
| `python/trading_trainer/research/cli.py` | 🔴 待创建 |
| `src/main/ipc/modelResearchIpc.ts` | 🔴 待创建 |
| `src/components/trading/AlphaResearchWorkbench.tsx` | 🔴 待创建 |
| `src/App.tsx` | 🟠 待修改（导航 + 路由） |
| `src/main/ipc/model.ts` | 🟠 待修改（注册 research IPC） |
| `src/main/index.ts` | 🟠 待修改（注册入口） |
