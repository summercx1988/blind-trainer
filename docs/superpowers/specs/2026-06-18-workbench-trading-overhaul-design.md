# 盲训工作台交易体验改造设计

> 日期：2026-06-18
> 状态：已与用户确认，待写实现计划
> 关联文档：[UI_DESIGN_SPEC.md](../../UI_DESIGN_SPEC.md)、[trading-accounting-spec.md](../../trading-accounting-spec.md)（本次新增）

---

## 1. 背景与动机

体验盲训工作台时发现 5 类问题：

1. 点击 B 默认半仓买入，但**持仓后无法二次买入**——不能通过加仓到达全仓。
2. 买入预算比例硬编码为 0.5，无法按资金量调整（如 1/3、1/4、1/5）。
3. 状态卡片（持仓/可用资金/浮动盈亏/实现盈亏）只显示金额，缺少百分比副标签。
4. 持仓成本 `avgPrice` 不含手续费，且 `avgPrice = amount / shares = price` 退化为成交价（含费加权平均逻辑因加仓被禁而从未生效）。
5. 动作日志缺少"盈亏百分比"列。

追加需求：

6. 全站颜色需要回归 A 股"涨红跌绿"惯例（排查发现主体已对齐，仅 `ProfileManager.tsx` 趋势图存在方向残留）。
7. 将上述口径沉淀为文档，便于后续维护者理解。

---

## 2. 现状关键事实（来自代码探索）

- **B 半仓公式**：`src/components/trading/blind/tradingEngine.ts:86` `budget = state.cash * 0.5`（按剩余现金，非初始资金）。
- **二次买入被两处拦截**：UI `ActionSection.tsx:23` `disabled={accountShares > 0}` + 引擎 `tradingEngine.ts:82-83` `state.shares > 0` 直接拒绝。
- **持仓成本**：`tradingEngine.ts:101` `avgPrice = amount / buyShares`，其中 `amount = buyShares * price`，**手续费未纳入**。
- **单仓位模型**：卖出永远全平 `sellShares = state.shares`（`tradingEngine.ts:124`），卖出后 `avgPrice` 重置为 0。
- **动作日志表** `trade_actions`（`src/main/blindDb.ts:45-61`）已含 `realized_pnl`、`unrealized_pnl` 字段；前端内存类型 `LocalActionLog` 与渲染 UI 未接 `unrealizedPnl`。**无 DB 迁移需求**。
- **配置持久化**：`app_preferences` 表 + `db:getPreference/savePreference` IPC 已存在；当前仅 `workbench_settings_v1` 一个 key，无仓位配置。
- **配色 token**：`src/index.css:31-32` `--color-up: #dc2626`（红）/ `--color-down: #16a34a`（绿），主体已对齐 A 股惯例。
- **配色残留**：`ProfileManager.tsx:597/580/581/649/650` 趋势图仍为欧美"正绿负红"方向。

---

## 3. 设计决策

### 3.1 B 操作语义：会话开始时按比例算固定股数（问题 1+2 联动）

**规则**：

- 会话开始时（首次进入或换样本时），按 `初始资金 × 仓位比例档位 ÷ 当时成交价`，向下取整到 100 股的整数倍，得到本会话的 `fixedBuyShares`。
- 之后每次点 B 都买 `fixedBuyShares` 股，直到剩余现金不足以下一手。
- `fixedBuyShares` 写入 `TradingState`（会话级常量），不再每次动态计算。

**仓位档位（设置面板新增）**：

| 档位 | 比例 | 默认 |
|---|---|---|
| 1/5 | 0.2 | |
| 1/4 | 0.25 | |
| 1/3 | 0.3333 | |
| **1/2** | **0.5** | **✓** |
| 2/3 | 0.6667 | |
| 3/4 | 0.75 | |

默认 1/2 与现状一致，老用户无感。

**示例**：选 1/2，首根成交价 10 元 → `100000 × 0.5 / 10 = 5000 股` → 每次 B 买 5000 股。选 1/3 → 3333 股（向下取整到 3300 股）。

**引擎改动**（`tradingEngine.ts`）：

- 移除 `evaluateManualAction` 中 `state.shares > 0` 拦截。
- buy 分支改为：`buyShares = state.fixedBuyShares`；若 `state.cash < buyShares × price + 手续费` → 返回 `{ ok: false, error: '剩余资金不足以下一手' }`。
- `TradingState` 增加 `fixedBuyShares: number` 字段。
- `avgPrice` 改为含手续费移动加权平均（详见 3.3）。
- **卖出仍全平**，保持现状（符合训练工具简化定位）。

