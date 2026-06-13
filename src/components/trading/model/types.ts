import type { UnknownRecord } from '../../../types/ipc'

export type PeriodType = '5m' | '15m' | '1d'
export type CandidateStatus = 'all' | 'proposed' | 'accepted' | 'rejected' | 'edited'
export type SignalEventStatus = 'all' | 'new' | 'read' | 'feedback' | 'ignored'

export interface StockOption {
  code: string
  name: string
}

export interface CandidateItem {
  id: string
  code: string
  stockName: string
  period: string
  tradeDate: string
  tradeTime: string
  signalType: string
  factorType: string
  score: number
  reason: string
  status: string
  forwardExitReturnPct: number | null
  forwardMaxReturnPct: number | null
  forwardMinReturnPct: number | null
  forwardRiskReward: number | null
  forwardHoldingBars: number | null
  outcomeTag: string
  trendState: string
}

export interface DatasetItem {
  id: string
  name: string
  status: string
  sampleCount: number
  createdAt: number
  frozenAt: number
}

export interface FeatureBuildTaskItem {
  id: string
  datasetId: string
  datasetName: string
  specVersion: string
  status: string
  createdAt: number
  startedAt: number
  finishedAt: number
  manifestPath: string
  errorMessage: string
}

export interface ModelTrainingTaskItem {
  id: string
  datasetId: string
  specVersion: string
  taskType: string
  status: string
  createdAt: number
  startedAt: number
  finishedAt: number
  artifactPath: string
  errorMessage: string
}

export interface ModelVersionItem {
  id: string
  name: string
  status: string
  taskType: string
  datasetId: string
  specVersion: string
  createdAt: number
  activatedAt: number
  metricsJson: string
  description: string
  testAuc: number | null
  testAccuracy: number | null
  testF1: number | null
  testPrecision: number | null
  testRecall: number | null
  trainAuc: number | null
}

export interface ModelEvaluationItem {
  id: string
  modelId: string
  split: string
  accuracy: number
  precision: number
  recall: number
  f1: number
  auc: number
  sampleCount: number
  createdAt: number
}

export interface SignalEventItem {
  id: string
  modelId: string
  modelName: string
  code: string
  period: string
  barTimestamp: number
  signalType: string
  confidence: number
  score: number
  threshold: number
  status: string
  createdAt: number
  lastFeedbackAction: string
  lastFeedbackNote: string
  lastFeedbackAt: number
}

export interface RetrainingRunItem {
  id: string
  triggerType: string
  status: string
  specVersion: string
  taskType: string
  sampleLimit: number
  activated: number
  datasetId: string
  datasetName: string
  modelId: string
  modelName: string
  summaryJson: string
  backfillSummaryJson: string
  errorMessage: string
  createdAt: number
  startedAt: number
  finishedAt: number
  trainSamples: number | null
  testSamples: number | null
  testAccuracy: number | null
  testF1: number | null
  featureCount: number | null
}

export interface DatasetPolicyEvaluationItem {
  id: string
  mode: string
  leftDatasetId: string
  rightDatasetId: string
  recommendedPolicy: string
  selectedPolicy: string
  appliedDatasetId: string
  summaryJson: string
  createdAt: number
}

export interface DatasetPolicyTrendReport {
  total: number
  alignmentRate: number
  autoTuning: {
    defaultDraftPolicy: string
    defaultMergePolicy: string
  }
  averages: {
    conflictBar: number
    multiLabelConflictBar: number
    outputSample: number
  }
  policyPerformance: {
    keepAll: {
      sampleCount: number
      avgConflictBar: number
      avgOutputSample: number
    }
    singleBest: {
      sampleCount: number
      avgConflictBar: number
      avgOutputSample: number
    }
  }
  segmentAnalysis: {
    byCode: Array<{
      key: string
      total: number
      alignmentRate: number
      recommendedSingleRatio: number
      avgConflictBar: number
      avgOutputSample: number
      suggestedPolicy: string
    }>
    byPeriod: Array<{
      key: string
      total: number
      alignmentRate: number
      recommendedSingleRatio: number
      avgConflictBar: number
      avgOutputSample: number
      suggestedPolicy: string
    }>
  }
  suggestions: string[]
}

