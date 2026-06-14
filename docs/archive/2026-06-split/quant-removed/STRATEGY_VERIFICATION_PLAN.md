# 策略验证工作台实施计划（v1.1）

**版本：** v1.1  
**日期：** 2026-05-05  
**状态：** ✅ 已完成（Phase 1-4 全部交付，DoD 核验通过）  
**前置文档：** [MIDTERM_REPORT.md](./MIDTERM_REPORT.md)

---

## 一、背景与目标

### 1.1 背景问题（修订）

当前 ML 模型 AUC 约 0.51，接近随机水平，无法回答“模型是否真正有效”。核心缺口：

1. 缺少经典策略 Baseline：无法横向比较“简单规则 vs ML”。
2. 标签可学习性结论不足：当前有样本审计，但缺少标签结构层面的诊断结论。
3. 验证与部署关注点耦合：回测、推荐、部署混在一个工作台，不利于形成清晰验证闭环。

> 注：当前部署工作台存在回测能力，不是“功能缺失”，而是“验证域未独立承载 Benchmark / Walk-Forward”。

### 1.2 目标

建立独立的**策略验证工作台**，形成三层递进验证链路：

```
单模型回测 → Benchmark 排名（ML vs 经典策略）→ Walk-Forward（滚动稳定性）
```

### 1.3 约束

- 复用现有模块，最小化新增代码
- 不引入新依赖/新框架
- 保持现有 Workbench + Tab 交互模式
- 分阶段实施，每阶段可独立验收

---

## 二、方案修订原因（必须先对齐）

### 2.1 为什么要从 v1.0 调整到 v1.1

1. **经典策略列名依赖不可靠**  
   v1.0 直接依赖 `test.parquet` 中 `ma5/macd/boll` 列。现有特征规范中常见是 `ma_5/ma_20`，且不同 spec 不保证含 `macd/boll`。  
   **修订：** 经典策略基于 `kline_daily` 现场计算指标，不依赖特征列存在性。

2. **固定 probability 会破坏 Benchmark 公平性**  
   v1.0 设定经典策略固定 `probability=0.75`，但回测链路可能按概率做日内排序/TopN 截断，导致并列随机顺序。  
   **修订：** Benchmark 模式默认禁用阈值筛选与 TopN 截断；或使用确定性 score（无随机并列）。

3. **审计职责边界需明确**  
   已有“样本审计（时间切分/缺失/泄漏）”，再做 `label_quality` 若边界不清会重复建设。  
   **修订：** `label_quality` 只做“标签可学习性”，不重复数据完整性检查。

---

## 三、信息架构（调整后）

```
数据基座:  数据管理
人的训练:  训练总览 | 盲训工作台
量化模型:  Alpha 研究 | 模型训练 | 策略验证（新）| 模型部署
辅助:      AI 助手
```

策略验证工作台 Tab：

1. 单模型回测（复用 BacktestPage，优化布局）
2. Benchmark 排名（新增）
3. Walk-Forward（前端接已有 CLI）

部署工作台在迁移初期保留“回测已迁移”提示，过渡 1-2 个版本后移除。

---

## 四、后端设计（v1.1）

### 4.1 模块结构

```
python/trading_trainer/
├── models/
│   ├── backtester.py                 # 扩展 run_external_signals()
│   └── walk_forward.py               # 复用
├── strategies/
│   ├── __init__.py                   # 新增
│   ├── classic_signals.py            # 新增（K线现算策略信号）
│   └── benchmark.py                  # 新增（编排器）
├── research/
│   └── label_quality.py              # 新增（可学习性审计）
└── cli.py                            # 扩展命令
```

### 4.2 经典策略信号（修订版）

实现文件：`strategies/classic_signals.py`

规则：
- 输入：`kline_daily` 的 OHLCV（按 code/date）
- 内部计算：MA/MACD/BOLL/Breakout 所需指标
- 输出统一信号结构：`code/date/score/close`

策略清单（首期）：
- `ma_cross`
- `macd_cross`
- `boll_rebound`
- `breakout_n`

### 4.3 Benchmark 公平性口径（关键）

Benchmark 统一策略配置（默认）：
- `disable_threshold=true`
- `disable_topn=true`
- 同一测试时间窗
- 同一成交模拟与成本模型
- 同一指标体系

必要时可提供“生产口径对照”（开启阈值/TopN），但默认报告以公平口径为主。

### 4.4 Backtester 扩展

在 `backtester.py` 新增统一入口（命名可调整）：

```python
run_external_signals(
    signals_df,
    holding_days=2,
    benchmark_mode=True,
)
```

内部复用现有：
- `_compute_actual_returns`
- `_compute_portfolio_metrics`
- 账户级汇总逻辑

### 4.5 标签质量审计边界

`research/label_quality.py` 仅做：
- 标签分布/偏度/不平衡
- 自相关（lag1/lag5）
- 分层漂移（train/valid/test）
- 参数敏感性一致性（如 forward_days）
- 可学习性判决结论

不做：
- 数据缺失率/时间边界/泄漏字段检查（已在样本审计覆盖）

---

## 五、前端设计（v1.1）

### 5.1 Phase 1 先做壳与迁移

- 新增 `StrategyVerificationWorkbench.tsx`
- 单模型回测 Tab 接 `BacktestPage`
- Benchmark/Walk-Forward 暂占位

### 5.2 BacktestPage 优化（保持功能不减）

- 净值曲线提前到 Summary 后
- 口径说明默认折叠
- 按钮主次分层
- 阈值敏感性保留表格，并补轻量可视化（SVG）

### 5.3 BenchmarkPanel / WalkForwardPanel

