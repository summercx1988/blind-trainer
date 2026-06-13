export type PeriodType = '5m' | '15m' | '1d'
export type SessionStatus = 'idle' | 'running' | 'finished'

export type RegimeType = 'uptrend' | 'downtrend' | 'sideways' | 'volatile' | 'mixed' | 'fallback'

export interface ContinuousStats {
  sessionsCompleted: number
  totalPnl: number
  wins: number
  losses: number
  currentStreak: number
  streakType: 'win' | 'loss' | 'none'
  bestStreak: number
}

export type ManualActionType = 'buy' | 'sell' | 'hold' | 'skip'
export type ActionType = ManualActionType | 'finish'
export type ExecutionMode = 'close' | 'next_open'

export type TradeReason =
  | 'breakout'
  | 'trend_follow'
  | 'support_resistance'
  | 'volume_surge'
  | 'stop_loss'
  | 'take_profit'
  | 'impulse'
  | 'other'

export const TRADE_REASON_OPTIONS: { value: TradeReason; label: string }[] = [
  { value: 'breakout', label: '技术突破' },
  { value: 'trend_follow', label: '趋势跟踪' },
  { value: 'support_resistance', label: '支撑/阻力' },
  { value: 'volume_surge', label: '放量信号' },
  { value: 'stop_loss', label: '止损' },
  { value: 'take_profit', label: '止盈' },
  { value: 'impulse', label: '情绪冲动' },
  { value: 'other', label: '其他' }
]

export interface KlineBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TrainingSample {
  id: string
  code: string
  name: string
  regime: string
  period: string
  warmupBars: number
  forwardBars: number
  actualDate: string
  totalAvailableBars?: number
  klines: KlineBar[]
}

export interface LocalActionLog {
  id: string
  barIndex: number
  actionType: ActionType
  price: number
  shares: number
  amount: number
  realizedPnl: number
  reason?: TradeReason
}

export interface TradingState {
  cash: number
  shares: number
  avgPrice: number
  realizedPnl: number
}
