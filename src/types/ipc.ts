export interface DbStatistics {
  totalSessions: number
  totalLabels: number
  winRate: number
}

export interface SaveSessionInput {
  id?: string
  sampleId: string
  stockCode: string
  stockName: string
  intervalType: string
  startedAt: number
  initialCapital: number
  profileId?: string
}

export interface SaveSessionResult extends SaveSessionInput {
  id: string
}

export interface FinishSessionContext {
  profileId?: string
  sampleId?: string
  stockCode?: string
  stockName?: string
  intervalType?: string
  startedAt?: number
  initialCapital?: number
}

export interface SessionSummary {
  id: string
  sample_id: string
  stock_code: string
  stock_name: string
  interval_type: string
  started_at: number
  finished_at: number | null
  status: string
  profile_id?: string | null
  initial_capital: number
  final_capital: number | null
  realized_pnl: number | null
  total_trades: number
  winning_trades: number
  trade_win_rate?: number | null
  realized_pnl_pct?: number | null
  max_drawdown_pct?: number | null
  buy_count?: number | null
  sell_count?: number | null
  hold_count?: number | null
  avg_holding_bars?: number | null
  avg_holding_days?: number | null
  avg_daily_return_pct?: number | null
  win_hold_efficiency?: number | null
}

export interface SessionReview {
  id: string
  session_id: string
  trade_win_rate: number
  realized_pnl: number
  realized_pnl_pct: number
  max_drawdown_pct: number
  buy_count: number
  sell_count: number
  hold_count: number
  avg_holding_bars: number
  avg_holding_days: number
  avg_daily_return_pct: number
  win_hold_efficiency: number
  total_trades: number
  winning_trades: number
  created_at: number
  updated_at: number
}

export interface SessionActionRecord {
  id: string
  session_id: string
  bar_index: number
  action_type: 'buy' | 'sell' | 'hold' | 'skip'
  price: number | null
  shares: number | null
  amount: number | null
  commission: number | null
  realized_pnl: number | null
  source: string | null
  created_at: number
}

export interface SaveTradeActionInput {
  sessionId: string
  barIndex: number
  actionType: 'buy' | 'sell' | 'hold' | 'skip'
  price?: number
  shares?: number
  amount?: number
  commission?: number
  realizedPnl?: number
  source?: string
  strategyId?: string
}

export interface SaveTradeActionResult extends SaveTradeActionInput {
  id: string
}

export interface SaveLabelInput {
  sessionId: string
  barIndex: number
  labelType: 'buy' | 'sell' | 'hold' | 'no_action'
  source: string
  strategyId?: string
  confidence?: number
  userConfidence?: number
  status?: 'proposed' | 'accepted' | 'rejected' | 'modified'
  reason?: string
  note?: string
}

export interface SaveLabelResult extends SaveLabelInput {
  id: string
  createdAt: number
}

export interface DataStats {
  stockCount: number
  dailyCount: number
  m15Count: number
  m5Count: number
  dailyCoverage?: number
  m15Coverage?: number
  m5Coverage?: number
}

export type UnknownRecord = Record<string, unknown>

export interface PlatformError {
  message: string
  details?: UnknownRecord
}

export interface PlatformSuccess<T> {
  success: true
  data: T
  error: null
  code: null
  meta?: UnknownRecord
}

export interface PlatformFailure {
  success: false
  data: null
  error: PlatformError
  code: string
  meta?: UnknownRecord
}

export type PlatformResult<T> = PlatformSuccess<T> | PlatformFailure

export interface DataInitData {
  stockList: UnknownRecord | null
  dailySynced: number
  dailyFailed: number
}

export interface DataSyncData {
  syncedFromApi: number
  syncedFromCache: number
  syncedEmpty: number
  totalResults: number
  autoSignalScan: UnknownRecord | null
  coverage: UnknownRecord | null
  syncAdvice: string[]
}

export interface DataBackfillData {
  codesProcessed: number
}

export interface CoverageIntervalSummary {
  interval: '1d' | '15m' | '5m'
  missingCodes: string[]
  staleCodes: string[]
  totalMissing: number
  totalStale: number
  sampleMissing: string[]
  sampleStale: string[]
}

export interface MissingCoverageData {
  scannedAt: string
  stockCount: number
  latestTradingDate: string | null
  latestMinuteCutoff: string | null
  intervals: Record<'1d' | '15m' | '5m', CoverageIntervalSummary>
}

export interface BackfillExecutionItem {
  requested: number
  processed: number
  failed: number
  interval: '1d' | '15m' | '5m'
  insertedRows: number
  codes: string[]
}

export interface BackfillExecutionData {
  execution: {
    daily: BackfillExecutionItem
    m15: BackfillExecutionItem
    m5: BackfillExecutionItem
  }
  stats: DataStats
  coverage: MissingCoverageData
}

export interface LabelStatusUpdateData {
  labelId: string
  status: string
  userConfidence?: number
}

export interface SessionFinishData {
  sessionId: string
  finishedAt: number
  finalCapital: number
  realizedPnl: number
}

export interface ProfileDeleteData {
  profileId: string
}

export interface TrainingProfileRecord {
  id: string
  name: string
  initial_capital: number
  current_capital: number
  total_sessions: number
  total_pnl: number
  total_wins: number
  total_losses: number
  total_duration_seconds: number
  total_holding_days: number
  total_trades_count: number
  total_winning_trades: number
  avg_session_return_pct: number
  best_session_return_pct: number
  worst_session_return_pct: number
  max_drawdown_pct: number
  is_active: number
  created_at: number
  updated_at: number
}

export interface ProfileStatsSessionTrendPoint {
  date: number
  pnlPct: number
}

export interface ProfileStatsDailyStat {
  day: string
  count: number
  avgPnlPct: number
  totalPnl: number
  avgWinRatePct: number
  avgDailyReturnPct: number
}

export interface ProfileStats {
  profile: TrainingProfileRecord
  sessionTrend: ProfileStatsSessionTrendPoint[]
  dailyStats: ProfileStatsDailyStat[]
}

export function getPlatformErrorMessage(result: PlatformResult<unknown> | undefined, fallback = '操作失败'): string {
  if (!result || result.success !== false) return fallback
  return result.error?.message || fallback
}
