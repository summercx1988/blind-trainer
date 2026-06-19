import { describe, it, expect } from 'vitest'
import { normalizeIndicators } from '../normalizeIndicators'
import type { HabitIndicators } from '../../../../types/agent'

const mk = (overrides: Partial<HabitIndicators> = {}): HabitIndicators => ({
  chase_high_rate: 0.4,
  inverse_pyramid_rate: 0.3,
  stop_loss_discipline: 0.7,
  profit_loss_ratio: 1.5,
  profit_taking_timing: 1.0,
  avg_holding_bars: 5,
  avg_position_ratio: 0.3,
  result_group: { win_rate: 0.5, avg_pnl_pct: 0, max_drawdown_pct: 0, max_loss_streak: 0 },
  ...overrides,
})

describe('normalizeIndicators', () => {
  it('返回 8 个 0..1 的健康度值', () => {
    const r = normalizeIndicators(mk())
    expect(r).toHaveLength(8)
    for (const v of r) {
      expect(v.value).toBeGreaterThanOrEqual(0)
      expect(v.value).toBeLessThanOrEqual(1)
    }
  })

  it('追涨率越低健康度越高', () => {
    const high = normalizeIndicators(mk({ chase_high_rate: 0.8 }))
    const low = normalizeIndicators(mk({ chase_high_rate: 0.1 }))
    expect(low[0].value).toBeGreaterThan(high[0].value)
    expect(low[0].value).toBeCloseTo(0.9, 5)
  })

  it('盈亏比 2 视为满分 1.0', () => {
    const r = normalizeIndicators(mk({ profit_loss_ratio: 2 }))
    const item = r.find(i => i.key === 'profit_loss_ratio')!
    expect(item.value).toBe(1)
  })

  it('持仓节奏 5 bars 最佳（健康度 1.0）', () => {
    const r = normalizeIndicators(mk({ avg_holding_bars: 5 }))
    const item = r.find(i => i.key === 'avg_holding_bars')!
    expect(item.value).toBe(1)
  })

  it('持仓节奏 20+ bars 健康度接近 0', () => {
    const r = normalizeIndicators(mk({ avg_holding_bars: 25 }))
    const item = r.find(i => i.key === 'avg_holding_bars')!
    expect(item.value).toBeLessThanOrEqual(0.05)
  })

  it('止盈时机 1.3+ 满分，0.5 最差', () => {
    const best = normalizeIndicators(mk({ profit_taking_timing: 1.3 }))
    const worst = normalizeIndicators(mk({ profit_taking_timing: 0.5 }))
    expect(best.find(i => i.key === 'profit_taking_timing')!.value).toBe(1)
    expect(worst.find(i => i.key === 'profit_taking_timing')!.value).toBe(0)
  })

  it('每项含 label 与原始值字符串', () => {
    const r = normalizeIndicators(mk({ chase_high_rate: 0.42 }))
    expect(r[0].label).toBe('追涨率')
    expect(r[0].raw).toBe('42%')
  })
})
