import { describe, it, expect } from 'vitest'
import { buildMessages, parseReportResponse, selectRepresentativeSessions } from '../ai-advisor'
import type { HabitProfile, RepresentativeSession, TradeActionRow } from '../../../types/agent'

const makeHabitProfile = (): HabitProfile => ({
  id: 'hp1',
  profile_id: 'default',
  computed_at: 1_700_000_000,
  session_count: 10,
  indicators: {
    chase_high_rate: 0.42,
    inverse_pyramid_rate: 0.3,
    stop_loss_discipline: 0.78,
    profit_loss_ratio: 1.8,
    profit_taking_timing: 0.7,
    avg_holding_bars: 7,
    avg_position_ratio: 0.35,
    result_group: { win_rate: 0.62, avg_pnl_pct: 5.2, max_drawdown_pct: 18, max_loss_streak: 3 },
  },
})

describe('buildMessages', () => {
  it('返回 system + user 两条消息，user 含 HabitProfile JSON', () => {
    const profile = makeHabitProfile()
    const sessions: RepresentativeSession[] = [{
      sessionId: 's_test',
      stock_code: '600029', stock_name: '中远海控', interval_type: '1d',
      realized_pnl_pct: -7, total_trades: 5, trade_win_rate: 0.4,
      actions: [{ bar_index: 12, action_type: 'buy', price: 10.5 }],
    }]
    const msgs = buildMessages(profile, sessions)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
    expect(msgs[1].content).toContain('chase_high_rate')
    expect(msgs[1].content).toContain('600029')
  })

  it('system prompt 要求严格 JSON 输出', () => {
    const msgs = buildMessages(makeHabitProfile(), [])
    expect(msgs[0].content).toContain('JSON')
  })
})

describe('parseReportResponse', () => {
  it('合法 JSON 直接解析', () => {
    const content = JSON.stringify({
      strengths: [{ indicator: '盈亏比', value: '1.8', evidence: 'x', comment: 'y' }],
      weaknesses: [],
      bad_habits: [],
      action_plan: [],
    })
    const { report, error } = parseReportResponse(content)
    expect(error).toBeNull()
    expect((report as { strengths: unknown[] }).strengths).toHaveLength(1)
  })

  it('markdown 代码块包裹的 JSON 仍能解析', () => {
    const content = '```json\n{"strengths":[],"weaknesses":[],"bad_habits":[],"action_plan":[]}\n```'
    const { report, error } = parseReportResponse(content)
    expect(error).toBeNull()
    expect((report as { strengths: unknown[] }).strengths).toHaveLength(0)
  })

  it('完全无法解析时降级为 fallback_text', () => {
    const content = '这不是 JSON，是模型胡言乱语'
    const { report, error } = parseReportResponse(content)
    expect(error).toBe('json_parse_failed')
    expect((report as { fallback_text: string }).fallback_text).toBe(content)
  })
})

describe('selectRepresentativeSessions', () => {
  it('返回 1 盈 + 2 亏（按 realized_pnl_pct）', () => {
    const sessions = [
      { id: 's1', stock_code: 'A', stock_name: '盈最多', interval_type: '1d', realized_pnl: 500, status: 'finished' },
      { id: 's2', stock_code: 'B', stock_name: '亏1', interval_type: '1d', realized_pnl: -100, status: 'finished' },
      { id: 's3', stock_code: 'C', stock_name: '亏2', interval_type: '1d', realized_pnl: -300, status: 'finished' },
      { id: 's4', stock_code: 'D', stock_name: '亏3更小', interval_type: '1d', realized_pnl: -50, status: 'finished' },
    ]
    const actions: TradeActionRow[] = [
      { session_id: 's1', bar_index: 1, action_type: 'buy', price: 10, shares: 100, amount: 1000, realized_pnl: null, created_at: 1 },
    ]
    const reviews = [
      { session_id: 's1', realized_pnl_pct: 5, total_trades: 2, trade_win_rate: 0.5 },
      { session_id: 's2', realized_pnl_pct: -1, total_trades: 2, trade_win_rate: 0.5 },
      { session_id: 's3', realized_pnl_pct: -3, total_trades: 2, trade_win_rate: 0.5 },
      { session_id: 's4', realized_pnl_pct: -0.5, total_trades: 2, trade_win_rate: 0.5 },
    ]
    const result = selectRepresentativeSessions(sessions, actions, reviews)
    expect(result).toHaveLength(3)
    const names = result.map(r => r.stock_name)
    expect(names).toContain('盈最多')
    expect(names).toContain('亏2')
    expect(names).toContain('亏1')
    expect(result.every(r => typeof r.sessionId === 'string')).toBe(true)
  })

  it('跳过未结束的 session', () => {
    const sessions = [
      { id: 's1', stock_code: 'A', stock_name: 'X', interval_type: '1d', realized_pnl: 100, status: 'active' },
    ]
    const result = selectRepresentativeSessions(sessions, [], [])
    expect(result).toHaveLength(0)
  })
})
