# 回测引擎升级方案（指标策略 + 模型策略统一）

> 日期：2026-04-24  
> 目标：在不牺牲“无未来函数”原则的前提下，让回测引擎同时支持指标策略与模型策略，并可承接分层打标体系。

---

## 1. 先给结论（你关心的核心）

分层打标升级后，**回测必须配套**，但不需要推翻现有引擎。  
推荐路径是：

1. 保留现有撮合与成本内核（T+1、涨跌停、D+1入场、成本扣减）。
2. 新增“策略适配层（Strategy Adapter）”，统一接入：
   - 指标规则信号（因子阈值/技术指标触发买卖）
   - 模型信号（概率分数触发买卖）
3. 新增“组合与仓位层”，替代当前“按日等权收益均值”的简化口径。
4. 分层标签只用于训练/评估解释，不直接等于可执行交易；交易由策略层生成，回测内核统一执行。

---

## 2. 当前实现与主要缺口（基于现有代码）

### 2.1 已有能力（可复用）

- 回测内核已有防前视约束（`python/trading_trainer/models/backtester.py`）：
  - 仅 test split
  - D+1 开盘入场
  - D+N 收盘保守结算
  - 涨停买不到跳过
  - 成本与滑点已计入
- walk-forward 已复用同一执行逻辑（`python/trading_trainer/models/walk_forward.py`）。
- 报告口径说明字段已较完整（`calculation_basis` / `metric_definitions` / `data_leakage_guardrails`）。

### 2.2 关键缺口（行业常规对比）

1. 当前是“样本收益评估器”偏多，严格意义上的“资金曲线回测器”偏少。  
   现为按日等权聚合，未完整模拟现金、持仓重叠、仓位占用与换手约束。
2. 退出逻辑主要是固定 D+N，未支持“指标卖出”或“模型卖出”驱动退出。
3. 指标策略与模型策略没有统一策略接口，难以横向公平对比。
4. 缺少执行层与策略层分离后的标准化归因（信号质量 vs 执行损耗）。

---

## 3. 目标架构（行业常规 + 最小侵入）

## 3.1 分层结构

1. `Signal Layer`：产出候选信号（买/卖/平/观望）。
2. `Portfolio Layer`：选股排序、仓位分配、风控约束。
3. `Execution Layer`：撮合成交、滑点、税费、T+1、涨跌停、停牌处理。
4. `Accounting Layer`：现金/持仓/净值/换手/暴露度。
5. `Analytics Layer`：收益、风险、归因、稳定性、分层标签解释。

## 3.2 统一策略接口（核心）

```text
StrategyAdapter
  - prepare(context)
  - on_bar(market_slice) -> List[SignalIntent]
  - on_day_close(state) -> Optional[RebalanceIntent]
```

两种实现：
- `IndicatorStrategyAdapter`：从指标条件触发买卖。
- `ModelStrategyAdapter`：从模型概率 + 阈值/排序触发买卖。

这样能保证：**同一执行内核下公平比较指标策略 vs 模型策略**。

---

## 4. 分层打标与回测的衔接规则

分层打标建议拆为：
- `y_regime`（上涨/震荡/下跌）
- `y_setup`（反转买点/回调买点/突破回踩等）
- `y_outcome`（未来收益或 barrier 结果）
- `y_meta`（是否值得交易）

回测使用规则：

1. 训练阶段：分层标签用于训练多个头或多任务模型。  
2. 交易阶段：模型输出通过 `Signal Assembler` 组装成交易信号。  
3. 执行阶段：只认交易信号，不直接认标签字段。  
4. 评估阶段：在回测结果中追加分层解释（“该层贡献了多少收益/回撤/胜率”）。

这能避免“标签定义变化导致回测口径漂移”。

---

## 5. 回测口径升级（建议标准）

## 5.1 必备执行假设（A股）

- T+1 卖出限制
- 涨跌停可交易性约束
- 停牌不可交易处理
- 手续费、印花税、过户费、滑点分拆展示
- 资金与仓位上限（单票上限、总仓位上限）

