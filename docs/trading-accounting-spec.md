# 盲训交易会计口径规约

> 本文档登记盲训工作台所有交易相关的计算公式、配置口径与配色约定。
> 配套设计：[2026-06-18-workbench-trading-overhaul-design.md](./superpowers/specs/2026-06-18-workbench-trading-overhaul-design.md)
> 配色 token：[UI_DESIGN_SPEC.md §2.1](./UI_DESIGN_SPEC.md)

---

## 1. 仓位（fixedBuyShares）

### 1.1 计算公式

会话开始时（首次进入或换样本时），按以下公式一次性计算本会话的固定买入股数，写入 `TradingState.fixedBuyShares`：

```
fixedBuyShares = floor(初始资金 × 仓位比例档位 ÷ 首根成交价 ÷ lotSize) × lotSize
```

- `初始资金`：当前 profile 的 `current_capital`（默认 100,000）。
- `仓位比例档位`：见 §1.2。
- `lotSize`：100 股（A 股最小交易单位）。
- 之后每次点 B 都买 `fixedBuyShares` 股，直到剩余现金不足以下一手。

### 1.2 仓位档位

设置面板"仓位档位"分段选择器，可选值：

| 档位 | 比例 | 说明 |
|---|---|---|
| 1/5 | 0.2 | |
| 1/4 | 0.25 | |
| 1/3 | 0.3333 | |
| 1/2 | 0.5 | **默认**（与历史半仓行为一致） |
| 2/3 | 0.6667 | |
| 3/4 | 0.75 | |

持久化在 `app_preferences.workbench_settings_v1.positionRatio`，缺省 0.5。

### 1.3 示例

- 选 1/2，首根成交价 10 元 → `100000 × 0.5 / 10 = 5000` → 每次 B 买 5000 股。
- 选 1/3，首根成交价 10 元 → `100000 × 0.3333 / 10 ≈ 3333.3` → 取整到 100 股 → 3300 股。

### 1.4 生效时机

- **下次进入会话或重新加载样本时生效**——不在训练中途改变 `fixedBuyShares`，避免行为漂移。
- 与 `samplePoolBars`/`candidateCount` 一致。

---

## 2. 持仓成本（avgPrice）

### 2.1 公式：含手续费移动加权平均

买入时：

```
新 avgPrice = (旧 shares × 旧 avgPrice + 本次买入成交额 + 本次买入手续费) / 新总股数
```

其中：

- `本次买入成交额 = buyShares × price`
- `本次买入手续费 = max(minCommission, 成交额 × commissionRate)`，默认 `minCommission=5`、`commissionRate=0.0003`

### 2.2 与历史口径的差异

**历史口径（已废弃）**：`avgPrice = amount / buyShares = price`，不含手续费，且因加仓被禁而退化为成交价。

**新口径**：含手续费，支持多次加仓的加权平均。

**影响**：

- `avgPrice` 略高于成交价（多了买入费分摊）。
- 实现盈亏和浮动盈亏同步抬高（买入费不再在卖出端重复扣减）。
- **历史 session 不回算**，保留原值。

### 2.3 卖出后

卖出永远全平（`sellShares = state.shares`），卖出后 `avgPrice = 0`、`shares = 0`、`fixedBuyShares` 保留。

---

## 3. 盈亏

### 3.1 浮动盈亏（unrealizedPnl）

```
unrealizedPnl = (markPrice - avgPrice) × shares
```

- `markPrice`：当前 K 线收盘价。
- `avgPrice`：含费口径（见 §2.1）。
- 空仓时为 0。

### 3.2 实现盈亏（realizedPnl）

卖出时累加：

```
本次 realizedPnl = (price - avgPrice) × sellShares - 卖出手续费
账户 realizedPnl = 旧 realizedPnl + 本次 realizedPnl
```

- `avgPrice` 已含买入费，所以买入费不再被重复低估。
- 卖出手续费 `= max(minCommission, 成交额 × commissionRate)`。

### 3.3 会话结算

会话结束自动平仓使用相同公式（`settleAtSessionEnd`），未实现盈亏转化为实现盈亏。

---

## 4. 卡片百分比基准

状态卡片新增百分比副标签，分母按行情惯例独立选取：

| 卡片 | 主值 | 副标签 | 分母公式 |
|---|---|---|---|
| 净值 | accountEquity | 收益率 X%（已有） | `totalPnl / initialCapital` |
| 可用资金 | cash | 剩余 X% | `cash / initialCapital` |
| 持仓 | shares | 仓位 X% | `shares × markPrice / (cash + shares × markPrice)` |
| 浮动盈亏 | unrealizedPnl | ±X%（同色） | `unrealizedPnl / (avgPrice × shares)` 即持仓成本 |
| 已实现盈亏 | realizedPnl | ±X%（同色） | `realizedPnl / initialCapital` |

- 空仓时浮动盈亏副标签显示 `-`。
- 百分比颜色随主值（正红负绿，见 §5）。

---

## 5. 配色约定（A 股涨红跌绿）

### 5.1 Token

| 变量 | 值 | 含义 |
|---|---|---|
| `--color-up` | `#dc2626` | 涨/正（红） |
| `--color-down` | `#16a34a` | 跌/负（绿） |

定义在 `src/index.css:31-32`，所有 `.up`/`.down` class 通过 token 引用。

### 5.2 K 线蜡烛色

`BaseKlineChart.tsx` 的 `CHART_STYLES` 使用 `#dc2626`/`#16a34a`（与 token 一致）。

### 5.3 不动的颜色（非涨跌语义）

- 数据初始化按钮绿（`DataManagement.css`）：功能色。
- benchmark 买/卖橙/蓝（`BaseKlineChart.tsx`）：对比色。
- 趋势主线蓝/teal（`ProfileManager.tsx`）：指标系列色。
- REGIME `mixed/sideways/volatile` 灰/蓝/橙：中性分类色。
- 收盘价橙（`BlindTrainingWorkbench.css`）：中性强调色。

### 5.4 历史遗留

`ProfileManager.tsx` 趋势图（散点 + Y 轴标签）曾误用欧美"正绿负红"方向，已于本次改造修正。

---

## 6. 动作日志盈亏%列

动作日志表格在「盈亏」列右侧新增「盈亏%」列：

```
盈亏% = realizedPnl / amount × 100
```

- 卖出行：`amount` 是卖出成交额，盈亏% 表示该笔卖出相对成交额的盈亏比例。
- 买入/持有/跳过行：显示 `-`。
- 数据库 schema 早已预留 `realized_pnl`/`unrealized_pnl`，无需迁移。

---

## 7. 引擎常量

`DEFAULT_TRADING_CONFIG`（`tradingEngine.ts:11-17`）：

| 常量 | 值 | 说明 |
|---|---|---|
| `initialCapital` | 100,000 | 默认初始资金 |
| `commissionRate` | 0.0003 | 万三手续费率 |
| `minCommission` | 5 | 单笔最低 5 元 |
| `buyBudgetRatio` | 0.5 | 兜底半仓比例（仅当 `fixedBuyShares = 0` 时回退使用） |
| `lotSize` | 100 | A 股最小交易单位 |