export interface DatasetPolicyOutcomeReport {
  totalModels: number
  linkedModels: number
  byPolicy: {
    keep_all: {
      modelCount: number
      avgTestAccuracy: number
      avgTestF1: number
      avgDatasetSample: number
      totalSignalEvents: number
      feedbackCount: number
      acceptRate: number
      actionableRate: number
      avgSignalConfidence: number
    }
    single_best: {
      modelCount: number
      avgTestAccuracy: number
      avgTestF1: number
      avgDatasetSample: number
      totalSignalEvents: number
      feedbackCount: number
      acceptRate: number
      actionableRate: number
      avgSignalConfidence: number
    }
    unknown: {
      modelCount: number
      avgTestAccuracy: number
      avgTestF1: number
      avgDatasetSample: number
      totalSignalEvents: number
      feedbackCount: number
      acceptRate: number
      actionableRate: number
      avgSignalConfidence: number
    }
  }
  segmentOutcome: {
    byCode: Array<{
      key: string
      totalModels: number
      linkedModels: number
      avgTestAccuracy: number
      avgTestF1: number
      avgDatasetSample: number
      totalSignalEvents: number
      feedbackCount: number
      acceptRate: number
      actionableRate: number
      suggestedPolicy: string
    }>
    byPeriod: Array<{
      key: string
      totalModels: number
      linkedModels: number
      avgTestAccuracy: number
      avgTestF1: number
      avgDatasetSample: number
      totalSignalEvents: number
      feedbackCount: number
      acceptRate: number
      actionableRate: number
      suggestedPolicy: string
    }>
  }
  suggestions: string[]
}

