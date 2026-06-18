import { describe, it, expect, beforeEach } from 'vitest'
import { computeHabitIndicators } from '../habit-analyzer'
import { makeAction, makeReview, makeSession, resetFixtureSeq } from './fixtures'
import { DEFAULT_HABIT_CONFIG } from '../../../types/agent'

const SID = 'sess_test'

const baseSession = () => makeSession({ id: SID, initial_capital: 100000 })

describe('computeHabitIndicators - chase_high_rate', () => {
  beforeEach(resetFixtureSeq)

  it('返回 0.5 当 2 笔 buy 中 1 笔追高（price >= 前序 buy max * 1.03）', () => {
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10 }),
      makeAction({ session_id: SID, bar_index: 2, action_type: 'buy', price: 10.5 }),
      makeAction({ session_id: SID, bar_index: 3, action_type: 'sell', price: 11, realized_pnl: 100 }),
    ]
    const result = computeHabitIndicators(
      actions,
      [makeReview({ session_id: SID })],
      [baseSession()],
      DEFAULT_HABIT_CONFIG
    )
    expect(result.chase_high_rate).toBeCloseTo(0.5, 5)
  })

  it('返回 0 当没有 buy', () => {
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'hold' }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    expect(result.chase_high_rate).toBe(0)
  })
})

describe('computeHabitIndicators - inverse_pyramid_rate', () => {
  beforeEach(resetFixtureSeq)

  it('返回 1.0 当所有多笔 buy 的 session 都是递增加仓', () => {
    const actions = [
      makeAction({ session_id: 's1', bar_index: 1, action_type: 'buy', price: 10 }),
      makeAction({ session_id: 's1', bar_index: 2, action_type: 'buy', price: 12 }),
      makeAction({ session_id: 's2', bar_index: 1, action_type: 'buy', price: 20 }),
      makeAction({ session_id: 's2', bar_index: 2, action_type: 'buy', price: 25 }),
    ]
    const result = computeHabitIndicators(
      actions,
      [makeReview({ session_id: 's1' }), makeReview({ session_id: 's2' })],
      [makeSession({ id: 's1' }), makeSession({ id: 's2' })],
      DEFAULT_HABIT_CONFIG
    )
    expect(result.inverse_pyramid_rate).toBe(1)
  })

  it('不计入只有单笔 buy 的 session', () => {
    const actions = [
      makeAction({ session_id: 's1', bar_index: 1, action_type: 'buy', price: 10 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: 's1' })], [makeSession({ id: 's1' })], DEFAULT_HABIT_CONFIG)
    expect(result.inverse_pyramid_rate).toBe(0)
  })
})

describe('computeHabitIndicators - profit_loss_ratio & profit_taking_timing', () => {
  beforeEach(resetFixtureSeq)

  it('盈亏比 = avg(盈利单) / abs(avg(亏损单))', () => {
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'sell', price: 11, realized_pnl: 200 }),
      makeAction({ session_id: SID, bar_index: 2, action_type: 'sell', price: 9, realized_pnl: -100 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    expect(result.profit_loss_ratio).toBeCloseTo(2, 5)
  })

  it('止盈过早 = 盈利单持仓 < 亏损单持仓 时比值 < 0.8', () => {
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10 }),
      makeAction({ session_id: SID, bar_index: 2, action_type: 'sell', price: 11, realized_pnl: 100 }),
      makeAction({ session_id: SID, bar_index: 3, action_type: 'buy', price: 10 }),
      makeAction({ session_id: SID, bar_index: 8, action_type: 'sell', price: 9, realized_pnl: -100 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    expect(result.profit_taking_timing).toBeCloseTo(0.2, 5)
  })

  it('无平仓交易时盈亏比为 0', () => {
    const actions = [makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10 })]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    expect(result.profit_loss_ratio).toBe(0)
  })
})

describe('computeHabitIndicators - stop_loss_discipline & avg_position_ratio', () => {
  beforeEach(resetFixtureSeq)

  it('止损纪律 = 已止损 / 应止损（浮亏达阈值后 grace bars 内卖出）', () => {
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10, shares: 100, amount: 1000 }),
      makeAction({ session_id: SID, bar_index: 4, action_type: 'sell', price: 9.3, shares: 100, realized_pnl: -70 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    expect(result.stop_loss_discipline).toBe(1)
  })

  it('avg_position_ratio = buy amount / 初始资金的中位数', () => {
    const actions = [
      makeAction({ session_id: SID, bar_index: 1, action_type: 'buy', price: 10, shares: 1000, amount: 10000 }),
      makeAction({ session_id: SID, bar_index: 2, action_type: 'buy', price: 10, shares: 2000, amount: 20000 }),
    ]
    const result = computeHabitIndicators(actions, [makeReview({ session_id: SID })], [baseSession()], DEFAULT_HABIT_CONFIG)
    expect(result.avg_position_ratio).toBeCloseTo(0.15, 5)
  })
})

describe('computeHabitIndicators - result_group & avg_holding_bars', () => {
  beforeEach(resetFixtureSeq)

  it('result_group 聚合 reviews 并算连损场次', () => {
    const reviews = [
      makeReview({ session_id: 's1', trade_win_rate: 0.6, realized_pnl_pct: 0.05, max_drawdown_pct: 0.1 }),
      makeReview({ session_id: 's2', trade_win_rate: 0.4, realized_pnl_pct: -0.03, max_drawdown_pct: 0.2 }),
    ]
    const sessions = [
      makeSession({ id: 's1', realized_pnl: 100, started_at: 1 }),
      makeSession({ id: 's2', realized_pnl: -50, started_at: 2 }),
      makeSession({ id: 's3', realized_pnl: -30, started_at: 3 }),
    ]
    const result = computeHabitIndicators([], reviews, sessions, DEFAULT_HABIT_CONFIG)
    expect(result.result_group.win_rate).toBeCloseTo(0.5, 5)
    expect(result.result_group.avg_pnl_pct).toBeCloseTo(0.01, 5)
    expect(result.result_group.max_drawdown_pct).toBeCloseTo(0.2, 5)
    expect(result.result_group.max_loss_streak).toBe(2)
  })
})