**UI 改动**：`ActionSection.tsx:23` 移除 `accountShares > 0` 禁用条件，B 按钮始终可点（由引擎判定资金）。

**技术指标/改动量**：低。纯前端 + 引擎逻辑，不涉及 K 线指标重算。

### 3.2 仓位配置：设置面板单选档位 + 持久化（问题 2）

- `app_preferences` 复用 `workbench_settings_v1`，新增字段 `positionRatio: number`（取值 0.2 / 0.25 / 0.3333 / 0.5 / 0.6667 / 0.75）。
- 设置面板（`SessionToolbar.tsx` 的 `SettingsPanel`）新增"仓位档位"分段选择器，与现有 `regime`/`samplePoolBars` 等并列。
- Workbench 挂载时从 prefs 读取，应用到本地 state。
- **生效时机**：与现有 `samplePoolBars`/`candidateCount` 一致——下次进入会话或重新加载样本时生效（不立即改当前会话的 `fixedBuyShares`，避免训练中途变化）。

### 3.3 持仓成本：含手续费移动加权平均（问题 4）

**新公式**（买入时）：

```
新 avgPrice = (旧 shares × 旧 avgPrice + 本次买入成交额 + 本次买入手续费) / 新总股数
```

**联动修正**：

- `realizedPnl`（卖出时）= `(price - avgPrice) × sellShares - 卖出手续费`。
  - 由于 `avgPrice` 已含买入费，买入手续费不再被重复低估。
- `computeUnrealizedPnl`（浮动盈亏）= `(markPrice - avgPrice) × shares`。
  - 含费口径，与实现盈亏一致。

**影响**：

- avgPrice 略微抬高（多算买入费），实现盈亏略微抬高（买入费不再在卖出端重复扣减）。
- 这是正确的方向，符合 A 股真实成本口径。
- **历史 session 不迁移**，旧数据保留原值（仅影响新建 session）。

### 3.4 卡片新增百分比副标签（问题 3）

按"行情惯例"分母（每卡片独立选基准）：

| 卡片 | 主值 | 新增副标签 | 分母 |
|---|---|---|---|
| 净值 | accountEquity | （已有"收益率 X%"，不变） | — |
| 可用资金 | cash | `剩余 50.0%` | `cash / initialCapital` |
| 持仓 | shares | （已有"成本 X"）+ `仓位 50.0%` | `持仓市值 / (cash + 持仓市值)` |
| 浮动盈亏 | unrealizedPnl | `+2.3%`（同色） | `unrealizedPnl / (avgPrice × shares)` 即持仓成本 |
| 已实现盈亏 | realizedPnl | `+1.5%`（同色） | `realizedPnl / initialCapital` |

- 复用 `toSignedPct` formatter。
- 颜色随主值（正红/负绿，走 `.up`/`.down` class → `--color-up` 红 / `--color-down` 绿，A 股惯例）。
- 空仓时浮动盈亏副标签显示 `-`。

### 3.5 动作日志加"盈亏%"列（问题 5）

**改动范围小，无 DB 迁移**：

- 表格头加一列「盈亏%」，位置在「盈亏」右侧。
- 运行时计算：`realizedPnl / amount × 100`（卖出时 amount 是成交额，等价于盈亏/成交额）。
- 买入/持有/跳过行显示 `-`，卖出行显示带色 `+2.3%`。
- 复用 `toSignedPct` formatter。
- DB 层零改动——schema 早已预留，每条 trade_action 已写 realizedPnl 与 amount。

### 3.6 配色修正：回归 A 股涨红跌绿（问题 6）

**必改 5 处**（`ProfileManager.tsx` 趋势图方向残留）：

| 行 | 现状 | 改为 |
|---|---|---|
| 580 | `fill="#27ae60"`（maxPnl 正值标绿） | `fill="#dc2626"` |
| 581 | `fill="#e74c3c"`（minPnl 负值标红） | `fill="#16a34a"` |
| 597 | `d.pnlPct >= 0 ? '#27ae60' : '#e74c3c'` | `d.pnlPct >= 0 ? '#dc2626' : '#16a34a'` |
| 649 | `fill="#27ae60"`（日均收益最大正值标绿） | `fill="#dc2626"` |
| 650 | `fill="#e74c3c"`（日均收益最小负值标红） | `fill="#16a34a"` |

**建议统一色号**（方向正确，仅 token 一致性）：