## 5.2 必备风险收益指标

- 收益：累计收益、年化、超额收益（相对基准）
- 风险：最大回撤、波动率、下行波动、Calmar、Sharpe
- 交易质量：胜率、盈亏比、换手率、持仓天数分布
- 稳定性：按月份/市场状态分桶收益，walk-forward 各窗口分布
- 执行损耗：理论信号收益 vs 可成交收益（slippage drag / execution drag）

## 5.3 防未来函数检查（新增自动化）

- 特征时间戳 <= 信号时间戳
- 入场时间 > 信号时间
- 任何退出价格必须来自真实可见未来路径，不允许“同bar最优价成交”
- 对每次回测输出 `leakage_audit`（通过/失败 + 失败样本）

---

## 6. 可直接分包给 Agent 的开发任务

## 包 A：策略接口层（低风险、优先）

- 新增 `python/trading_trainer/models/strategy/`：
  - `base.py`（StrategyAdapter 协议）
  - `indicator_adapter.py`
  - `model_adapter.py`
  - `signal_types.py`（SignalIntent/OrderIntent）
- 目标：统一输出信号格式，不改动现有执行逻辑。

验收：
- 同一时间段可分别跑“指标策略”和“模型策略”并产出同结构信号。

## 包 B：执行与账户层（核心）

- 在 `backtester.py` 中拆分：
  - `execution_simulator.py`
  - `portfolio_account.py`
  - `cost_model.py`
- 增加现金、持仓、仓位占用与重叠持仓模拟。

验收：
- 回测报告可输出每日 `cash / position_value / nav / exposure / turnover`。

## 包 C：退出规则扩展（与你风格转向强相关）

- 支持退出模式：
  - 固定持有 N 日（保留）
  - 指标卖出（如跌破均线、ATR 止损）
  - 模型卖出（sell_score 触发）
  - 组合退出（时间止盈止损 + 信号退出）

验收：
- CLI 可切换退出模式，结果报告明确标注 `exit_mode`。

## 包 D：报告与解释层（交付可读性）

- 报告新增：
  - 分层标签贡献分析（regime/setup）
  - 理论收益 vs 可成交收益差异分解
  - 不同策略源（indicator/model）的对比页
- 前端 `BacktestPage` 增加“策略类型/退出模式/仓位规则”可视化摘要。

验收：
- 非技术用户可读懂“为什么赚/亏”，而非只看总收益。

## 包 E：测试与防回归（必须）

- 单元测试：
  - T+1、涨停买不到、缺失行情、停牌
  - 无未来函数检查
- 集成测试：
  - 指标策略和模型策略同内核回测一致性
  - walk-forward 报告字段完整性

验收：
- `pytest` 新增测试集通过，核心流程有固定回归样例。

---

## 7. CLI / 配置约定（建议）

```bash
python -m trading_trainer.cli model backtest \
  --strategy-type model \
  --strategy-config configs/strategy/model_v2.json \
  --portfolio-config configs/portfolio/default.json \
  --execution-config configs/execution/ashare_t1.json \
  --db auto
```

```bash
python -m trading_trainer.cli model backtest \
  --strategy-type indicator \
  --strategy-config configs/strategy/ma_pullback.json \
  --portfolio-config configs/portfolio/default.json \
  --execution-config configs/execution/ashare_t1.json \
  --db auto
```

配置分离后可以显著降低“改一个策略要改引擎代码”的维护成本。

---

## 8. 建议实施顺序（两周节奏）

1. 第1-2天：包A（策略接口层）  
2. 第3-5天：包B（账户与执行层）  
3. 第6-7天：包C（退出规则）  
4. 第8-9天：包D（报告与前端）  
5. 第10天：包E（测试 + 回归 + 文档）

里程碑门槛：
- M1：指标/模型双策略同引擎可跑
- M2：资金曲线与风险指标稳定
- M3：分层标签解释上线且可读