export interface DatasetPolicyPnlAttributionReport {
  totalSessions: number
  matchedByCode: number
  matchedByPeriod: number
  defaultPolicy: string
  byPolicy: {
    keep_all: {
      sessionCount: number
      winSessionRate: number
      avgPnlPct: number
      medianPnlPct: number
      avgRealizedPnl: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
    single_best: {
      sessionCount: number
      winSessionRate: number
      avgPnlPct: number
      medianPnlPct: number
      avgRealizedPnl: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
    unknown: {
      sessionCount: number
      winSessionRate: number
      avgPnlPct: number
      medianPnlPct: number
      avgRealizedPnl: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
  }
  segmentPnl: {
    byCode: Array<{
      key: string
      sessions: number
      winSessionRate: number
      avgPnlPct: number
      medianPnlPct: number
      avgRealizedPnl: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
      suggestedPolicy: string
    }>
    byPeriod: Array<{
      key: string
      sessions: number
      winSessionRate: number
      avgPnlPct: number
      medianPnlPct: number
      avgRealizedPnl: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
      suggestedPolicy: string
    }>
  }
  suggestions: string[]
}

export interface DatasetPolicySignalTradingOutcomeReport {
  matchingWindowDays: number
  totalEvents: number
  feedbackEvents: number
  actionableEvents: number
  matchedSessions: number
  coverage: {
    eventCoverage: number
    actionableCoverage: number
  }
  byFeedbackAction: {
    accept: {
      eventCount: number
      feedbackEvents: number
      actionableEvents: number
      matchedCount: number
      coverage: number
      actionableCoverage: number
      avgPnlPct: number
      medianPnlPct: number
      winSessionRate: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
    modify: {
      eventCount: number
      feedbackEvents: number
      actionableEvents: number
      matchedCount: number
      coverage: number
      actionableCoverage: number
      avgPnlPct: number
      medianPnlPct: number
      winSessionRate: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
    ignore: {
      eventCount: number
      feedbackEvents: number
      actionableEvents: number
      matchedCount: number
      coverage: number
      actionableCoverage: number
      avgPnlPct: number
      medianPnlPct: number
      winSessionRate: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
    none: {
      eventCount: number
      feedbackEvents: number
      actionableEvents: number
      matchedCount: number
      coverage: number
      actionableCoverage: number
      avgPnlPct: number
      medianPnlPct: number
      winSessionRate: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
  }
  byPolicy: {
    keep_all: {
      eventCount: number
      feedbackEvents: number
      actionableEvents: number
      matchedCount: number
      coverage: number
      actionableCoverage: number
      avgPnlPct: number
      medianPnlPct: number
      winSessionRate: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
    single_best: {
      eventCount: number
      feedbackEvents: number
      actionableEvents: number
      matchedCount: number
      coverage: number
      actionableCoverage: number
      avgPnlPct: number
      medianPnlPct: number
      winSessionRate: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
    unknown: {
      eventCount: number
      feedbackEvents: number
      actionableEvents: number
      matchedCount: number
      coverage: number
      actionableCoverage: number
      avgPnlPct: number
      medianPnlPct: number
      winSessionRate: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
    }
  }
  segmentOutcome: {
    byCode: Array<{
      key: string
      eventCount: number
      feedbackEvents: number
      actionableEvents: number
      matchedCount: number
      coverage: number
      actionableCoverage: number
      avgPnlPct: number
      medianPnlPct: number
      winSessionRate: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
      suggestedPolicy: string
    }>
    byPeriod: Array<{
      key: string
      eventCount: number
      feedbackEvents: number
      actionableEvents: number
      matchedCount: number
      coverage: number
      actionableCoverage: number
      avgPnlPct: number
      medianPnlPct: number
      winSessionRate: number
      avgTradeWinRate: number
      avgMaxDrawdownPct: number
      suggestedPolicy: string
    }>
  }
  suggestions: string[]
}

export const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
export const asNumber = (value: unknown, fallback = 0): number => typeof value === 'number' ? value : fallback

export const toCandidateItem = (raw: UnknownRecord): CandidateItem | null => {
  const id = asString(raw.id)
  if (!id) return null
  let payload: UnknownRecord = {}
  if (typeof raw.payload === 'string') {
    try {
      const parsed = JSON.parse(raw.payload) as unknown
      if (parsed && typeof parsed === 'object') payload = parsed as UnknownRecord
    } catch {
      payload = {}
    }
  } else if (raw.payload && typeof raw.payload === 'object') {
    payload = raw.payload as UnknownRecord
  }

  const readPayloadNumber = (key: string): number | null => {
    const value = payload[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }

  return {
    id,
    code: asString(raw.code),
    stockName: asString(raw.stock_name),
    period: asString(raw.period),
    tradeDate: asString(raw.trade_date),
    tradeTime: asString(raw.trade_time),
    signalType: asString(raw.signal_type),
    factorType: asString(raw.factor_type),
    score: asNumber(raw.score),
    reason: asString(raw.reason),
    status: asString(raw.status),
    forwardExitReturnPct: readPayloadNumber('forward_exit_return_pct'),
    forwardMaxReturnPct: readPayloadNumber('forward_max_return_pct'),
    forwardMinReturnPct: readPayloadNumber('forward_min_return_pct'),
    forwardRiskReward: readPayloadNumber('forward_risk_reward'),
    forwardHoldingBars: readPayloadNumber('forward_holding_bars'),
    outcomeTag: asString(payload.outcome_tag),
    trendState: asString(payload.trend_state)
  }
}

export const toDatasetItem = (raw: UnknownRecord): DatasetItem | null => {
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    name: asString(raw.name, id),
    status: asString(raw.status, 'draft'),
    sampleCount: asNumber(raw.sample_count, asNumber(raw.item_count, 0)),
    createdAt: asNumber(raw.created_at),
    frozenAt: asNumber(raw.frozen_at)
  }
}

export const toFeatureBuildTaskItem = (raw: UnknownRecord): FeatureBuildTaskItem | null => {
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    datasetId: asString(raw.dataset_id),
    datasetName: asString(raw.dataset_name),
    specVersion: asString(raw.spec_version, 'v001'),
    status: asString(raw.status, 'queued'),
    createdAt: asNumber(raw.created_at),
    startedAt: asNumber(raw.started_at),
    finishedAt: asNumber(raw.finished_at),
    manifestPath: asString(raw.output_manifest_path),
    errorMessage: asString(raw.error_message)
  }
}

export const toModelTrainingTaskItem = (raw: UnknownRecord): ModelTrainingTaskItem | null => {
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    datasetId: asString(raw.dataset_id),
    specVersion: asString(raw.spec_version, 'v001'),
    taskType: asString(raw.task_type, 'buy_signal'),
    status: asString(raw.status, 'queued'),
    createdAt: asNumber(raw.created_at),
    startedAt: asNumber(raw.started_at),
    finishedAt: asNumber(raw.finished_at),
    artifactPath: asString(raw.model_artifact_path),
    errorMessage: asString(raw.error_message)
  }
}

export const toModelVersionItem = (raw: UnknownRecord): ModelVersionItem | null => {
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    name: asString(raw.name, id),
    status: asString(raw.status, 'inactive'),
    taskType: asString(raw.task_type, 'buy_signal'),
    datasetId: asString(raw.dataset_id),
    specVersion: asString(raw.spec_version, 'v001'),
    createdAt: asNumber(raw.created_at),
    activatedAt: asNumber(raw.activated_at),
    metricsJson: asString(raw.metrics_json),
    description: asString(raw.description, ''),
    testAuc: raw.test_auc != null ? asNumber(raw.test_auc) : null,
    testAccuracy: raw.test_accuracy != null ? asNumber(raw.test_accuracy) : null,
    testF1: raw.test_f1 != null ? asNumber(raw.test_f1) : null,
    testPrecision: raw.test_precision != null ? asNumber(raw.test_precision) : null,
    testRecall: raw.test_recall != null ? asNumber(raw.test_recall) : null,
    trainAuc: raw.train_auc != null ? asNumber(raw.train_auc) : null
  }
}

export const toModelEvaluationItem = (raw: UnknownRecord): ModelEvaluationItem | null => {
  const id = asString(raw.id)
  if (!id) return null
  let auc = asNumber(raw.auc, 0)
  if (auc === 0) {
    try {
      const report = JSON.parse(asString(raw.report_json, '{}'))
      auc = typeof report.auc === 'number' ? report.auc : 0
    } catch { /* ignore */ }
  }
  return {
    id,
    modelId: asString(raw.model_id),
    split: asString(raw.split),
    accuracy: asNumber(raw.accuracy, 0),
    precision: asNumber(raw.precision, 0),
    recall: asNumber(raw.recall, 0),
    f1: asNumber(raw.f1, 0),
    auc,
    sampleCount: asNumber(raw.sample_count, 0),
    createdAt: asNumber(raw.created_at)
  }
}

export const toSignalEventItem = (raw: UnknownRecord): SignalEventItem | null => {
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    modelId: asString(raw.model_id),
    modelName: asString(raw.model_name),
    code: asString(raw.code),
    period: asString(raw.period),
    barTimestamp: asNumber(raw.bar_timestamp),
    signalType: asString(raw.signal_type),
    confidence: asNumber(raw.confidence, 0),
    score: asNumber(raw.score, 0),
    threshold: asNumber(raw.threshold, 0),
    status: asString(raw.status, 'new'),
    createdAt: asNumber(raw.created_at),
    lastFeedbackAction: asString(raw.last_feedback_action),
    lastFeedbackNote: asString(raw.last_feedback_note),
    lastFeedbackAt: asNumber(raw.last_feedback_at)
  }
}

export const toRetrainingRunItem = (raw: UnknownRecord): RetrainingRunItem | null => {
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    triggerType: asString(raw.trigger_type, 'manual'),
    status: asString(raw.status, 'running'),
    specVersion: asString(raw.spec_version, 'v001'),
    taskType: asString(raw.task_type, 'buy_signal'),
    sampleLimit: asNumber(raw.sample_limit, 0),
    activated: asNumber(raw.activated, 0),
    datasetId: asString(raw.dataset_id),
    datasetName: asString(raw.dataset_name),
    modelId: asString(raw.model_id),
    modelName: asString(raw.model_name),
    summaryJson: asString(raw.summary_json),
    backfillSummaryJson: asString(raw.backfill_summary_json),
    errorMessage: asString(raw.error_message),
    createdAt: asNumber(raw.created_at),
    startedAt: asNumber(raw.started_at),
    finishedAt: asNumber(raw.finished_at),
    trainSamples: raw.train_samples != null ? asNumber(raw.train_samples) : null,
    testSamples: raw.test_samples != null ? asNumber(raw.test_samples) : null,
    testAccuracy: raw.test_accuracy != null ? asNumber(raw.test_accuracy) : null,
    testF1: raw.test_f1 != null ? asNumber(raw.test_f1) : null,
    featureCount: raw.feature_count != null ? asNumber(raw.feature_count) : null
  }
}

export const toDatasetPolicyEvaluationItem = (raw: UnknownRecord): DatasetPolicyEvaluationItem | null => {
  const id = asString(raw.id)
  if (!id) return null
  return {
    id,
    mode: asString(raw.mode),
    leftDatasetId: asString(raw.left_dataset_id),
    rightDatasetId: asString(raw.right_dataset_id),
    recommendedPolicy: asString(raw.recommended_policy),
    selectedPolicy: asString(raw.selected_policy),
    appliedDatasetId: asString(raw.applied_dataset_id),
    summaryJson: asString(raw.summary_json),
    createdAt: asNumber(raw.created_at)
  }
}

export const toStockOption = (raw: UnknownRecord): StockOption | null => {
  const code = asString(raw.code)
  if (!code) return null
  return {
    code,
    name: asString(raw.name, code)
  }
}

export const toDatasetPolicyTrendReport = (raw: UnknownRecord | null): DatasetPolicyTrendReport | null => {
  if (!raw) return null
  const success = raw.success === true
  if (!success) return null
  const autoTuning = (raw.autoTuning || {}) as UnknownRecord
  const averages = (raw.averages || {}) as UnknownRecord
  const performance = (raw.policyPerformance || {}) as UnknownRecord
  const keepAll = (performance.keepAll || {}) as UnknownRecord
  const singleBest = (performance.singleBest || {}) as UnknownRecord
  const segmentAnalysisRaw = (raw.segmentAnalysis || {}) as UnknownRecord
  const parseSegmentRows = (value: unknown): Array<{
    key: string
    total: number
    alignmentRate: number
    recommendedSingleRatio: number
    avgConflictBar: number
    avgOutputSample: number
    suggestedPolicy: string
  }> => {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => item as UnknownRecord)
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        key: asString(item.key),
        total: asNumber(item.total, 0),
        alignmentRate: asNumber(item.alignmentRate, 0),
        recommendedSingleRatio: asNumber(item.recommendedSingleRatio, 0),
        avgConflictBar: asNumber(item.avgConflictBar, 0),
        avgOutputSample: asNumber(item.avgOutputSample, 0),
        suggestedPolicy: asString(item.suggestedPolicy)
      }))
      .filter((item) => !!item.key)
  }
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.filter((item): item is string => typeof item === 'string')
    : []
  return {
    total: asNumber(raw.total, 0),
    alignmentRate: asNumber(raw.alignmentRate, 0),
    autoTuning: {
      defaultDraftPolicy: asString(autoTuning.defaultDraftPolicy),
      defaultMergePolicy: asString(autoTuning.defaultMergePolicy)
    },
    averages: {
      conflictBar: asNumber(averages.conflictBar, 0),
      multiLabelConflictBar: asNumber(averages.multiLabelConflictBar, 0),
      outputSample: asNumber(averages.outputSample, 0)
    },
    policyPerformance: {
      keepAll: {
        sampleCount: asNumber(keepAll.sampleCount, 0),
        avgConflictBar: asNumber(keepAll.avgConflictBar, 0),
        avgOutputSample: asNumber(keepAll.avgOutputSample, 0)
      },
      singleBest: {
        sampleCount: asNumber(singleBest.sampleCount, 0),
        avgConflictBar: asNumber(singleBest.avgConflictBar, 0),
        avgOutputSample: asNumber(singleBest.avgOutputSample, 0)
      }
    },
    segmentAnalysis: {
      byCode: parseSegmentRows(segmentAnalysisRaw.byCode),
      byPeriod: parseSegmentRows(segmentAnalysisRaw.byPeriod)
    },
    suggestions
  }
}