- `BaseKlineChart.tsx:67-77` 蜡烛/last/ohlc 涨跌色：`#e74c3c` → `#dc2626`、`#27ae60` → `#16a34a`（7 处）。
- `BaseKlineChart.tsx:172, 175` 买卖标记色同步统一。
- `constants.ts:3-4, 10-11` REGIME `uptrend/downtrend` 色号统一为 token 值。

**不改**（非涨跌语义）：

- `DataManagement.css:251, 294` 数据初始化按钮绿（功能色）。
- `BaseKlineChart.tsx:133-137` exit window 蓝。
- `BaseKlineChart.tsx:204, 207` benchmark 买/卖（橙/蓝对比色）。
- `BaseKlineChart.tsx:583-584, 627, 653` 趋势主线（蓝/teal）。
- `constants.ts` `mixed/sideways/volatile`（灰/蓝/橙中性分类色）。
- `ProfileManager.tsx:59-65` `PNL_LEVELS`（已正确：亏损绿/盈利红）。
- `BlindTrainingWorkbench.css:1023` 收盘价 `#ea580c` 橙（中性强调色）。

### 3.7 文档同步（问题 7）

新增 `docs/trading-accounting-spec.md`，登记：

- 仓位：fixedBuyShares 计算公式、档位表。
- 成本：含手续费移动加权平均公式。
- 盈亏：浮动/实现盈亏公式 + 含费口径说明。
- 卡片百分比：四个分母基准表。
- 配色：A 股涨红跌绿 token 表 + 不动色清单。

并在 `docs/UI_DESIGN_SPEC.md` 2.1 节后追加交叉引用一行。

---

## 4. 影响范围

### 4.1 数据库

**零迁移**。`trade_actions` schema 已够用；`app_preferences` 复用现有表，仅新增 JSON 字段。

### 4.2 历史数据兼容

- 旧 session 的 `avgPrice`、`realizedPnl` 保留原值（不含费口径），不回算。
- 新建 session 起采用含费口径。
- `workbench_settings_v1` 旧 prefs 不含 `positionRatio`，读取时缺省为 0.5。

### 4.3 不动的部分

- K 线指标计算（KDJ/MACD/均线）不受影响。
- 卖出仍全平，不引入部分卖出（避免 scope 膨胀）。
- 现有 session 流转、样本切换、自动平仓机制不变。

---

## 5. 实施顺序（4 个 commit）

| Commit | 范畴 | 内容 |
|---|---|---|
| 1 | 引擎 + 文档 | tradingEngine.ts 加仓 + 含费加权平均 + fixedBuyShares 字段；新增 `docs/trading-accounting-spec.md`；补单元测试 |
| 2 | 配置层 | app_preferences 加 positionRatio；SettingsPanel 加档位选择器；Workbench 启动时算 fixedBuyShares |
| 3 | UI 层 | AccountOverview 4 卡片百分比副标签；ActionLog 加"盈亏%"列；LocalActionLog 透传 |
| 4 | 配色 | ProfileManager 5 处方向修正；BaseKlineChart/constants 色号统一；UI_DESIGN_SPEC 补交叉引用 |

每个 commit 后跑 `npx tsc -b --noEmit`，启动 `npm run dev` 验证。

---

## 6. 验收标准

- [ ] 持仓后再次点 B 能成功加仓，`fixedBuyShares` 与档位匹配。
- [ ] 剩余现金不足时 B 报错"剩余资金不足以下一手"，不崩溃。
- [ ] 设置面板有仓位档位选择器，刷新应用后仍生效。
- [ ] 可用资金/持仓/浮动盈亏/已实现盈亏卡片各显示百分比副标签，分母符合行情惯例。
- [ ] avgPrice 略高于成交价（含费），加仓后按加权平均更新。
- [ ] 动作日志新增"盈亏%"列，卖出行显示百分比，买入行显示 `-`。
- [ ] 训练趋势图散点：正盈亏为红、负盈亏为绿；Y 轴 max 标红、min 标绿。
- [ ] `npx tsc -b --noEmit` 通过。
- [ ] 新增/更新的文档无占位符、无内部矛盾。

---

## 7. 风险与权衡

- **不引入部分卖出**：保持训练工具简化定位，避免与"全仓/清仓"训练目标冲突。若后续需要分批卖出，可单独再做。
- **avgPrice 口径变更**：会让新建 session 的成本/盈亏数值与旧 session 略有差异，但更真实。已通过文档明示。
- **fixedBuyShares 会话级常量**：不随行情变化，符合"训练工具"语义（避免训练中途资金变化导致行为漂移）。
- **配色统一色号**：视觉差异极小（`#e74c3c` → `#dc2626` 仅饱和度微调），用户基本无感。
