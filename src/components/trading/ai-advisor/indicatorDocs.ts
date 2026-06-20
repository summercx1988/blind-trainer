/**
 * 习惯指标定义 (12 个) — 单一数据源。
 *
 * 每个 entry 含:
 *  - key: 唯一标识, 用于在 HabitIndicators 中取数
 *  - label: 中文标签 (短)
 *  - group: 行为 / 收益 / 节奏 / 结果 (4 分类, 决定排序与视觉分组)
 *  - tip: hover/focus 时显示的算法说明 (2-3 行短文)
 *  - tone: 可选 — 'positive' / 'negative' / 'neutral', 决定数值颜色 (高好/低好)
 *  - format: 'pct' | 'num' | 'int', 决定显示格式
 *
 * 计算公式的最终来源: src/main/services/habit-analyzer.ts
 * 修改前请先在那里更新, 再同步本文档的 tip 字段。
 */

export type IndicatorTone = 'positive-high' | 'positive-low' | 'neutral'

export interface IndicatorEntry {
  key: string
  label: string
  group: '行为' | '收益' | '节奏' | '结果'
  format: 'pct' | 'num' | 'int'
  tone: IndicatorTone
  tip: string
}

export const INDICATOR_DOCS: IndicatorEntry[] = [
  // === 行为 (3) — 反映交易习惯是否合规 ===
  {
    key: 'chase_high_rate',
    label: '追涨率',
    group: '行为',
    format: 'pct',
    tone: 'positive-low',
    tip: '一笔 buy 视为"追高"，当其价格 ≥ 同 session 此前所有 buy 价格的 max × (1 + 阈值)。\n值 = 追高买入笔数 / 总买入笔数。\n数值越低越好。'
  },
  {
    key: 'inverse_pyramid_rate',
    label: '倒金字塔加仓率',
    group: '行为',
    format: 'pct',
    tone: 'positive-low',
    tip: '一个 session 视为"倒金字塔"，当其存在后续 buy 价格高于首笔 buy 价格。\n值 = 倒金字塔 session 数 / 有多笔 buy 的 session 数。\n数值越低越好（加仓应摊低成本，而非抬高均价）。'
  },
  {
    key: 'stop_loss_discipline',
    label: '止损纪律',
    group: '行为',
    format: 'pct',
    tone: 'positive-high',
    tip: '每笔 buy-sell 配对，若亏损幅度 ≤ 止损阈值视为"应止损"；若 sell 在 buy 后止损宽限 bar 内 → "已止损"。\n值 = 已止损笔数 / 应止损笔数。\n数值越高越好。'
  },

  // === 收益 (2) — 单笔盈亏结构 ===
  {
    key: 'profit_loss_ratio',
    label: '盈亏比',
    group: '收益',
    format: 'num',
    tone: 'positive-high',
    tip: 'avg(盈利单 realized_pnl) / abs(avg(亏损单 realized_pnl))。\n> 1.5 为合格；> 2 为优秀。\n结合胜率评估：低胜率高盈亏比 vs 高胜率低盈亏比。'
  },
  {
    key: 'profit_taking_timing',
    label: '止盈过早/过晚比',
    group: '收益',
    format: 'num',
    tone: 'positive-high',
    tip: '盈利单平均持仓 bars / 亏损单平均持仓 bars。\n< 0.8 = 赚一点就跑（过早）；> 1.3 = 拿得住盈利（过晚也可能）。\n理想区间 0.9 - 1.2。'
  },

  // === 节奏 (2) — 持仓与仓位 ===
  {
    key: 'avg_holding_bars',
    label: '平均持仓 bars',
    group: '节奏',
    format: 'num',
    tone: 'neutral',
    tip: '每场 session 的 avg_holding_bars 算术平均。\nA 股日线训练建议 3-10 bars（一周到两个月）。\n数字仅作参考，结合你的策略类型（短线/波段/趋势）。'
  },
  {
    key: 'avg_position_ratio',
    label: '单笔仓位占比中位数',
    group: '节奏',
    format: 'pct',
    tone: 'neutral',
    tip: '每笔 buy 的金额 / 该 session initial_capital，取中位数。\n保守 5-10%；标准 15-25%；激进 > 30%。\n连续多笔加仓时，单笔占比过高会快速放大回撤。'
  },

  // === 结果 (4) — 整体业绩 ===
  {
    key: 'win_rate',
    label: '胜率',
    group: '结果',
    format: 'pct',
    tone: 'positive-high',
    tip: '每场 session 的 trade_win_rate 算术平均。\n胜率独立看意义有限，需结合盈亏比：\n50% 胜 + 2.0 盈亏比 = 健康；\n70% 胜 + 0.8 盈亏比 = 隐性亏损。'
  },
  {
    key: 'avg_pnl_pct',
    label: '平均盈亏',
    group: '结果',
    format: 'pct',
    tone: 'positive-high',
    tip: '每场 session 的 realized_pnl_pct 算术平均。\n单位为百分比（如 1.5% 表示平均每场赚 1.5% 初始资金）。\n盲训复利假设：年化 ≈ 平均盈亏 × 训练场次 / 训练周期。'
  },
  {
    key: 'max_drawdown_pct',
    label: '最大回撤',
    group: '结果',
    format: 'pct',
    tone: 'positive-low',
    tip: '每场 session 的 max_drawdown_pct 取最大值。\n反映你在单场 session 中承受的最大浮亏。\n< 5% 保守；5-15% 标准；> 20% 风险偏高。'
  },
  {
    key: 'max_loss_streak',
    label: '连损场次',
    group: '结果',
    format: 'int',
    tone: 'positive-low',
    tip: '按 started_at 排序，所有 session 中 realized_pnl < 0 的最长连续场数。\n心理与资金管理信号：连损 3 场以上建议暂停复盘。\n不必然意味着策略失效——可能是样本分布问题。'
  }
]
