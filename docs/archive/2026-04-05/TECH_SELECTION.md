# 股票操盘训练与风格建模系统 - 技术选型与开源调研

**版本：** v0.1  
**状态：** 技术方案草案  
**创建日期：** 2026-03-27  
**适用范围：** `stock-notes-app` 后续独立项目 `future_work/trading-trainer`

---

## 一、结论摘要

基于当前仓库现状和开源调研，建议采用以下路线：

1. **桌面容器继续使用 Electron**，不在本阶段迁移到 Tauri。
2. **图表层继续使用 KLineChart**，直接复用当前项目已有能力。
3. **训练主引擎用 TypeScript 自研**，因为匿名回放、逐 bar 推进、会话状态和复盘口径都很业务化。
4. **行情数据采用 Provider 抽象层**：
   - v1 优先复用当前 EastMoney 适配器
   - 推荐新增 `AKTools/AKShare` 作为主数据接入方案
   - 把 `Tushare Pro` 作为可选增强源
5. **影子策略采用“两层架构”**：
   - v1：TypeScript 规则策略 + `trading-signals`
   - v2：通过 Python 适配接入 `RQAlpha / backtrader / Qlib`
6. **风格打标、训练数据集和模型训练流水线建议用 Python 子系统承载**，不要硬塞在 Electron 主进程。
7. **训练数据和会话数据不建议继续强行落 Markdown**，建议新模块使用 SQLite + 文件化数据版本作为真相层。

一句话总结：**桌面 UI 与训练工作台在现有 Electron 工程内做，图表复用 KLineChart；训练内核用 TypeScript，自研匿名回放与评分；风格打标、扩样和模型训练则走独立 Python 管线。**

---

## 二、与当前仓库的衔接

当前仓库已经具备几块可直接复用的基础：

### 2.1 已有桌面架构

- 当前项目已使用 `Electron + React + TypeScript`
- 打包链路已支持 macOS DMG
- 主进程、渲染进程、IPC、应用层和纯逻辑层已经分层

本地依据：

- `package.json`
- `docs/MODULAR_ARCHITECTURE.md`

### 2.2 已有 K 线图与复盘入口

- 当前依赖已包含 `klinecharts`
- 已存在 `ReviewKlineWorkbench` 和复盘分析视图
- 已存在 `review` IPC 和应用层复盘调用

本地依据：

- `src/renderer/components/review/ReviewKlineWorkbench.tsx`
- `src/renderer/components/ReviewAnalysisView.tsx`
- `src/main/ipc/review.ts`

### 2.3 已有行情缓存适配器

当前已有 `MarketDataService`：

- 支持按股票与周期拉取 K 线
- 支持本地 JSON 缓存
- API 失败时回退缓存

本地依据：

- `src/main/services/market-data.ts`

### 2.4 当前最需要补上的不是图表，而是训练引擎与数据闭环

当前项目缺少的是：

- 匿名样本生成
- bar-by-bar 会话状态机
- 训练动作日志
- 会话评分模型
- 跳过质量分析
- 风格画像与影子策略引擎
- 手工风格打标工作台
- 自动扩样候选池
- 数据集版本管理
- 模型训练与评估流水线

因此，新模块的重点不在“再找一个图表库”，而在 **训练业务内核 + 数据与模型闭环**。

---

## 三、开源候选与借鉴方式

### 3.1 图表与交互层