- Benchmark：一键跑全策略 + ML，排名表默认按夏普排序
- Walk-Forward：参数配置 + 窗口明细 + 稳定性结论卡

---

## 六、实施阶段（修订版）

### Phase 1：工作台骨架 + 回测迁移

交付：
- `StrategyVerificationWorkbench.tsx`
- `App.tsx` 新增 verify 入口
- `BacktestPage` 布局优化
- `ModelDeploymentWorkbench` 移除回测 Tab（并保留迁移提示）

验收：
1. 新入口可见
2. 单模型回测功能与原能力一致
3. 构建通过

### Phase 2A：后端基础（单策略）

交付：
- `classic_signals.py`
- `backtester.py` 扩展 `run_external_signals`
- CLI：`benchmark run-single`

验收：
1. 单策略可执行
2. 结果可复现（同参同结果）
3. 与现有回测指标口径一致

### Phase 2B：Benchmark 全量

交付：
- `benchmark.py`
- IPC：`backtest:runBenchmark`
- 前端：`BenchmarkPanel.tsx`

验收：
1. 输出 4 个经典策略 + ML
2. 默认公平口径（禁阈值/禁TopN）
3. 前端可一键跑并排序

### Phase 3：标签质量审计

交付：
- `label_quality.py`
- CLI：`research label-quality`

验收：
1. 输出标签可学习性结论
2. 不与样本审计功能重复

### Phase 4：Walk-Forward 前端

交付：
- IPC：`backtest:runWalkForward`
- `WalkForwardPanel.tsx`

验收：
1. 前端参数可配
2. 输出窗口级结果与稳定性判断

---

## 七、风险与缓解（更新）

1. **策略信号不足**：某些策略交易数太少  
   - 缓解：支持参数模板（如 breakout lookback），报告标注“信号不足，不参与排名”。

2. **公平口径与生产口径混淆**  
   - 缓解：报告首部强制标记当前口径（Benchmark / Production-like）。

3. **长任务等待体验**（Benchmark / Walk-Forward）  
   - 缓解：IPC 长任务日志流 + 进度状态。

4. **迁移期用户路径断层**  
   - 缓解：部署页保留迁移引导提示 1-2 个版本。

---

## 八、不在本期范围

- 行业中性化、Barra 风险归因、自动再训练调度、组合优化器等，均延后到“验证闭环跑通并证明有效”之后再评估。

---

## 九、完成定义（DoD）

满足以下条件才算本期完成：

1. 策略验证工作台 3 Tab 可访问
2. Benchmark 可稳定复现并有明确公平口径
3. Walk-Forward 可在前端执行并查看结果
4. 标签质量审计能给出可学习性结论
5. `npm run build` 与关键 CLI 命令均通过

---

## 十、实施记录

**实施日期：** 2026-05-05

### 完成状态总览

| Phase | 状态 | 完成日期 |
|--------|:----:|---------|
| Phase 1：工作台骨架 + 回测迁移 | ✅ 完成 | 2026-05-05 |
| Phase 2A：后端基础（单策略） | ✅ 完成 | 2026-05-05 |
| Phase 2B：Benchmark 全量 | ✅ 完成 | 2026-05-05 |
| Phase 3：标签质量审计 | ✅ 完成 | 2026-05-05 |
| Phase 4：Walk-Forward 前端 | ✅ 完成 | 2026-05-05 |

### 交付物清单

**新增文件（7 个）：**

| 文件 | 行数 | 阶段 |
|------|------|------|
| `src/components/trading/StrategyVerificationWorkbench.tsx` | ~143 | P1 |
| `src/components/trading/model/BenchmarkPanel.tsx` | ~360 | P2B |
| `src/components/trading/model/LabelQualityAuditPanel.tsx` | ~280 | P3 |
| `src/components/trading/model/WalkForwardPanel.tsx` | ~290 | P4 |
| `python/trading_trainer/strategies/classic_signals.py` | ~200 | P2A |
| `python/trading_trainer/strategies/benchmark.py` | ~120 | P2B |
| `python/trading_trainer/research/label_quality.py` | ~270 | P3 |

**修改文件（7 个）：**

| 文件 | 改动 | 阶段 |
|------|------|------|
| `src/App.tsx` | 新增 verify 模块 + 路由 | P1 |
| `src/components/trading/BacktestPage.tsx` | 口径说明折叠 + CSV 导出 + IPC 结构升级 | P1 |
| `src/components/trading/ModelDeploymentWorkbench.tsx` | 移除 backtest Tab + 迁移提示 | P1 |
| `src/main/ipc/backtest.ts` | 新增 runBenchmark + runWalkForward IPC | P2B/P4 |
| `src/types/global.d.ts` | 新增 runBenchmark + runWalkForward 类型 | P2B/P4 |
| `src/preload/index.ts` | 新增 runBenchmark + runWalkForward bridge | P2B/P4 |
| `python/trading_trainer/models/backtester.py` | 新增 run_external_signals 方法 | P2A |
| `python/trading_trainer/cli.py` | 新增 benchmark + label-quality 命令 | P2A/P3 |

### DoD 核验

| # | 条件 | 结果 |
|---|------|------|
| 1 | 策略验证工作台 3 Tab 可访问 | ✅ 侧边栏"策略验证"入口，3 Tab 均可切换 |
| 2 | Benchmark 可稳定复现并有明确公平口径 | ✅ benchmark_mode=True 禁阈值/TopN，4 策略+ML |
| 3 | Walk-Forward 可在前端执行并查看结果 | ✅ 参数可配，窗口明细表+稳定性评估 |
| 4 | 标签质量审计能给出可学习性结论 | ✅ 3 套预设+评分+判决 |
| 5 | npm run build 通过 | ✅ 83 modules transformed, 零错误 |