export const toDatasetPolicyOutcomeReport = (raw: UnknownRecord | null): DatasetPolicyOutcomeReport | null => {
  if (!raw) return null
  const success = raw.success === true
  if (!success) return null
  const byPolicyRaw = (raw.byPolicy || {}) as UnknownRecord
  const keepAllRaw = (byPolicyRaw.keep_all || {}) as UnknownRecord
  const singleBestRaw = (byPolicyRaw.single_best || {}) as UnknownRecord
  const unknownRaw = (byPolicyRaw.unknown || {}) as UnknownRecord
  const segmentOutcomeRaw = (raw.segmentOutcome || {}) as UnknownRecord
  const parsePolicyStats = (value: UnknownRecord) => ({
    modelCount: asNumber(value.modelCount, 0),
    avgTestAccuracy: asNumber(value.avgTestAccuracy, 0),
    avgTestF1: asNumber(value.avgTestF1, 0),
    avgDatasetSample: asNumber(value.avgDatasetSample, 0),
    totalSignalEvents: asNumber(value.totalSignalEvents, 0),
    feedbackCount: asNumber(value.feedbackCount, 0),
    acceptRate: asNumber(value.acceptRate, 0),
    actionableRate: asNumber(value.actionableRate, 0),
    avgSignalConfidence: asNumber(value.avgSignalConfidence, 0)
  })
  const parseSegmentRows = (value: unknown): Array<{
    key: string
    totalModels: number
    linkedModels: number
    avgTestAccuracy: number
    avgTestF1: number
    avgDatasetSample: number
    totalSignalEvents: number
    feedbackCount: number
    acceptRate: number
    actionableRate: number
    suggestedPolicy: string
  }> => {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => item as UnknownRecord)
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        key: asString(item.key),
        totalModels: asNumber(item.totalModels, 0),
        linkedModels: asNumber(item.linkedModels, 0),
        avgTestAccuracy: asNumber(item.avgTestAccuracy, 0),
        avgTestF1: asNumber(item.avgTestF1, 0),
        avgDatasetSample: asNumber(item.avgDatasetSample, 0),
        totalSignalEvents: asNumber(item.totalSignalEvents, 0),
        feedbackCount: asNumber(item.feedbackCount, 0),
        acceptRate: asNumber(item.acceptRate, 0),
        actionableRate: asNumber(item.actionableRate, 0),
        suggestedPolicy: asString(item.suggestedPolicy)
      }))
      .filter((item) => !!item.key)
  }
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.filter((item): item is string => typeof item === 'string')
    : []
  return {
    totalModels: asNumber(raw.totalModels, 0),
    linkedModels: asNumber(raw.linkedModels, 0),
    byPolicy: {
      keep_all: parsePolicyStats(keepAllRaw),
      single_best: parsePolicyStats(singleBestRaw),
      unknown: parsePolicyStats(unknownRaw)
    },
    segmentOutcome: {
      byCode: parseSegmentRows(segmentOutcomeRaw.byCode),
      byPeriod: parseSegmentRows(segmentOutcomeRaw.byPeriod)
    },
    suggestions
  }
}

