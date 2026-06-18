export interface HabitIndicators {
  chase_high_rate: number
  inverse_pyramid_rate: number
  stop_loss_discipline: number
  profit_loss_ratio: number
  profit_taking_timing: number
  avg_holding_bars: number
  avg_position_ratio: number
  result_group: {
    win_rate: number
    avg_pnl_pct: number
    max_drawdown_pct: number
    max_loss_streak: number
  }
}

export interface HabitProfile {
  id: string
  profile_id: string
  computed_at: number
  session_count: number
  indicators: HabitIndicators
}

export interface TradeActionRow {
  session_id: string
  bar_index: number
  action_type: 'buy' | 'sell' | 'hold' | 'skip'
  price: number | null
  shares: number | null
  amount: number | null
  realized_pnl: number | null
  created_at: number
}

export interface SessionReviewRow {
  session_id: string
  trade_win_rate: number
  realized_pnl: number
  realized_pnl_pct: number
  max_drawdown_pct: number
  buy_count: number
  sell_count: number
  hold_count: number
  avg_holding_bars: number
  total_trades: number
  winning_trades: number
}

export interface SessionRow {
  id: string
  stock_code: string
  stock_name: string
  interval_type: string
  initial_capital: number
  realized_pnl: number | null
  status: string
  started_at: number
}

export interface HabitAnalyzerConfig {
  lookbackBars: number
  chaseHighThreshold: number
  stopLossThreshold: number
  stopLossGraceBars: number
}

export const DEFAULT_HABIT_CONFIG: HabitAnalyzerConfig = {
  lookbackBars: 5,
  chaseHighThreshold: 0.03,
  stopLossThreshold: -0.07,
  stopLossGraceBars: 5,
}

export interface AdvisorStrength {
  indicator: string
  value: string
  evidence: string
  comment: string
}

export interface AdvisorBadHabit {
  name: string
  severity: 'high' | 'medium' | 'low'
  trigger: string
  evidence_session?: string
  fix: string
}

export interface AdvisorActionItem {
  priority: number
  action: string
  rationale: string
  expected_impact?: string
}

export interface AdvisorReport {
  strengths: AdvisorStrength[]
  weaknesses: AdvisorStrength[]
  bad_habits: AdvisorBadHabit[]
  action_plan: AdvisorActionItem[]
}

export interface AiReportRecord {
  id: string
  profile_id: string
  habit_profile_id: string
  report: AdvisorReport | { fallback_text: string }
  raw_response: string | null
  model: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  duration_ms: number | null
  error: string | null
  created_at: number
}

export interface RepresentativeSession {
  stock_code: string
  stock_name: string
  interval_type: string
  realized_pnl_pct: number
  total_trades: number
  trade_win_rate: number
  actions: Array<{
    bar_index: number
    action_type: 'buy' | 'sell' | 'hold' | 'skip'
    price?: number
    shares?: number
    realized_pnl?: number
  }>
}

export interface AiAdvisorConfig {
  endpoint: string
  apiKey: string
  model: string
  ready: boolean
}