| 项目 | 定位 | 适合度 | 建议用途 | 注意点 |
|------|------|--------|----------|--------|
| [KLineChart](https://github.com/klinecharts/KLineChart) | 金融 K 线图组件 | 高 | 直接复用为训练主图表 | 当前项目已在用 |
| [Lightweight Charts](https://github.com/tradingview/lightweight-charts) | 轻量高性能金融图表 | 中 | 仅作备选或参考 | 需带 TradingView attribution |

#### 结论

- **首选 KLineChart**。它本身强调轻量、零依赖、内置指标和绘图模型，且当前项目已经接入，切换成本最低。
- `Lightweight Charts` 性能也很好，但需要在产品页或图表上满足 attribution 要求，不如直接沿用现有方案。

### 3.2 行情数据与 API 层

| 项目 | 定位 | 适合度 | 建议用途 | 注意点 |
|------|------|--------|----------|--------|
| [AKShare](https://github.com/akfamily/akshare) | 开源财经数据接口库 | 高 | 历史 K 线、日历、基础元数据 | 官方说明部分接口可能因外部源变化而移除 |
| [AKTools](https://github.com/akfamily/aktools) | AKShare 的 HTTP API 包装 | 高 | 作为 Electron 可调用本地/局域网数据服务 | 需要额外起 Python/FastAPI 服务 |
| [Tushare Pro](https://tushare.pro/document/1?doc_id=109) | 通用行情与分钟数据接口 | 中高 | 付费增强源、分钟数据增强源 | 权限和积分门槛需要单独考虑 |
| 当前 EastMoney 适配器 | 项目内已有实现 | 高 | v1 最快落地方案 | 接口非官方文档化，稳定性要靠适配层隔离 |

#### 结论

- **推荐架构：`MarketDataProvider` 抽象 + 多数据源适配。**
- `AKShare` 适合作为开源主方案，`AKTools` 适合把 Python 数据能力转成 HTTP 服务，供 Electron 主进程调用。
- 当前仓库里的 EastMoney 适配器可继续保留，用作 v1 快速交付和兜底。
- 如果后续要更稳定的分钟数据、交易日历和复权能力，可以增加 `Tushare Pro` 插件式适配。

### 3.3 回测、模拟与影子策略层

| 项目 | 定位 | 适合度 | 建议用途 | 注意点 |
|------|------|--------|----------|--------|
| [RQAlpha](https://github.com/ricequant/rqalpha) | Python 程序化交易与模拟框架 | 高 | 影子策略、模拟撮合、分析输出 | README 明示仅限非商业使用 |
| [backtrader](https://github.com/cloudQuant/backtrader) | 回测与实盘统一框架 | 中高 | 用于 bar-by-bar 策略对照、分析器参考 | 当前 cloudQuant 版本 GPL-3.0，需注意许可证边界 |
| [vn.py](https://github.com/vnpy/vnpy) | 开源量化交易平台框架 | 中 | 未来如需更真实交易/扩展多市场 | 对当前训练器来说偏重 |
| [WonderTrader](https://github.com/wondertrader/wondertrader) | 一站式量化研发交易框架 | 中 | 未来高性能回测/监控参考 | C++ 核心较重，不适合 v1 主线 |
| [Qlib](https://github.com/microsoft/qlib) | AI-oriented quant platform | 中 | 风格相似策略推荐、研究流 | 更适合研究和模型层，非 UI 训练内核 |

#### 结论

- **v1 不建议把主训练流程托管给任一量化框架。**
- 原因不是这些框架不强，而是它们更擅长“策略回测”，不擅长“匿名、逐步、人机交互式训练工作台”。
- 它们最适合作为：
  - 影子策略执行器
  - 分析器思路来源
  - 高级模拟规则的旁路引擎

### 3.4 TypeScript 指标与轻量策略层

| 项目 | 定位 | 适合度 | 建议用途 | 注意点 |
|------|------|--------|----------|--------|
| [trading-signals](https://github.com/bennycode/trading-signals) | TS/JS 技术指标库 | 高 | 在 Electron 内直接算均线、RSI、ATR 等 | 更偏指标库，不是完整回测平台 |
| [Backtest JS](https://github.com/backtestjs/framework) | TS/JS 回测框架 | 中 | 参考其 SQLite 与策略运行结构 | 数据源偏 Binance/CSV，不适合直接主用 |

#### 结论

- `trading-signals` 很适合做 **应用内影子策略基础层**。
- `Backtest JS` 更适合参考其 TypeScript + SQLite 的工程组织方式，而不建议直接作为主回测框架。

### 3.5 数据集版本与模型实验层

| 项目 | 定位 | 适合度 | 建议用途 | 注意点 |
|------|------|--------|----------|--------|
| [DVC](https://github.com/iterative/dvc) | 数据与流水线版本管理 | 高 | 管理训练数据版本、特征产物和训练流程 | 引入后需要约束目录与命名 |
| [MLflow](https://github.com/mlflow/mlflow) | 实验追踪与模型管理 | 高 | 管理模型版本、参数、指标、产物 | 可以先本地文件模式起步 |
| [LightGBM](https://github.com/microsoft/LightGBM) | 梯度提升树模型 | 高 | v1 买卖点预测基线模型 | 更适合结构化特征，不是序列 end-to-end |
| [Optuna](https://github.com/optuna/optuna) | 超参数优化框架 | 中高 | 后续自动调参 | v1 可后置 |

#### 结论

- 你新增的“用户风格扩样 + 数据集版本 + 模型版本”需求，本质上已经进入 MLOps 范畴。
- 对这个子系统，**推荐 Python + DVC + MLflow + LightGBM** 作为第一阶段主方案。
- 原因是：
  - 手工标签量初期往往不大，先用结构化特征和树模型更稳
  - 数据集和模型版本追踪的价值非常高，应该尽早落地
  - 这条链路与 Electron UI 的实时交互诉求不同，不适合绑在一起

### 3.6 桌面容器层

| 项目 | 定位 | 适合度 | 建议用途 | 注意点 |
|------|------|--------|----------|--------|
| [Electron](https://github.com/electron/electron) | 桌面应用框架 | 高 | 当前主方案 | 已落地，迁移成本最低 |
| [Tauri](https://github.com/tauri-apps/tauri) | 更小更快的桌面容器 | 中 | 仅做远期评估 | 迁移成本高，需重做很多 IPC 与打包细节 |

#### 结论

- **当前不建议迁移到 Tauri。**
- 原因不是 Tauri 不好，而是当前仓库已经基于 Electron 建立了完整主进程能力、IPC、打包链路和本地服务管理。
- 对当前阶段而言，迁移容器的收益小于重构成本。

---

## 四、正式技术选型建议

### 4.1 桌面端

**选型：继续使用 `Electron + React + TypeScript`**

原因：

1. 当前项目已经成熟运行在 Electron 上。
2. 训练器需要本地缓存、文件/数据库访问、子进程管理、未来可能需要本地 Python 服务，Electron 更顺手。
3. 当前性能瓶颈更可能出现在数据加载与状态管理，而不是桌面容器本身。

### 4.2 图表层

**选型：继续使用 `klinecharts`**

原因：

1. 当前依赖已存在，复盘页已经接入。
2. 其“零依赖、内置指标、可扩展绘图”特性很适合训练工作台。
3. 可以直接实现：
   - 当前 bar 高亮
   - 买卖点标记
   - 训练游标
   - 未来数据遮罩
   - 会话回放

### 4.3 数据接入层

**选型：`MarketDataProvider` 抽象 + 多 provider**

建议接口：

```ts
interface MarketDataProvider {
  getCandles(request: CandleRequest): Promise<MarketCandle[]>
  getSymbolMeta?(code: string): Promise<SymbolMeta | null>
  getTradingCalendar?(range: DateRange): Promise<TradingDay[]>
}
```

建议 provider：

1. `EastMoneyProvider`
   - 直接复用当前实现
   - 用于 v1 快速可用
2. `AKToolsProvider`
   - 调本地或局域网 HTTP API
   - 作为推荐主数据层
3. `TushareProvider`
   - 可选高级源
   - 适合分钟数据、复权和交易日历增强

### 4.4 训练引擎

**选型：TypeScript 自研训练状态机**

原因：

1. 这是最强业务壁垒，外部框架几乎没有现成的“匿名逐 bar 人机训练”模型。
2. 自研更容易精准满足你的规则：
   - 隐藏未来
   - 隐藏股票身份
   - 跳过样本
   - bar close 成交
   - 每根 K 线都记录动作

核心模块建议：

- `sample-pool-service`
- `anonymizer-service`
- `simulation-session-service`
- `simulation-engine`
- `session-scoring-engine`
- `review-insight-engine`
- `shadow-strategy-service`

### 4.5 风格打标与训练管线

**选型：独立 Python 子系统**

建议职责：

1. 手工标签导入与审核
2. 候选扩样与主动学习抽样
3. 特征生成
4. 数据集版本构建
5. 模型训练、评估与导出

原因：

1. 机器学习生态在 Python 更成熟。
2. 你要的“不同训练数据版本和对应模型版本”更适合实验管理工具链。
3. 训练是离线批任务，不必和桌面前端运行时强耦合。

### 4.6 存储层

**选型：训练会话用 SQLite，训练数据产物用 SQLite + 文件化版本目录**

不建议继续使用 Markdown 作为训练模块真相层，原因：

1. 训练会话是高频结构化数据，不是以“可读笔记”为主。
2. 训练过程需要按用户、样本、策略、结果、标签聚合查询。
3. 后续风格画像、统计分析、相似策略匹配都更适合 SQL。

建议保留现有原则：

- 盯盘笔记继续用 Markdown
- 训练模拟器单独用 SQLite
- 数据集版本和模型产物使用文件化目录管理
- 两者通过 `stock_code`、`session_id` 或“引用关系表”关联

建议目录：

```text
data/trading_trainer/
├── app.db
├── datasets/
│   ├── dataset_v001/
│   └── dataset_v002/
├── features/
├── models/
│   ├── model_v001/
│   └── model_v002/
└── reviews/
```

### 4.7 指标与影子策略层

**v1 选型：TypeScript 规则策略 + `trading-signals`**

原因：

1. 快，轻，容易直接跑在主进程或 worker 中
2. 能快速实现基础策略族
3. 输出格式更容易与训练会话对齐

**v2 选型：Python Adapter + `RQAlpha / backtrader / Qlib`**

职责分工：

- `RQAlpha`
  - 用于模拟撮合、策略 Mod、分析输出
- `backtrader`
  - 用于 bar-by-bar 事件驱动策略对照与分析器参考
- `Qlib`
  - 用于长期风格聚类、策略相似性、研究层能力

### 4.8 AI 分析层

**选型：规则特征优先，AI 只做总结**

建议流程：

```text
会话记录
  -> 规则特征提取
  -> 成功/失败模式聚合
  -> 生成结构化洞察
  -> 可选调用LLM做自然语言总结
```

不建议：

- 直接把买卖点“好坏判断”完全交给 LLM
- 在训练主链路中引入耗时 AI 推理

---

### 4.9 模型训练基线

**v1 推荐：结构化特征 + LightGBM**

原因：

1. 你的标签更像“个体风格驱动的操作点”，通常是稀疏且带主观性的。
2. 在这类中小规模、结构化、强噪声数据上，树模型通常比一开始上深度时序模型更稳。
3. 树模型更容易做特征解释，便于反过来校验“模型到底学到了什么风格”。

建议任务拆分：

- `buy_signal` 二分类
- `sell_signal` 二分类
- 后续再考虑统一多分类或序列决策模型

不建议 v1 直接做：

- 端到端 Transformer 预测
- 完全黑盒的强化学习交易代理
- 直接优化最终收益而不约束标签语义

## 五、建议架构

### 5.1 总体结构

```text
Renderer (React)
  -> BlindTrainingWorkbench
  -> StyleLabelWorkbench
  -> DatasetModelCenter
  -> SessionHistoryView
  -> ReplayReviewView
  -> StyleProfileView

Preload / IPC
  -> simulation:startSession
  -> simulation:step
  -> simulation:act
  -> simulation:finish
  -> simulation:getReview
  -> simulation:getProfile
  -> labeling:listLabels
  -> labeling:saveLabel
  -> modeling:listDatasets
  -> modeling:listModels

Application
  -> SimulationAppService
  -> LabelingAppService
  -> ModelingAppService

Core
  -> sample-selector
  -> anonymizer
  -> simulation-engine
  -> scoring-engine
  -> review-insight-engine
  -> strategy-compare-engine

Services / Adapters
  -> market-data-provider
  -> sqlite-repository
  -> aktools-client
  -> eastmoney-provider
  -> python-shadow-strategy-adapter
  -> python-labeling-train-adapter
```

### 5.2 与现有层级的一致性

继续沿用当前仓库的分层方式：

```text
renderer
  -> preload
    -> ipc
      -> application
        -> core
        -> services
```

这能保证：

- CLI 与 GUI 未来都可复用同一训练核心
- 后续可单独做“批量样本离线分析”
- UI 不直接掌握核心判定逻辑
- 模型训练与前端运行时隔离，避免相互拖慢

---

## 六、建议数据模型

### 6.1 建议表结构

```text
training_samples
training_sessions
training_actions
training_positions
training_reviews
training_tags
shadow_strategy_runs
shadow_strategy_trades
user_style_profiles
style_labels
dataset_versions
dataset_items
model_versions
model_evaluations
review_samples
```

### 6.2 关键字段

#### `training_samples`

- `id`
- `stock_code`
- `interval`
- `start_bar_index`
- `warmup_bars`
- `forward_bars`
- `regime_tag`
- `difficulty_score`

#### `training_sessions`

- `id`
- `sample_id`
- `anonymize_level`
- `status`
- `started_at`
- `finished_at`
- `realized_pnl_pct`
- `benchmark_return_pct`
- `skip_quality`

#### `training_actions`

- `id`
- `session_id`
- `bar_index`
- `action_type`
- `fill_price`
- `position_state`
- `confidence`
- `note`

#### `shadow_strategy_runs`

- `id`
- `session_id`
- `strategy_code`
- `entry_count`
- `exit_count`
- `realized_pnl_pct`
- `max_drawdown_pct`
- `diff_summary_json`

#### `style_labels`

- `id`
- `stock_code`
- `interval`
- `bar_index`
- `label_type`
- `source`
- `status`
- `confidence`
- `note`
- `dataset_version_id`

#### `dataset_versions`

- `id`
- `name`
- `parent_version_id`
- `label_policy_version`
- `feature_spec_version`
- `sample_count`
- `buy_count`
- `sell_count`
- `no_action_count`

#### `model_versions`

- `id`
- `name`
- `dataset_version_id`
- `task_type`
- `train_range`
- `valid_range`
- `test_range`
- `artifact_path`
- `status`

---

## 七、实施路线

### Phase 1：最小可训练闭环

1. 抽 `MarketDataProvider`
2. 完成匿名样本抽样
3. 完成逐 bar 推进会话
4. 完成买入/卖出/持有/跳过
5. 完成单会话收益与动作记录

### Phase 2：复盘增强

1. 完成会话回放
2. 完成买卖点与 MFE/MAE 分析
3. 完成跳过质量分析
4. 完成训练历史页
5. 完成手工风格打标工作台

### Phase 3：影子策略

1. 接入 `trading-signals`
2. 落地 3-5 个基础风格策略
3. 完成同窗对照报告
4. 完成候选扩样与抽样审核

### Phase 4：高级研究能力

1. 落地 `DVC + MLflow`
2. 训练 `LightGBM` 基线模型
3. 试接 `RQAlpha / backtrader`
4. 视实际价值再考虑 `Qlib` 或更复杂序列模型

---

## 八、主要风险与应对

### 8.1 数据源稳定性风险

风险：

- `AKShare` 官方明确说明，因外部数据源不受控，部分接口可能被移除
- 当前 EastMoney 接口也属于适配型方案，不宜直接写死到业务层

应对：

- 坚持 `Provider` 抽象
- 所有样本训练都从本地缓存读取
- 数据下载与训练执行解耦

### 8.2 许可证风险

风险：

- `RQAlpha` README 明示“仅限非商业使用”
- `Lightweight Charts` 需要 attribution
- `backtrader` 当前 cloudQuant 仓库为 GPL-3.0

应对：

- v1 核心功能避免强依赖这些库的运行时嵌入
- 先把它们作为参考实现或可选旁路引擎
- 商业化前做一次许可证专项审查

### 8.3 业务过早复杂化风险

风险：

- 一开始就加入涨跌停、T+1、手续费、部分成交、停牌、除权，会明显拖慢交付

应对：

- v1 先做“收盘价成交”的轻仿真
- 把复杂成交约束放到 `simulation-mode` 扩展位

### 8.4 存储模型错配风险

风险：

- 如果仍把训练会话塞进 Markdown，后续统计和画像会越来越难做

应对：

- 从一开始就把训练模块与笔记模块的存储分开

### 8.5 标签噪声与风格漂移风险

风险：

- 人工打标是主观的，且会随着你认知变化而变化
- 如果不区分标签版本，模型可能学到互相冲突的风格

应对：

- 固定标签语义
- 明确数据集版本
- 模型训练必须绑定标签政策版本
- 允许模型和数据集废弃，不强行覆盖历史

### 8.6 信息泄漏风险

风险：

- 打标和训练时若错误使用未来窗口，会导致纸面表现虚高

应对：

- 统一“可见窗口”定义
- 训练特征构造只允许使用 label 时点之前的数据
- 评估必须按时间切分

---

## 九、推荐的最终方案

### 9.1 建议主方案

```text
桌面端：Electron + React + TypeScript
图表层：KLineChart
数据层：EastMoneyProvider(v1) + AKToolsProvider(推荐主方案) + TushareProvider(可选)
训练引擎：TypeScript 自研
存储层：SQLite + 文件化数据集/模型目录
风格建模：Python + DVC + MLflow + LightGBM
影子策略：trading-signals(v1) + Python Adapter(v2)
分析层：规则引擎优先，AI 总结可选
```

### 9.2 为什么这是当前最稳的路线

1. 最大化复用现有仓库资产。
2. 把“真正独特的业务内核”掌握在自己手里。
3. 把外部开源项目用在最擅长的位置，而不是勉强当成整套产品。
4. 给未来更真实的仿真和更强的量化对照保留了扩展接口。

---

## 十、参考来源

### 10.1 图表与桌面端

- [KLineChart GitHub](https://github.com/klinecharts/KLineChart)
- [Lightweight Charts GitHub](https://github.com/tradingview/lightweight-charts)
- [Electron GitHub](https://github.com/electron/electron)
- [Tauri GitHub](https://github.com/tauri-apps/tauri)

### 10.2 数据接口

- [AKShare GitHub](https://github.com/akfamily/akshare)
- [AKTools GitHub](https://github.com/akfamily/aktools)
- [Tushare Pro `pro_bar` 文档](https://tushare.pro/document/1?doc_id=109)

### 10.3 数据集与模型实验

- [DVC GitHub](https://github.com/iterative/dvc)
- [MLflow GitHub](https://github.com/mlflow/mlflow)
- [LightGBM GitHub](https://github.com/microsoft/LightGBM)
- [Optuna GitHub](https://github.com/optuna/optuna)

### 10.4 策略与回测

- [RQAlpha GitHub](https://github.com/ricequant/rqalpha)
- [backtrader GitHub](https://github.com/cloudQuant/backtrader)
- [vn.py GitHub](https://github.com/vnpy/vnpy)
- [WonderTrader GitHub](https://github.com/wondertrader/wondertrader)
- [Qlib GitHub](https://github.com/microsoft/qlib)
- [trading-signals GitHub](https://github.com/bennycode/trading-signals)
- [Backtest JS GitHub](https://github.com/backtestjs/framework)

### 10.5 本地代码依据

- `package.json`
- `src/main/services/market-data.ts`
- `src/main/ipc/review.ts`
- `src/renderer/components/review/ReviewKlineWorkbench.tsx`
- `docs/MODULAR_ARCHITECTURE.md`