---

## 9. 风险提示（提前规避）

1. 若先上复杂标签、后改回测，容易出现“训练目标和交易执行目标错位”。  
2. 若只看累计收益，不看窗口稳定性与执行损耗，会重复出现“单窗口暴利假象”。  
3. 若不做账户层，策略之间对比不公平（尤其在持仓重叠明显时）。

---

## 10. 本方案与现有工程的兼容性

- 兼容现有 `BacktestEngine` 主流程，可分阶段替换内部实现。
- 兼容现有 `walk-forward`，只需改为调用新回测入口。
- 兼容现有前端 IPC（先保留旧字段，新增字段向后兼容）。

建议：先做“兼容扩展”，避免一次性重构导致研发中断。

---

## 11. 实施进度记录

> 更新日期：2026-04-24

### 已完成

| Agent | 模块 | 文件 | 状态 |
|-------|------|------|------|
| A | 策略适配层 | `models/strategy/signal_types.py` | ✅ SignalIntent / OrderIntent / SignalDirection |
| A | 策略适配层 | `models/strategy/base.py` | ✅ StrategyAdapter 抽象协议 |
| A | 策略适配层 | `models/strategy/indicator_adapter.py` | ✅ IndicatorStrategyAdapter |
| A | 策略适配层 | `models/strategy/model_adapter.py` | ✅ ModelStrategyAdapter（概率阈值 + topN） |
| B | 执行与账户层 | `models/cost_model.py` | ✅ CostConfig / CostModel（佣金/印花税/过户费/滑点分拆） |
| B | 执行与账户层 | `models/portfolio_account.py` | ✅ PortfolioAccount（cash/positions/nav/exposure/turnover） |
| B | 执行与账户层 | `models/execution_simulator.py` | ✅ ExecutionSimulator（独立执行模拟器） |
| B | 执行与账户层 | `models/backtester.py` | ✅ 重构复用 CostModel，新增 account_summary 字段 |
| C | 退出规则扩展 | `models/exit_rules.py` | ✅ ExitConfig / ExitRuleEngine（4种退出模式） |
| C | 退出规则扩展 | `cli.py` | ✅ 新增 --exit-mode / --strategy-type / --initial-capital 等 CLI 参数 |
| D | 报告与前端展示 | `src/main/ipc/backtest.ts` | ✅ runBacktestCli 支持 strategyType/exitMode |
| D | 报告与前端展示 | `src/preload/index.ts` | ✅ backtest.run 签名扩展 |
| D | 报告与前端展示 | `src/types/global.d.ts` | ✅ 类型定义更新 |
| D | 报告与前端展示 | `src/components/trading/BacktestPage.tsx` | ✅ 账户摘要/策略类型/退出模式/执行损耗展示 |
| E | 测试与防未来函数 | `models/leakage_auditor.py` | ✅ IndicatorLeakageAuditor（AST静态分析 + 运行时验证） |
| E | 测试与防未来函数 | `tests/test_leakage_audit.py` | ✅ 27个测试（含指标计算审计） |

### 防未来函数审计能力

新增 `IndicatorLeakageAuditor` 提供两层防护：

1. **AST 静态分析**：自动检测 `rolling(center=True)`、`shift(-N)`、`fillna("bfill")`、`interpolate(method='spline')` 等引入未来数据的操作
2. **运行时验证**：对比指标值与纯历史均值/含未来均值，检测指标是否使用了未来价格

已审计的源文件（全部通过）：
- `features/builder.py` — 特征工程主文件
- `labeling/indicators.py` — 标注用指标模块
- `labeling/signal_detector.py` — 信号检测器
- `labeling/stock_filter.py` — 股票筛选器
- `labeling/overnight_labeler.py` — 隔夜标注器

### 测试统计

- Python 测试：219 passed, 0 failed
- TypeScript 编译：0 errors
- Vite 构建：成功
- 向后兼容：CLI `model backtest` 默认行为不变
