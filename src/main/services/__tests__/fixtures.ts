import type {
  TradeActionRow,
  SessionReviewRow,
  SessionRow
} from '../../../types/agent'

let actionSeq = 0
const nextCreatedAt = () => 1_700_000_000 + actionSeq++

export const makeAction = (overrides: Partial<TradeActionRow> & {
  session_id: string
  bar_index: number
  action_type: TradeActionRow['action_type']
}): TradeActionRow => {
  actionSeq++
  return {
    price: null,
    shares: null,
    amount: null,
    realized_pnl: null,
    created_at: nextCreatedAt(),
    ...overrides,
  }
}

export const makeReview = (overrides: Partial<SessionReviewRow> & {
  session_id: string
}): SessionReviewRow => ({
  trade_win_rate: 0.5,
  realized_pnl: 0,
  realized_pnl_pct: 0,
  max_drawdown_pct: 0,
  buy_count: 1,
  sell_count: 1,
  hold_count: 0,
  avg_holding_bars: 5,
  total_trades: 1,
  winning_trades: 0,
  ...overrides,
})

export const makeSession = (overrides: Partial<SessionRow> & {
  id: string
}): SessionRow => ({
  stock_code: 'TEST001',
  stock_name: '测试股',
  interval_type: '1d',
  initial_capital: 100000,
  realized_pnl: 0,
  status: 'finished',
  started_at: 1_700_000_000,
  ...overrides,
})

export const resetFixtureSeq = () => { actionSeq = 0 }
