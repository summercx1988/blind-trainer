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

export interface DatasetLabelInspectRecord {
  bar_timestamp: number
  feature_date: string
  entry_date: string
  d1_date: string
  exit_date: string
  entry_price: number
  exit_price: number
  return_pct: number
  max_return_pct: number
  gap_return_pct: number
  d1_open: number
  d1_high: number
  d1_low: number
  d1_close: number
  d2_open: number
  d2_high: number
  d2_low: number
  d2_close: number
  stored_label: number | null
  stored_label_type: string
  return_label: number | null
  max_return_label: number | null
  label_alignment: 'aligned' | 'max_only' | 'return_only' | 'mismatch' | 'threshold_unknown'
}

export interface DatasetLabelInspectSummary {
  sample_count: number
  positive_count: number
  negative_count: number
  positive_rate: number
  avg_return_pct: number
  avg_max_return_pct: number
  avg_gap_return_pct: number
  return_positive_count: number
  max_only_candidate_count: number
  stored_vs_return_mismatch_count: number
  stored_vs_max_mismatch_count: number
}

export interface DatasetLabelInspectResult {
  success: true
  dataset_id: string
  dataset_name: string
  dataset_status: string
  dataset_description: string
  code: string
  stock_name?: string | null
  threshold_pct?: number | null
  label_method?: 'exit_return' | 'max_return' | null
  summary: DatasetLabelInspectSummary
  records: DatasetLabelInspectRecord[]
}

export interface DatasetLabelInspectFailure {
  success: false
  error: string
  stderr?: string
  stdout?: string
}

export type DatasetLabelInspectResponse = DatasetLabelInspectResult | DatasetLabelInspectFailure

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

export interface TaskTriggerData {
  taskId: string
  task: UnknownRecord | null
}

export interface ModelTrainingTriggerData extends TaskTriggerData {
  modelId: string
  model: UnknownRecord | null
}

export interface LabelGenerationData {
  output: UnknownRecord | null
  stdout: string
}

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

export interface DatasetPolicyPreviewData {
  preview: UnknownRecord
}

export interface DatasetFreezeData {
  datasetId: string
  dataset: UnknownRecord | null
}

export interface DatasetDeleteData {
  datasetId: string
  datasetName: string
  deletedItems: number
}

export interface DatasetCompareData {
  comparison: UnknownRecord
}

export interface DatasetRollbackData {
  sourceDatasetId: string
  dataset: UnknownRecord | null
  importedCount: number
}

export interface DatasetMergeData {
  dataset: UnknownRecord | null
  importedCount: number
  conflictBarCount: number
  recommendedPolicy: string
}

export interface LabelingTaskTriggerData {
  taskId: string
  status: string
}

export interface SignalInferenceRunData {
  modelId: string
  deduplicated: boolean
  event: UnknownRecord | null
}

export interface LabelStatusUpdateData {
  labelId: string
  status: string
  userConfidence?: number
}

export interface LabelingTaskTriggerData {
  taskId: string
  labeler: string
  status: string
}

export interface LabelReviewData {
  labelId: string
  status: string
}

export interface EnsembleRunData {
  result: UnknownRecord | null
}

export interface LivePredictionData {
  prediction: UnknownRecord | null
}

export interface BatchPredictionData {
  predictions: UnknownRecord | null
}

export interface SeriesPredictionData {
  signals: UnknownRecord | null
}

export interface PredictionSettings {
  autoRefreshEnabled: boolean
  autoRefreshIntervalSec: number
  freshnessThresholdMinutes: {
    '5m': number
    '15m': number
    '1d': number
  }
}

export interface PredictionSettingsData {
  settings: PredictionSettings
}

export interface OutcomeGatePeriodSettings {
  horizonBars: number
  minFutureBars: number
  buyMinMaxReturnPct: number
  buyMinExitReturnPct: number
  buyMaxDrawdownPct: number
  buyMinRiskReward: number
  sellMinDropPct: number
  sellMaxBouncePct: number
  sellMinRiskReward: number
}

export interface OutcomeGateSettings {
  '5m': OutcomeGatePeriodSettings
  '15m': OutcomeGatePeriodSettings
  '1d': OutcomeGatePeriodSettings
}

export interface OutcomeGateSettingsData {
  settings: OutcomeGateSettings
}

export interface ModelArtifactPayload {
  artifact: UnknownRecord
}

export interface ModelArtifactSyncItem {
  modelId: string
  modelName: string
  modelType: string
  taskType: string
  datasetId: string
  specVersion: string
  artifactPath: string
  reportPath: string | null
  action: 'imported' | 'updated' | 'skipped'
  reason: string | null
}

export interface ModelArtifactSyncData {
  scannedCount: number
  importedCount: number
  updatedCount: number
  skippedCount: number
  datasetCreatedCount: number
  taskCreatedCount: number
  evaluationCount: number
  items: ModelArtifactSyncItem[]
}

export interface ModelReportPayload {
  content: string
}

export interface BacktestRunData {
  report: UnknownRecord | null
  stdout: string
}

export interface BacktestReportData {
  report: UnknownRecord
}

export interface ThresholdOptimizationData {
  optimization: UnknownRecord
  stdout: string
}

export interface BenchmarkRunData {
  benchmark: UnknownRecord
  stdout: string
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

export interface SignalFeedbackSubmitData {
  signalEventId: string
  feedbackId: string
  action: 'accept' | 'ignore' | 'modify'
  candidateId: string | null
  event: UnknownRecord | null
}

export interface CandidateGenerationData {
  candidates: UnknownRecord[]
  created?: number
  minRequired?: number
}

export interface CandidateReviewData {
  candidateId: string
  status: string
}

export interface ModelActivationData {
  modelId: string
  model?: UnknownRecord | null
}

export interface ModelDescriptionData {
  modelId: string
  description: string
}

export interface ModelMutationData {
  modelId: string
  model?: UnknownRecord | null
  deletedRecommendations?: number
  deletedSignalEvents?: number
  deletedEvaluations?: number
}

export interface ModelRenameData {
  modelId: string
  name: string
}

export interface RetrainingTriggerData {
  taskId: string
  status: string
  run?: { id?: string }
}

export interface FeedbackBackfillData {
  count: number
  inserted?: number
  updated?: number
}

export function getPlatformErrorMessage(result: PlatformResult<unknown> | undefined, fallback = '操作失败'): string {
  if (!result || result.success !== false) return fallback
  return result.error?.message || fallback
}
