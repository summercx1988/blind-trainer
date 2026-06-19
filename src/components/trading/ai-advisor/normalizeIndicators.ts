import type { HabitIndicators } from '../../../types/agent'

export interface NormalizedDimension {
  key: string
  label: string
  value: number
  raw: string
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const pct = (n: number) => `${Math.round(n * 100)}%`

export function normalizeIndicators(ind: HabitIndicators): NormalizedDimension[] {
  return [
    { key: 'chase_high_rate', label: '追涨率', value: clamp01(1 - ind.chase_high_rate), raw: pct(ind.chase_high_rate) },
    { key: 'inverse_pyramid_rate', label: '倒金字塔', value: clamp01(1 - ind.inverse_pyramid_rate), raw: pct(ind.inverse_pyramid_rate) },
    { key: 'stop_loss_discipline', label: '止损纪律', value: clamp01(ind.stop_loss_discipline), raw: pct(ind.stop_loss_discipline) },
    { key: 'profit_loss_ratio', label: '盈亏比', value: clamp01(ind.profit_loss_ratio / 2), raw: ind.profit_loss_ratio.toFixed(2) },
    { key: 'profit_taking_timing', label: '止盈时机', value: clamp01((ind.profit_taking_timing - 0.5) / 0.8), raw: ind.profit_taking_timing.toFixed(2) },
    { key: 'avg_holding_bars', label: '持仓节奏', value: clamp01(1 - Math.abs(ind.avg_holding_bars - 5) / 15), raw: ind.avg_holding_bars.toFixed(1) },
    { key: 'avg_position_ratio', label: '仓位控制', value: clamp01(1 - ind.avg_position_ratio), raw: pct(ind.avg_position_ratio) },
    { key: 'win_rate', label: '综合胜率', value: clamp01(ind.result_group.win_rate), raw: pct(ind.result_group.win_rate) },
  ]
}
