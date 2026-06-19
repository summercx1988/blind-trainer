import { describe, it, expect } from 'vitest'
import { calculateSessionReviewMetrics } from './sessionReview'

describe('calculateSessionReviewMetrics', () => {
  it('空 actions 返回全零指标', () => {
    const m = calculateSessionReviewMetrics([], 100000, 100000, '1d')
    expect(m.buyCount).toBe(0)
    expect(m.sellCount).toBe(0)
    expect(m.totalTrades).toBe(0)
    expect(m.realizedPnl).toBe(0)
    expect(m.tradeWinRate).toBe(0)
    expect(m.avgHoldingBars).toBe(0)
    expect(m.winHoldEfficiency).toBe(0)
  })

  it('单笔盈利交易：胜率 100%、realizedPnl 取自 sell、持仓天数按 interval 折算', () => {
    const actions = [
      { action_type: 'buy', bar_index: 0, shares: 100, price: 10, realized_pnl: null },
      { action_type: 'sell', bar_index: 5, shares: 100, price: 15, realized_pnl: 500 },
    ]
    const m = calculateSessionReviewMetrics(actions, 100000, 100500, '1d')
    expect(m.buyCount).toBe(1)
    expect(m.sellCount).toBe(1)
    expect(m.totalTrades).toBe(2)
    expect(m.winningTrades).toBe(1)
    expect(m.tradeWinRate).toBe(1)
    expect(m.realizedPnl).toBe(500)
    expect(m.realizedPnlPct).toBeCloseTo(0.5, 5)
    expect(m.avgHoldingBars).toBe(5)
    expect(m.avgHoldingDays).toBe(5)
    expect(m.maxDrawdownPct).toBe(0)
  })

  it('单笔亏损交易计为非胜率', () => {
    const actions = [
      { action_type: 'buy', bar_index: 0, shares: 100, price: 10 },
      { action_type: 'sell', bar_index: 3, shares: 100, price: 8, realized_pnl: -200 },
    ]
    const m = calculateSessionReviewMetrics(actions, 100000, 99800, '1d')
    expect(m.winningTrades).toBe(0)
    expect(m.tradeWinRate).toBe(0)
    expect(m.realizedPnl).toBe(-200)
  })

  it('15m 周期：16 根 = 1 个交易日', () => {
    const actions = [
      { action_type: 'buy', bar_index: 0, shares: 100, price: 10 },
      { action_type: 'sell', bar_index: 16, shares: 100, price: 11, realized_pnl: 100 },
    ]
    const m = calculateSessionReviewMetrics(actions, 100000, 100100, '15m')
    expect(m.avgHoldingBars).toBe(16)
    expect(m.avgHoldingDays).toBe(1)
  })

  it('5m 周期：48 根 = 1 个交易日', () => {
    const actions = [
      { action_type: 'buy', bar_index: 0, shares: 100, price: 10 },
      { action_type: 'sell', bar_index: 48, shares: 100, price: 11, realized_pnl: 100 },
    ]
    const m = calculateSessionReviewMetrics(actions, 100000, 100100, '5m')
    expect(m.avgHoldingDays).toBe(1)
  })

  it('hold 动作计入 holdCount 但不计入交易胜率', () => {
    const actions = [
      { action_type: 'hold', bar_index: 1 },
      { action_type: 'buy', bar_index: 2, shares: 100, price: 10 },
      { action_type: 'sell', bar_index: 4, shares: 100, price: 12, realized_pnl: 200 },
    ]
    const m = calculateSessionReviewMetrics(actions, 100000, 100200, '1d')
    expect(m.holdCount).toBe(1)
    expect(m.tradeWinRate).toBe(1)
  })

  it('按 bar_index 排序后再计算（乱序输入不影响结果）', () => {
    const actions = [
      { action_type: 'sell', bar_index: 5, shares: 100, price: 15, realized_pnl: 500 },
      { action_type: 'buy', bar_index: 0, shares: 100, price: 10 },
    ]
    const m = calculateSessionReviewMetrics(actions, 100000, 100500, '1d')
    expect(m.avgHoldingBars).toBe(5)
    expect(m.realizedPnl).toBe(500)
  })

  it('max_drawdown_pct 被钳制在 [0,100]', () => {
    const actions = [
      { action_type: 'buy', bar_index: 0, shares: 100, price: 10 },
      { action_type: 'sell', bar_index: 5, shares: 100, price: 5, realized_pnl: -50000 },
    ]
    const m = calculateSessionReviewMetrics(actions, 100000, 50000, '1d')
    expect(m.maxDrawdownPct).toBeGreaterThanOrEqual(0)
    expect(m.maxDrawdownPct).toBeLessThanOrEqual(100)
  })
})
