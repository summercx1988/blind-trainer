import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TRADING_CONFIG,
  createInitialTradingState,
  evaluateManualAction
} from '../tradingEngine'

const CONFIG = DEFAULT_TRADING_CONFIG

describe('evaluateManualAction - 固定买入金额语义', () => {
  it('每次 B 按当前价实时换算股数，amount 不超过固定买入金额', () => {
    const fixedBuyAmount = 50_000
    let state = createInitialTradingState(100_000, fixedBuyAmount)

    const buy1 = evaluateManualAction(state, 'buy', 10, CONFIG)
    expect(buy1.ok).toBe(true)
    if (!buy1.ok) return
    state = buy1.nextState
    expect(buy1.trade.amount + buy1.trade.commission).toBeLessThanOrEqual(fixedBuyAmount + 0.01)
    expect(buy1.trade.shares).toBe(4900)

    const sell = evaluateManualAction(state, 'sell', 12, CONFIG)
    expect(sell.ok).toBe(true)
    if (!sell.ok) return
    state = sell.nextState

    const buy2 = evaluateManualAction(state, 'buy', 12, CONFIG)
    expect(buy2.ok).toBe(true)
    if (!buy2.ok) return
    expect(buy2.trade.amount + buy2.trade.commission).toBeLessThanOrEqual(fixedBuyAmount + 0.01)
    expect(buy2.trade.shares).toBe(4100)
  })

  it('S 后在更高价位再次 B，不应因「固定股数 × 高价」超过 cash 而被拒绝', () => {
    const fixedBuyAmount = 50_000
    let state = createInitialTradingState(100_000, fixedBuyAmount)

    const buy1 = evaluateManualAction(state, 'buy', 10, CONFIG)
    if (!buy1.ok) return
    state = buy1.nextState

    const sell = evaluateManualAction(state, 'sell', 10, CONFIG)
    if (!sell.ok) return
    state = sell.nextState

    const buy2 = evaluateManualAction(state, 'buy', 25, CONFIG)
    expect(buy2.ok).toBe(true)
    if (!buy2.ok) return
    expect(buy2.trade.amount + buy2.trade.commission).toBeLessThanOrEqual(fixedBuyAmount + 0.01)
  })

  it('当 cash 已小于固定买入金额时，自动按当前 cash 缩减买入，仍能成交', () => {
    const fixedBuyAmount = 50_000
    let state = createInitialTradingState(30_000, fixedBuyAmount)

    expect(state.cash).toBeLessThan(fixedBuyAmount)

    const buy = evaluateManualAction(state, 'buy', 10, CONFIG)
    expect(buy.ok).toBe(true)
    if (!buy.ok) return
    expect(buy.trade.shares).toBeGreaterThan(0)
    expect(buy.trade.amount + buy.trade.commission).toBeLessThanOrEqual(state.cash + 0.01)
    state = buy.nextState
    expect(state.cash).toBeGreaterThanOrEqual(0)
  })

  it('未配置固定金额时，按当前 cash × buyBudgetRatio 自适应买入', () => {
    const state = createInitialTradingState(100_000)
    const buy = evaluateManualAction(state, 'buy', 10, CONFIG)
    expect(buy.ok).toBe(true)
    if (!buy.ok) return
    expect(buy.trade.shares).toBe(4900)
  })

  it('多轮 B/S 后再次 B，不应提示「剩余资金不足以下一手」', () => {
    const fixedBuyAmount = 50_000
    let state = createInitialTradingState(100_000, fixedBuyAmount)

    for (let i = 0; i < 3; i++) {
      const buy = evaluateManualAction(state, 'buy', 10, CONFIG)
      expect(buy.ok).toBe(true)
      if (!buy.ok) return
      state = buy.nextState

      const sell = evaluateManualAction(state, 'sell', 10, CONFIG)
      expect(sell.ok).toBe(true)
      if (!sell.ok) return
      state = sell.nextState
    }

    const finalBuy = evaluateManualAction(state, 'buy', 10, CONFIG)
    expect(finalBuy.ok).toBe(true)
  })
})