export const toDatasetPolicyPnlAttributionReport = (raw: UnknownRecord | null): DatasetPolicyPnlAttributionReport | null => {
  if (!raw) return null
  const success = raw.success === true
  if (!success) return null
  const byPolicyRaw = (raw.byPolicy || {}) as UnknownRecord
  const keepAllRaw = (byPolicyRaw.keep_all || {}) as UnknownRecord
  const singleBestRaw = (byPolicyRaw.single_best || {}) as UnknownRecord
  const unknownRaw = (byPolicyRaw.unknown || {}) as UnknownRecord
  const segmentRaw = (raw.segmentPnl || {}) as UnknownRecord
  const parsePolicyStats = (value: UnknownRecord) => ({
    sessionCount: asNumber(value.sessionCount, 0),
    winSessionRate: asNumber(value.winSessionRate, 0),
    avgPnlPct: asNumber(value.avgPnlPct, 0),
    medianPnlPct: asNumber(value.medianPnlPct, 0),
    avgRealizedPnl: asNumber(value.avgRealizedPnl, 0),
    avgTradeWinRate: asNumber(value.avgTradeWinRate, 0),
    avgMaxDrawdownPct: asNumber(value.avgMaxDrawdownPct, 0)
  })
  const parseSegmentRows = (value: unknown): Array<{
    key: string
    sessions: number
    winSessionRate: number
    avgPnlPct: number
    medianPnlPct: number
    avgRealizedPnl: number
    avgTradeWinRate: number
    avgMaxDrawdownPct: number
    suggestedPolicy: string
  }> => {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => item as UnknownRecord)
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        key: asString(item.key),
        sessions: asNumber(item.sessions, 0),
        winSessionRate: asNumber(item.winSessionRate, 0),
        avgPnlPct: asNumber(item.avgPnlPct, 0),
        medianPnlPct: asNumber(item.medianPnlPct, 0),
        avgRealizedPnl: asNumber(item.avgRealizedPnl, 0),
        avgTradeWinRate: asNumber(item.avgTradeWinRate, 0),
        avgMaxDrawdownPct: asNumber(item.avgMaxDrawdownPct, 0),
        suggestedPolicy: asString(item.suggestedPolicy)
      }))
      .filter((item) => !!item.key)
  }
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.filter((item): item is string => typeof item === 'string')
    : []
  return {
    totalSessions: asNumber(raw.totalSessions, 0),
    matchedByCode: asNumber(raw.matchedByCode, 0),
    matchedByPeriod: asNumber(raw.matchedByPeriod, 0),
    defaultPolicy: asString(raw.defaultPolicy),
    byPolicy: {
      keep_all: parsePolicyStats(keepAllRaw),
      single_best: parsePolicyStats(singleBestRaw),
      unknown: parsePolicyStats(unknownRaw)
    },
    segmentPnl: {
      byCode: parseSegmentRows(segmentRaw.byCode),
      byPeriod: parseSegmentRows(segmentRaw.byPeriod)
    },
    suggestions
  }
}

export const toDatasetPolicySignalTradingOutcomeReport = (raw: UnknownRecord | null): DatasetPolicySignalTradingOutcomeReport | null => {
  if (!raw) return null
  const success = raw.success === true
  if (!success) return null
  const byFeedbackActionRaw = (raw.byFeedbackAction || {}) as UnknownRecord
  const byPolicyRaw = (raw.byPolicy || {}) as UnknownRecord
  const segmentRaw = (raw.segmentOutcome || {}) as UnknownRecord
  const coverageRaw = (raw.coverage || {}) as UnknownRecord

  const parseStats = (value: UnknownRecord) => ({
    eventCount: asNumber(value.eventCount, 0),
    feedbackEvents: asNumber(value.feedbackEvents, 0),
    actionableEvents: asNumber(value.actionableEvents, 0),
    matchedCount: asNumber(value.matchedCount, 0),
    coverage: asNumber(value.coverage, 0),
    actionableCoverage: asNumber(value.actionableCoverage, 0),
    avgPnlPct: asNumber(value.avgPnlPct, 0),
    medianPnlPct: asNumber(value.medianPnlPct, 0),
    winSessionRate: asNumber(value.winSessionRate, 0),
    avgTradeWinRate: asNumber(value.avgTradeWinRate, 0),
    avgMaxDrawdownPct: asNumber(value.avgMaxDrawdownPct, 0)
  })
  const parseSegmentRows = (value: unknown): Array<{
    key: string
    eventCount: number
    feedbackEvents: number
    actionableEvents: number
    matchedCount: number
    coverage: number
    actionableCoverage: number
    avgPnlPct: number
    medianPnlPct: number
    winSessionRate: number
    avgTradeWinRate: number
    avgMaxDrawdownPct: number
    suggestedPolicy: string
  }> => {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => item as UnknownRecord)
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        key: asString(item.key),
        eventCount: asNumber(item.eventCount, 0),
        feedbackEvents: asNumber(item.feedbackEvents, 0),
        actionableEvents: asNumber(item.actionableEvents, 0),
        matchedCount: asNumber(item.matchedCount, 0),
        coverage: asNumber(item.coverage, 0),
        actionableCoverage: asNumber(item.actionableCoverage, 0),
        avgPnlPct: asNumber(item.avgPnlPct, 0),
        medianPnlPct: asNumber(item.medianPnlPct, 0),
        winSessionRate: asNumber(item.winSessionRate, 0),
        avgTradeWinRate: asNumber(item.avgTradeWinRate, 0),
        avgMaxDrawdownPct: asNumber(item.avgMaxDrawdownPct, 0),
        suggestedPolicy: asString(item.suggestedPolicy)
      }))
      .filter((item) => !!item.key)
  }
  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.filter((item): item is string => typeof item === 'string')
    : []

  return {
    matchingWindowDays: asNumber(raw.matchingWindowDays, 0),
    totalEvents: asNumber(raw.totalEvents, 0),
    feedbackEvents: asNumber(raw.feedbackEvents, 0),
    actionableEvents: asNumber(raw.actionableEvents, 0),
    matchedSessions: asNumber(raw.matchedSessions, 0),
    coverage: {
      eventCoverage: asNumber(coverageRaw.eventCoverage, 0),
      actionableCoverage: asNumber(coverageRaw.actionableCoverage, 0)
    },
    byFeedbackAction: {
      accept: parseStats((byFeedbackActionRaw.accept || {}) as UnknownRecord),
      modify: parseStats((byFeedbackActionRaw.modify || {}) as UnknownRecord),
      ignore: parseStats((byFeedbackActionRaw.ignore || {}) as UnknownRecord),
      none: parseStats((byFeedbackActionRaw.none || {}) as UnknownRecord)
    },
    byPolicy: {
      keep_all: parseStats((byPolicyRaw.keep_all || {}) as UnknownRecord),
      single_best: parseStats((byPolicyRaw.single_best || {}) as UnknownRecord),
      unknown: parseStats((byPolicyRaw.unknown || {}) as UnknownRecord)
    },
    segmentOutcome: {
      byCode: parseSegmentRows(segmentRaw.byCode),
      byPeriod: parseSegmentRows(segmentRaw.byPeriod)
    },
    suggestions
  }
}
