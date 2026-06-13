import { getDb } from '../db'
import { getBlindDb } from '../blindDb'
import type { SaveLabelInput } from '../../types/ipc'
import { registerModelDbLabelingIpcHandlers } from './modelDbLabelingIpc'
import { registerModelDatasetIpcHandlers } from './modelDatasetIpc'
import { registerModelCandidateIpcHandlers } from './modelCandidateIpc'
import { registerModelSignalRetrainingIpcHandlers } from './modelSignalRetrainingIpc'
import { createFeedbackRetrainingService } from './modelFeedbackRetrainingService'
import { createSignalInferenceService } from './modelSignalInferenceService'
import { createFactorCandidateService } from './modelFactorCandidateService'
import { registerModelResearchIpc } from './modelResearchIpc'
import {
  listDatasetPolicyEvaluations,
  recommendConflictPolicy,
  recordDatasetPolicyEvaluation
} from './modelDatasetPolicyStore'
import type { ConflictPolicy } from './modelDatasetPolicyStore'
import {
  getKlineTable,
  isSupportedPeriod,
  normalizePeriodAlias,
  resolveArtifactPath,
  toBarTimestamp,
  toBooleanFlag,
  toTimestampMillis,
  toTradeDateTime,
  type PeriodType
} from './modelFeatureCalculator'
import {
  createFeatureBuildTask,
  createModelTrainingTask,
  runEnsemblePredictCli,
  runEnsembleWalkforwardCli,
  runLabelInspectCli,
  runFeatureSampleAuditCli,
  runPredictBatchCli,
  runPredictReplayCli,
  runPredictLiveCli,
  runPredictSeriesCli,
  runLabelGenerateCli,
  cancelLabelGenerateCli,
  runListLabelersCli,
} from './modelCliRunner'

const saveLabelToDb = (label: SaveLabelInput) => {
  const database = getDb()
  const id = `label_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const now = Math.floor(Date.now() / 1000)

  database.prepare(`
    INSERT INTO labels 
    (id, session_id, bar_index, label_type, source, strategy_id, confidence, user_confidence, status, reason, note, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    label.sessionId,
    label.barIndex,
    label.labelType,
    label.source,
    label.strategyId,
    label.confidence,
    label.userConfidence,
    label.status || 'proposed',
    label.reason,
    label.note,
    now,
    now
  )

  return { ...label, id, createdAt: now * 1000 }
}

const updateLabelStatusInDb = (labelId: string, status: string, userConfidence?: number) => {
  const database = getDb()
  const updates: string[] = ['status = ?', 'updated_at = ?']
  const values: Array<string | number> = [status, Math.floor(Date.now() / 1000)]

  if (userConfidence !== undefined) {
    updates.push('user_confidence = ?')
    values.push(userConfidence)
  }

  values.push(labelId)
  database.prepare(`UPDATE labels SET ${updates.join(', ')} WHERE id = ?`).run(...values)
}

const recountDatasetItems = (datasetId: string) => {
  const database = getDb()
  const countRow = database.prepare('SELECT COUNT(*) as count FROM dataset_items WHERE dataset_id = ?').get(datasetId) as { count: number }
  database.prepare('UPDATE dataset_versions SET sample_count = ?, updated_at = ? WHERE id = ?')
    .run(countRow.count, Math.floor(Date.now() / 1000), datasetId)
  return countRow.count
}

interface DatasetPolicyEvaluationRow {
  id: string
  mode: string
  left_dataset_id?: string | null
  right_dataset_id?: string | null
  filters_json?: string | null
  summary_json?: string | null
  recommended_policy?: string | null
  selected_policy?: string | null
  applied_dataset_id?: string | null
  created_at: number
}

const parseJsonRecord = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== 'string' || raw.trim().length === 0) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const pickNumber = (payload: Record<string, unknown>, key: string): number | null => {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const pickOutputSampleCount = (summary: Record<string, unknown>): number | null => {
  const output = pickNumber(summary, 'outputSampleCount')
  if (output !== null) return output
  const imported = pickNumber(summary, 'importedCount')
  if (imported !== null) return imported
  return null
}

const aggregateMean = (values: number[]): number => {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

interface NormalizedPolicyEvaluationRow {
  id: string
  mode: string
  recommendedPolicy: string
  selectedPolicy: string
  appliedDatasetId: string
  createdAt: number
  conflictBarCount: number
  sameBarMultiLabelCount: number
  outputSampleCount: number
  codeSegment: string
  periodSegment: string
}

const resolveDatasetDominantSegment = (
  datasetId: string,
  cache: Map<string, { code: string; period: string }>
): { code: string; period: string } => {
  if (!datasetId) return { code: '', period: '' }
  const cached = cache.get(datasetId)
  if (cached) return cached
  const database = getDb()
  const codeRow = database.prepare(`
    SELECT code, COUNT(*) AS cnt
    FROM dataset_items
    WHERE dataset_id = ?
    GROUP BY code
    ORDER BY cnt DESC, code ASC
    LIMIT 1
  `).get(datasetId) as { code?: string } | undefined
  const periodRow = database.prepare(`
    SELECT period, COUNT(*) AS cnt
    FROM dataset_items
    WHERE dataset_id = ?
    GROUP BY period
    ORDER BY cnt DESC, period ASC
    LIMIT 1
  `).get(datasetId) as { period?: string } | undefined
  const result = {
    code: typeof codeRow?.code === 'string' ? codeRow.code : '',
    period: typeof periodRow?.period === 'string' ? periodRow.period : ''
  }
  cache.set(datasetId, result)
  return result
}

const toSegmentStats = (
  rows: NormalizedPolicyEvaluationRow[],
  keyResolver: (row: NormalizedPolicyEvaluationRow) => string,
  keyName: 'code' | 'period'
): Array<{
  key: string
  total: number
  alignmentRate: number
  recommendedSingleRatio: number
  avgConflictBar: number
  avgOutputSample: number
  suggestedPolicy: ConflictPolicy
}> => {
  const groups = new Map<string, NormalizedPolicyEvaluationRow[]>()
  for (const row of rows) {
    const key = keyResolver(row)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const stats = Array.from(groups.entries()).map(([key, bucket]) => {
    const recommendedRows = bucket.filter((item) => item.recommendedPolicy !== '')
    const alignedRows = bucket.filter((item) => item.recommendedPolicy !== '' && item.recommendedPolicy === item.selectedPolicy)
    const alignmentRate = recommendedRows.length > 0 ? alignedRows.length / recommendedRows.length : 0
    const recommendedSingleRatio = recommendedRows.length > 0
      ? recommendedRows.filter((item) => item.recommendedPolicy === 'single_best').length / recommendedRows.length
      : 0
    const suggestedPolicy = recommendDefaultPolicyFromRows(
      bucket.map((item) => ({
        recommendedPolicy: item.recommendedPolicy,
        conflictBarCount: item.conflictBarCount,
        sameBarMultiLabelCount: item.sameBarMultiLabelCount
      })),
      'single_best'
    )
    return {
      key,
      total: bucket.length,
      alignmentRate,
      recommendedSingleRatio,
      avgConflictBar: aggregateMean(bucket.map((item) => item.conflictBarCount)),
      avgOutputSample: aggregateMean(bucket.map((item) => item.outputSampleCount).filter((value) => value > 0)),
      suggestedPolicy
    }
  })

  const priority = keyName === 'period' ? ['5m', '15m', '1d'] : []
  return stats
    .sort((left, right) => {
      if (priority.length > 0) {
        const leftIndex = priority.indexOf(left.key)
        const rightIndex = priority.indexOf(right.key)
        const leftRank = leftIndex >= 0 ? leftIndex : 99
        const rightRank = rightIndex >= 0 ? rightIndex : 99
        if (leftRank !== rightRank) return leftRank - rightRank
      }
      if (right.total !== left.total) return right.total - left.total
      return left.key.localeCompare(right.key)
    })
    .slice(0, 20)
}

const recommendDefaultPolicyFromRows = (rows: Array<{
  recommendedPolicy: string
  conflictBarCount: number
  sameBarMultiLabelCount: number
}>, fallback: ConflictPolicy = 'single_best'): ConflictPolicy => {
  if (rows.length === 0) return fallback
  const total = rows.length
  const recommendedSingleCount = rows.filter((row) => row.recommendedPolicy === 'single_best').length
  const avgConflict = aggregateMean(rows.map((row) => row.conflictBarCount))
  const avgMultiLabel = aggregateMean(rows.map((row) => row.sameBarMultiLabelCount))
  const recommendedSingleRatio = recommendedSingleCount / total
  if (avgMultiLabel > 0) return 'single_best'
  if (avgConflict >= 2) return 'single_best'
  if (recommendedSingleRatio >= 0.55) return 'single_best'
  return 'keep_all'
}

type PolicyOutcomeKey = ConflictPolicy | 'unknown'

const normalizePolicyOutcome = (value: unknown): PolicyOutcomeKey => {
  if (value === 'keep_all' || value === 'single_best') return value
  return 'unknown'
}

const parseModelTestMetrics = (metricsJson?: string | null): {
  testAccuracy: number | null
  testF1: number | null
} => {
  if (typeof metricsJson !== 'string' || metricsJson.trim().length === 0) {
    return { testAccuracy: null, testF1: null }
  }
  try {
    const payload = JSON.parse(metricsJson) as Record<string, unknown>
    const testNode = payload.test
    if (!testNode || typeof testNode !== 'object') {
      return { testAccuracy: null, testF1: null }
    }
    const test = testNode as Record<string, unknown>
    const accuracy = typeof test.accuracy === 'number' && Number.isFinite(test.accuracy)
      ? test.accuracy
      : null
    const f1 = typeof test.f1 === 'number' && Number.isFinite(test.f1)
      ? test.f1
      : null
    return { testAccuracy: accuracy, testF1: f1 }
  } catch {
    return { testAccuracy: null, testF1: null }
  }
}

const averageNullable = (values: Array<number | null | undefined>): number => {
  const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return aggregateMean(filtered)
}

interface ModelPolicyOutcomeRow {
  modelId: string
  modelName: string
  datasetId: string
  createdAt: number
  selectedPolicy: PolicyOutcomeKey
  recommendedPolicy: PolicyOutcomeKey
  datasetSampleCount: number
  testAccuracy: number | null
  testF1: number | null
  codeSegment: string
  periodSegment: string
  totalSignalEvents: number
  feedbackCount: number
  acceptCount: number
  modifyCount: number
  ignoreCount: number
  avgSignalConfidence: number
}

const summarizeModelPolicyOutcomeRows = (rows: ModelPolicyOutcomeRow[]) => {
  const feedbackCount = rows.reduce((sum, row) => sum + row.feedbackCount, 0)
  const acceptCount = rows.reduce((sum, row) => sum + row.acceptCount, 0)
  const modifyCount = rows.reduce((sum, row) => sum + row.modifyCount, 0)
  return {
    modelCount: rows.length,
    avgTestAccuracy: averageNullable(rows.map((row) => row.testAccuracy)),
    avgTestF1: averageNullable(rows.map((row) => row.testF1)),
    avgDatasetSample: aggregateMean(rows.map((row) => row.datasetSampleCount).filter((value) => value > 0)),
    totalSignalEvents: rows.reduce((sum, row) => sum + row.totalSignalEvents, 0),
    feedbackCount,
    acceptRate: feedbackCount > 0 ? acceptCount / feedbackCount : 0,
    actionableRate: feedbackCount > 0 ? (acceptCount + modifyCount) / feedbackCount : 0,
    avgSignalConfidence: aggregateMean(rows.map((row) => row.avgSignalConfidence).filter((value) => value > 0))
  }
}

const suggestOutcomePolicyFromRows = (rows: ModelPolicyOutcomeRow[]): ConflictPolicy => {
  const keepRows = rows.filter((row) => row.selectedPolicy === 'keep_all')
  const singleRows = rows.filter((row) => row.selectedPolicy === 'single_best')
  if (singleRows.length === 0 && keepRows.length === 0) return 'single_best'
  if (singleRows.length === 0) return 'keep_all'
  if (keepRows.length === 0) return 'single_best'

  const score = (bucket: ModelPolicyOutcomeRow[]): number => {
    const metrics = summarizeModelPolicyOutcomeRows(bucket)
    const metricCore = metrics.avgTestF1 > 0 ? metrics.avgTestF1 : metrics.avgTestAccuracy
    return metricCore * 0.8 + metrics.actionableRate * 0.2 + Math.min(0.05, bucket.length * 0.005)
  }
  return score(singleRows) >= score(keepRows) ? 'single_best' : 'keep_all'
}

const toOutcomeSegmentStats = (
  rows: ModelPolicyOutcomeRow[],
  keyResolver: (row: ModelPolicyOutcomeRow) => string,
  keyName: 'code' | 'period'
): Array<{
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
  suggestedPolicy: ConflictPolicy
}> => {
  const groups = new Map<string, ModelPolicyOutcomeRow[]>()
  for (const row of rows) {
    const key = keyResolver(row)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const stats = Array.from(groups.entries()).map(([key, bucket]) => {
    const linked = bucket.filter((row) => row.selectedPolicy !== 'unknown')
    const summary = summarizeModelPolicyOutcomeRows(bucket)
    const suggestedPolicy = suggestOutcomePolicyFromRows(linked)
    return {
      key,
      totalModels: bucket.length,
      linkedModels: linked.length,
      avgTestAccuracy: summary.avgTestAccuracy,
      avgTestF1: summary.avgTestF1,
      avgDatasetSample: summary.avgDatasetSample,
      totalSignalEvents: summary.totalSignalEvents,
      feedbackCount: summary.feedbackCount,
      acceptRate: summary.acceptRate,
      actionableRate: summary.actionableRate,
      suggestedPolicy
    }
  })

  const priority = keyName === 'period' ? ['5m', '15m', '1d'] : []
  return stats
    .sort((left, right) => {
      if (priority.length > 0) {
        const leftIndex = priority.indexOf(left.key)
        const rightIndex = priority.indexOf(right.key)
        const leftRank = leftIndex >= 0 ? leftIndex : 99
        const rightRank = rightIndex >= 0 ? rightIndex : 99
        if (leftRank !== rightRank) return leftRank - rightRank
      }
      if (right.totalModels !== left.totalModels) return right.totalModels - left.totalModels
      return left.key.localeCompare(right.key)
    })
    .slice(0, 20)
}

const getDatasetPolicyTrendReport = (limit?: number) => {
  const rows = listDatasetPolicyEvaluations('', limit) as DatasetPolicyEvaluationRow[]
  const segmentCache = new Map<string, { code: string; period: string }>()
  const normalizedRows: NormalizedPolicyEvaluationRow[] = rows.map((row) => {
    const summary = parseJsonRecord(row.summary_json)
    const filters = parseJsonRecord(row.filters_json)
    const recommendedPolicy = row.recommended_policy === 'single_best' || row.recommended_policy === 'keep_all'
      ? row.recommended_policy
      : ''
    const selectedPolicy = row.selected_policy === 'single_best' || row.selected_policy === 'keep_all'
      ? row.selected_policy
      : ''
    const appliedDatasetId = row.applied_dataset_id || ''
    const dominant = resolveDatasetDominantSegment(appliedDatasetId, segmentCache)
    const filterCode = typeof filters.code === 'string' ? filters.code.trim() : ''
    const filterPeriod = typeof filters.period === 'string' ? filters.period.trim() : ''
    return {
      id: row.id,
      mode: row.mode || 'unknown',
      recommendedPolicy,
      selectedPolicy,
      appliedDatasetId,
      createdAt: Number(row.created_at || 0),
      conflictBarCount: pickNumber(summary, 'conflictBarCount') || 0,
      sameBarMultiLabelCount: pickNumber(summary, 'sameBarMultiLabelCount') || 0,
      outputSampleCount: pickOutputSampleCount(summary) || 0,
      codeSegment: filterCode || dominant.code || '',
      periodSegment: filterPeriod || dominant.period || ''
    }
  })

  const total = normalizedRows.length
  const recommendedRows = normalizedRows.filter((row) => row.recommendedPolicy !== '')
  const alignedRows = normalizedRows.filter((row) => row.recommendedPolicy !== '' && row.recommendedPolicy === row.selectedPolicy)
  const alignmentRate = recommendedRows.length > 0 ? alignedRows.length / recommendedRows.length : 0

  const byMode: Record<string, number> = {}
  const byRecommendedPolicy: Record<string, number> = {}
  const bySelectedPolicy: Record<string, number> = {}
  for (const row of normalizedRows) {
    byMode[row.mode] = (byMode[row.mode] || 0) + 1
    if (row.recommendedPolicy) byRecommendedPolicy[row.recommendedPolicy] = (byRecommendedPolicy[row.recommendedPolicy] || 0) + 1
    if (row.selectedPolicy) bySelectedPolicy[row.selectedPolicy] = (bySelectedPolicy[row.selectedPolicy] || 0) + 1
  }

  const avgConflictBar = aggregateMean(normalizedRows.map((row) => row.conflictBarCount))
  const avgMultiLabelConflictBar = aggregateMean(normalizedRows.map((row) => row.sameBarMultiLabelCount))
  const avgOutputSample = aggregateMean(normalizedRows.map((row) => row.outputSampleCount).filter((value) => value > 0))
  const keepAllRows = normalizedRows.filter((row) => row.selectedPolicy === 'keep_all')
  const singleBestRows = normalizedRows.filter((row) => row.selectedPolicy === 'single_best')

  const draftRows = normalizedRows.filter((row) => row.mode === 'draft_preview')
  const mergeRows = normalizedRows.filter((row) => row.mode === 'dataset_merge' || row.mode === 'dataset_compare')
  const defaultDraftPolicy = recommendDefaultPolicyFromRows(draftRows, 'single_best')
  const defaultMergePolicy = recommendDefaultPolicyFromRows(mergeRows, defaultDraftPolicy)
  const byCode = toSegmentStats(normalizedRows, (row) => row.codeSegment, 'code')
  const byPeriod = toSegmentStats(normalizedRows, (row) => row.periodSegment, 'period')

  const suggestions: string[] = []
  if (total === 0) {
    suggestions.push('暂无评估记录，先运行“评估冲突策略效果”后再看趋势建议。')
  } else {
    const recommendedSingleRatio = recommendedRows.length > 0
      ? (byRecommendedPolicy.single_best || 0) / recommendedRows.length
      : 0
    suggestions.push(
      `草稿默认策略建议：${defaultDraftPolicy === 'single_best' ? '同bar最高分' : '保留全部标签'}；合并默认策略建议：${defaultMergePolicy === 'single_best' ? '同bar最高分' : '保留全部标签'}。`
    )
    if (alignmentRate < 0.7) {
      suggestions.push(`人工选择与系统推荐一致率仅 ${(alignmentRate * 100).toFixed(1)}%，建议优先跟随推荐策略以降低冲突噪声。`)
    }
    if (recommendedSingleRatio >= 0.6) {
      suggestions.push(`近阶段 ${(recommendedSingleRatio * 100).toFixed(1)}% 评估推荐 single_best，建议将其设为默认策略。`)
    }
    const keepAllAvgOutput = aggregateMean(keepAllRows.map((row) => row.outputSampleCount).filter((value) => value > 0))
    const singleBestAvgOutput = aggregateMean(singleBestRows.map((row) => row.outputSampleCount).filter((value) => value > 0))
    const singleBestAvgConflict = aggregateMean(singleBestRows.map((row) => row.conflictBarCount))
    const keepAllAvgConflict = aggregateMean(keepAllRows.map((row) => row.conflictBarCount))
    if (singleBestAvgOutput > 0 && keepAllAvgOutput > 0) {
      if (singleBestAvgOutput >= keepAllAvgOutput * 0.9 && singleBestAvgConflict <= keepAllAvgConflict) {
        suggestions.push('single_best 在保留样本规模的同时更好抑制冲突，建议作为生产默认。')
      } else if (keepAllAvgOutput > singleBestAvgOutput * 1.15 && keepAllAvgConflict < 1) {
        suggestions.push('keep_all 显著提升样本规模且冲突低，当前阶段可优先 keep_all。')
      }
    }
  }

  return {
    success: true,
    generatedAt: Math.floor(Date.now() / 1000),
    total,
    alignmentRate,
    byMode,
    byRecommendedPolicy,
    bySelectedPolicy,
    averages: {
      conflictBar: avgConflictBar,
      multiLabelConflictBar: avgMultiLabelConflictBar,
      outputSample: avgOutputSample
    },
    policyPerformance: {
      keepAll: {
        sampleCount: keepAllRows.length,
        avgConflictBar: aggregateMean(keepAllRows.map((row) => row.conflictBarCount)),
        avgOutputSample: aggregateMean(keepAllRows.map((row) => row.outputSampleCount).filter((value) => value > 0))
      },
      singleBest: {
        sampleCount: singleBestRows.length,
        avgConflictBar: aggregateMean(singleBestRows.map((row) => row.conflictBarCount)),
        avgOutputSample: aggregateMean(singleBestRows.map((row) => row.outputSampleCount).filter((value) => value > 0))
      }
    },
    autoTuning: {
      defaultDraftPolicy,
      defaultMergePolicy
    },
    segmentAnalysis: {
      byCode,
      byPeriod
    },
    suggestions,
    latestEvaluations: normalizedRows.slice(0, 12)
  }
}

const getDatasetPolicyOutcomeReport = (limit?: number) => {
  const database = getDb()
  const maxLimit = Math.min(200, Math.max(1, Number(limit || 100)))
  const modelRows = database.prepare(`
    SELECT
      m.id AS model_id,
      m.name AS model_name,
      m.dataset_id AS dataset_id,
      m.metrics_json AS metrics_json,
      m.created_at AS created_at,
      d.sample_count AS dataset_sample_count,
      d.source_filter AS source_filter,
      (
        SELECT e.selected_policy
        FROM dataset_policy_evaluations e
        WHERE e.applied_dataset_id = m.dataset_id
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1
      ) AS selected_policy,
      (
        SELECT e.recommended_policy
        FROM dataset_policy_evaluations e
        WHERE e.applied_dataset_id = m.dataset_id
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1
      ) AS recommended_policy
    FROM model_versions m
    LEFT JOIN dataset_versions d ON d.id = m.dataset_id
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(maxLimit) as Array<{
    model_id: string
    model_name: string
    dataset_id: string
    metrics_json: string | null
    created_at: number
    dataset_sample_count: number | null
    source_filter: string | null
    selected_policy: string | null
    recommended_policy: string | null
  }>

  const modelIds = modelRows
    .map((row) => row.model_id)
    .filter((item) => typeof item === 'string' && item.length > 0)
  const feedbackRows = modelIds.length > 0
    ? database.prepare(`
      SELECT
        e.model_id AS model_id,
        COUNT(*) AS total_events,
        AVG(e.confidence) AS avg_confidence,
        SUM(CASE WHEN fb.action IS NOT NULL THEN 1 ELSE 0 END) AS feedback_count,
        SUM(CASE WHEN fb.action = 'accept' THEN 1 ELSE 0 END) AS accept_count,
        SUM(CASE WHEN fb.action = 'modify' THEN 1 ELSE 0 END) AS modify_count,
        SUM(CASE WHEN fb.action = 'ignore' THEN 1 ELSE 0 END) AS ignore_count
      FROM signal_events e
      LEFT JOIN (
        SELECT f.signal_event_id, f.action
        FROM signal_feedback f
        WHERE f.id = (
          SELECT f2.id
          FROM signal_feedback f2
          WHERE f2.signal_event_id = f.signal_event_id
          ORDER BY f2.created_at DESC, f2.id DESC
          LIMIT 1
        )
      ) fb ON fb.signal_event_id = e.id
      WHERE e.model_id IN (${modelIds.map(() => '?').join(',')})
      GROUP BY e.model_id
    `).all(...modelIds) as Array<{
      model_id: string
      total_events: number
      avg_confidence: number | null
      feedback_count: number
      accept_count: number
      modify_count: number
      ignore_count: number
    }>
    : []
  const feedbackMap = new Map<string, {
    totalEvents: number
    feedbackCount: number
    acceptCount: number
    modifyCount: number
    ignoreCount: number
    avgConfidence: number
  }>()
  for (const row of feedbackRows) {
    feedbackMap.set(row.model_id, {
      totalEvents: Number(row.total_events || 0),
      feedbackCount: Number(row.feedback_count || 0),
      acceptCount: Number(row.accept_count || 0),
      modifyCount: Number(row.modify_count || 0),
      ignoreCount: Number(row.ignore_count || 0),
      avgConfidence: typeof row.avg_confidence === 'number' && Number.isFinite(row.avg_confidence)
        ? row.avg_confidence
        : 0
    })
  }

  const segmentCache = new Map<string, { code: string; period: string }>()
  const normalizedRows: ModelPolicyOutcomeRow[] = modelRows.map((row) => {
    const metrics = parseModelTestMetrics(row.metrics_json)
    const sourceFilter = parseJsonRecord(row.source_filter)
    const dominant = resolveDatasetDominantSegment(row.dataset_id, segmentCache)
    const filterCode = typeof sourceFilter.code === 'string' ? sourceFilter.code.trim() : ''
    const filterPeriod = typeof sourceFilter.period === 'string' ? sourceFilter.period.trim() : ''
    const feedback = feedbackMap.get(row.model_id)
    return {
      modelId: row.model_id,
      modelName: row.model_name || row.model_id,
      datasetId: row.dataset_id || '',
      createdAt: Number(row.created_at || 0),
      selectedPolicy: normalizePolicyOutcome(row.selected_policy),
      recommendedPolicy: normalizePolicyOutcome(row.recommended_policy),
      datasetSampleCount: Number(row.dataset_sample_count || 0),
      testAccuracy: metrics.testAccuracy,
      testF1: metrics.testF1,
      codeSegment: filterCode || dominant.code || '',
      periodSegment: filterPeriod || dominant.period || '',
      totalSignalEvents: feedback?.totalEvents || 0,
      feedbackCount: feedback?.feedbackCount || 0,
      acceptCount: feedback?.acceptCount || 0,
      modifyCount: feedback?.modifyCount || 0,
      ignoreCount: feedback?.ignoreCount || 0,
      avgSignalConfidence: feedback?.avgConfidence || 0
    }
  })

  const linkedRows = normalizedRows.filter((row) => row.selectedPolicy !== 'unknown')
  const byPolicy = {
    keep_all: summarizeModelPolicyOutcomeRows(normalizedRows.filter((row) => row.selectedPolicy === 'keep_all')),
    single_best: summarizeModelPolicyOutcomeRows(normalizedRows.filter((row) => row.selectedPolicy === 'single_best')),
    unknown: summarizeModelPolicyOutcomeRows(normalizedRows.filter((row) => row.selectedPolicy === 'unknown'))
  }
  const byPeriod = toOutcomeSegmentStats(normalizedRows, (row) => row.periodSegment, 'period')
  const byCode = toOutcomeSegmentStats(normalizedRows, (row) => row.codeSegment, 'code')

  const suggestions: string[] = []
  if (normalizedRows.length === 0) {
    suggestions.push('暂无模型版本，先完成至少一次“冻结数据集 -> 特征构建 -> 模型训练”。')
  } else if (linkedRows.length === 0) {
    suggestions.push('已有模型尚未关联到冲突策略样本，建议优先使用“创建草稿/合并草稿”生成的数据集训练，以便策略归因。')
  } else {
    const keepStats = byPolicy.keep_all
    const singleStats = byPolicy.single_best
    if (keepStats.modelCount > 0 && singleStats.modelCount > 0) {
      const f1Gap = singleStats.avgTestF1 - keepStats.avgTestF1
      if (Math.abs(f1Gap) >= 0.01) {
        suggestions.push(
          f1Gap > 0
            ? `single_best 的平均 Test F1 高于 keep_all ${(f1Gap * 100).toFixed(1)}%，建议在冲突密集数据中优先 single_best。`
            : `keep_all 的平均 Test F1 高于 single_best ${Math.abs(f1Gap * 100).toFixed(1)}%，建议在低冲突数据中优先 keep_all。`
        )
      }
      const actionableGap = singleStats.actionableRate - keepStats.actionableRate
      if (Math.abs(actionableGap) >= 0.05) {
        suggestions.push(
          actionableGap > 0
            ? `single_best 的提醒可执行率更高（+${(actionableGap * 100).toFixed(1)}%），可提升人工复核效率。`
            : `keep_all 的提醒可执行率更高（+${Math.abs(actionableGap * 100).toFixed(1)}%），可保留更多可用提醒。`
        )
      }
    }
    const weakPeriod = byPeriod
      .filter((row) => row.linkedModels >= 2 && row.avgTestF1 > 0)
      .sort((left, right) => left.avgTestF1 - right.avgTestF1)[0]
    if (weakPeriod) {
      suggestions.push(
        `${weakPeriod.key} 周期当前平均 Test F1 最低（${(weakPeriod.avgTestF1 * 100).toFixed(1)}%），建议优先按该分层复核标签和默认策略。`
      )
    }
  }

  return {
    success: true,
    generatedAt: Math.floor(Date.now() / 1000),
    totalModels: normalizedRows.length,
    linkedModels: linkedRows.length,
    byPolicy,
    segmentOutcome: {
      byPeriod,
      byCode
    },
    suggestions,
    latestModels: normalizedRows.slice(0, 12)
  }
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1]
    const right = sorted[mid]
    if (typeof left !== 'number' || typeof right !== 'number') return 0
    return (left + right) / 2
  }
  const value = sorted[mid]
  return typeof value === 'number' ? value : 0
}

interface PolicyPnlSessionRow {
  sessionId: string
  code: string
  period: string
  startedAt: number
  realizedPnl: number
  realizedPnlPct: number
  tradeWinRate: number
  maxDrawdownPct: number
  suggestedPolicy: PolicyOutcomeKey
  policySource: 'code' | 'period' | 'default' | 'unknown'
}

const summarizePolicyPnlRows = (rows: PolicyPnlSessionRow[]) => {
  const pnlPctValues = rows.map((row) => row.realizedPnlPct)
  return {
    sessionCount: rows.length,
    winSessionRate: rows.length > 0 ? rows.filter((row) => row.realizedPnlPct > 0).length / rows.length : 0,
    avgPnlPct: aggregateMean(pnlPctValues),
    medianPnlPct: median(pnlPctValues),
    avgRealizedPnl: aggregateMean(rows.map((row) => row.realizedPnl)),
    avgTradeWinRate: aggregateMean(rows.map((row) => row.tradeWinRate).filter((value) => value > 0)),
    avgMaxDrawdownPct: aggregateMean(rows.map((row) => row.maxDrawdownPct).filter((value) => value > 0))
  }
}

const toPolicyPnlSegmentStats = (
  rows: PolicyPnlSessionRow[],
  keyResolver: (row: PolicyPnlSessionRow) => string,
  keyName: 'code' | 'period',
  suggestionMap: Map<string, ConflictPolicy>,
  fallbackPolicy: ConflictPolicy
): Array<{
  key: string
  sessions: number
  winSessionRate: number
  avgPnlPct: number
  medianPnlPct: number
  avgRealizedPnl: number
  avgTradeWinRate: number
  avgMaxDrawdownPct: number
  suggestedPolicy: ConflictPolicy
}> => {
  const groups = new Map<string, PolicyPnlSessionRow[]>()
  for (const row of rows) {
    const key = keyResolver(row)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const stats = Array.from(groups.entries()).map(([key, bucket]) => {
    const summary = summarizePolicyPnlRows(bucket)
    const mappedPolicy = suggestionMap.get(key)
    const suggestedPolicy = mappedPolicy === 'keep_all' || mappedPolicy === 'single_best'
      ? mappedPolicy
      : fallbackPolicy
    return {
      key,
      sessions: summary.sessionCount,
      winSessionRate: summary.winSessionRate,
      avgPnlPct: summary.avgPnlPct,
      medianPnlPct: summary.medianPnlPct,
      avgRealizedPnl: summary.avgRealizedPnl,
      avgTradeWinRate: summary.avgTradeWinRate,
      avgMaxDrawdownPct: summary.avgMaxDrawdownPct,
      suggestedPolicy
    }
  })

  const priority = keyName === 'period' ? ['5m', '15m', '1d'] : []
  return stats
    .sort((left, right) => {
      if (priority.length > 0) {
        const leftIndex = priority.indexOf(left.key)
        const rightIndex = priority.indexOf(right.key)
        const leftRank = leftIndex >= 0 ? leftIndex : 99
        const rightRank = rightIndex >= 0 ? rightIndex : 99
        if (leftRank !== rightRank) return leftRank - rightRank
      }
      if (right.sessions !== left.sessions) return right.sessions - left.sessions
      return left.key.localeCompare(right.key)
    })
    .slice(0, 20)
}

interface TrendPolicySuggestionContext {
  defaultPolicy: ConflictPolicy
  codePolicyMap: Map<string, ConflictPolicy>
  periodPolicyMap: Map<string, ConflictPolicy>
}

const buildTrendPolicySuggestionContext = (): TrendPolicySuggestionContext => {
  const trend = getDatasetPolicyTrendReport(200) as Record<string, unknown>
  const trendAutoTuning = (trend.autoTuning || {}) as Record<string, unknown>
  const draftDefaultRaw = trendAutoTuning.defaultDraftPolicy
  const defaultPolicy: ConflictPolicy = draftDefaultRaw === 'keep_all' || draftDefaultRaw === 'single_best'
    ? draftDefaultRaw
    : 'single_best'
  const trendSegments = (trend.segmentAnalysis || {}) as Record<string, unknown>
  const byCodeTrend = Array.isArray(trendSegments.byCode) ? trendSegments.byCode as Array<Record<string, unknown>> : []
  const byPeriodTrend = Array.isArray(trendSegments.byPeriod) ? trendSegments.byPeriod as Array<Record<string, unknown>> : []

  const codePolicyMap = new Map<string, ConflictPolicy>()
  for (const item of byCodeTrend) {
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const policy = item.suggestedPolicy
    if (!key) continue
    if (policy === 'keep_all' || policy === 'single_best') {
      codePolicyMap.set(key, policy)
    }
  }

  const periodPolicyMap = new Map<string, ConflictPolicy>()
  for (const item of byPeriodTrend) {
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const policy = item.suggestedPolicy
    if (!key) continue
    if (policy === 'keep_all' || policy === 'single_best') {
      periodPolicyMap.set(key, policy)
    }
  }

  return { defaultPolicy, codePolicyMap, periodPolicyMap }
}

const getDatasetPolicyPnlAttributionReport = (limit?: number) => {
  const blindDatabase = getBlindDb()
  const maxLimit = Math.min(600, Math.max(1, Number(limit || 240)))
  const { defaultPolicy, codePolicyMap, periodPolicyMap } = buildTrendPolicySuggestionContext()

  const sessionRows = blindDatabase.prepare(`
    SELECT
      s.id AS session_id,
      s.stock_code AS stock_code,
      s.interval_type AS interval_type,
      s.started_at AS started_at,
      s.initial_capital AS initial_capital,
      s.final_capital AS final_capital,
      s.realized_pnl AS realized_pnl,
      r.realized_pnl_pct AS review_pnl_pct,
      r.trade_win_rate AS trade_win_rate,
      r.max_drawdown_pct AS max_drawdown_pct
    FROM training_sessions s
    LEFT JOIN session_reviews r ON r.session_id = s.id
    WHERE s.status = 'finished'
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(maxLimit) as Array<{
    session_id: string
    stock_code: string
    interval_type: string
    started_at: number
    initial_capital: number | null
    final_capital: number | null
    realized_pnl: number | null
    review_pnl_pct: number | null
    trade_win_rate: number | null
    max_drawdown_pct: number | null
  }>

  let matchedByCode = 0
  let matchedByPeriod = 0
  const normalizedRows: PolicyPnlSessionRow[] = sessionRows.map((row) => {
    const code = typeof row.stock_code === 'string' ? row.stock_code.trim() : ''
    const normalizedPeriod = normalizePeriodAlias(typeof row.interval_type === 'string' ? row.interval_type : '')
    const period = normalizedPeriod || (typeof row.interval_type === 'string' ? row.interval_type.trim() : '')
    const byCode = code ? codePolicyMap.get(code) : undefined
    const byPeriod = period ? periodPolicyMap.get(period) : undefined
    let policySource: 'code' | 'period' | 'default' | 'unknown' = 'unknown'
    let suggestedPolicy: PolicyOutcomeKey = 'unknown'
    if (byCode) {
      policySource = 'code'
      suggestedPolicy = byCode
      matchedByCode += 1
    } else if (byPeriod) {
      policySource = 'period'
      suggestedPolicy = byPeriod
      matchedByPeriod += 1
    } else {
      policySource = 'default'
      suggestedPolicy = defaultPolicy
    }

    const realizedPnl = typeof row.realized_pnl === 'number' && Number.isFinite(row.realized_pnl)
      ? row.realized_pnl
      : 0
    const reviewPnlPct = typeof row.review_pnl_pct === 'number' && Number.isFinite(row.review_pnl_pct)
      ? row.review_pnl_pct
      : null
    const initial = typeof row.initial_capital === 'number' && Number.isFinite(row.initial_capital) ? row.initial_capital : 0
    const final = typeof row.final_capital === 'number' && Number.isFinite(row.final_capital) ? row.final_capital : initial
    const fallbackPnlPct = initial > 0 ? ((final - initial) / initial) * 100 : 0
    return {
      sessionId: row.session_id,
      code,
      period,
      startedAt: toTimestampMillis(row.started_at),
      realizedPnl,
      realizedPnlPct: reviewPnlPct ?? fallbackPnlPct,
      tradeWinRate: typeof row.trade_win_rate === 'number' && Number.isFinite(row.trade_win_rate)
        ? row.trade_win_rate
        : 0,
      maxDrawdownPct: typeof row.max_drawdown_pct === 'number' && Number.isFinite(row.max_drawdown_pct)
        ? row.max_drawdown_pct
        : 0,
      suggestedPolicy,
      policySource
    }
  })

  const byPolicy = {
    keep_all: summarizePolicyPnlRows(normalizedRows.filter((row) => row.suggestedPolicy === 'keep_all')),
    single_best: summarizePolicyPnlRows(normalizedRows.filter((row) => row.suggestedPolicy === 'single_best')),
    unknown: summarizePolicyPnlRows(normalizedRows.filter((row) => row.suggestedPolicy === 'unknown'))
  }
  const byPeriod = toPolicyPnlSegmentStats(
    normalizedRows,
    (row) => row.period,
    'period',
    periodPolicyMap,
    defaultPolicy
  )
  const byCode = toPolicyPnlSegmentStats(
    normalizedRows,
    (row) => row.code,
    'code',
    codePolicyMap,
    defaultPolicy
  )

  const suggestions: string[] = []
  if (normalizedRows.length === 0) {
    suggestions.push('暂无盲训已结束会话，先完成若干盲训并结束会话后再查看收益归因。')
  } else {
    const coverage = normalizedRows.length > 0 ? (matchedByCode + matchedByPeriod) / normalizedRows.length : 0
    if (coverage < 0.5) {
      suggestions.push(`当前策略分层覆盖 ${(coverage * 100).toFixed(1)}% 会话，建议增加更多“分标的/分周期”的策略评估记录。`)
    }

    const keep = byPolicy.keep_all
    const single = byPolicy.single_best
    if (keep.sessionCount >= 5 && single.sessionCount >= 5) {
      const pnlGap = single.avgPnlPct - keep.avgPnlPct
      if (Math.abs(pnlGap) >= 1) {
        suggestions.push(
          pnlGap > 0
            ? `single_best 对应会话平均收益率高于 keep_all ${pnlGap.toFixed(2)}pct，可优先用于高冲突分层。`
            : `keep_all 对应会话平均收益率高于 single_best ${Math.abs(pnlGap).toFixed(2)}pct，可优先用于低冲突分层。`
        )
      }
    }

    const weakPeriod = byPeriod
      .filter((row) => row.sessions >= 3)
      .sort((left, right) => left.avgPnlPct - right.avgPnlPct)[0]
    if (weakPeriod) {
      suggestions.push(
        `${weakPeriod.key} 周期盲训平均收益率最低（${weakPeriod.avgPnlPct.toFixed(2)}%），建议优先复核该周期标签与策略默认值。`
      )
    }
  }

  return {
    success: true,
    generatedAt: Math.floor(Date.now() / 1000),
    totalSessions: normalizedRows.length,
    matchedByCode,
    matchedByPeriod,
    defaultPolicy,
    byPolicy,
    segmentPnl: {
      byCode,
      byPeriod
    },
    suggestions,
    latestSessions: normalizedRows.slice(0, 12)
  }
}

interface SignalTradingOutcomeRow {
  eventId: string
  code: string
  period: string
  signalType: string
  feedbackAction: 'accept' | 'modify' | 'ignore' | 'none'
  suggestedPolicy: PolicyOutcomeKey
  policySource: 'dataset' | 'code' | 'period' | 'default' | 'unknown'
  eventTimeMs: number
  matchedSessionId: string
  matchedSessionStartMs: number
  matchedPnlPct: number | null
  matchedTradeWinRate: number | null
  matchedMaxDrawdownPct: number | null
}

const summarizeSignalTradingOutcomeRows = (rows: SignalTradingOutcomeRow[]) => {
  const matchedRows = rows.filter((row) => row.matchedSessionId)
  const matchedPnlValues = matchedRows
    .map((row) => row.matchedPnlPct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const feedbackRows = rows.filter((row) => row.feedbackAction !== 'none')
  const actionableRows = rows.filter((row) => row.feedbackAction === 'accept' || row.feedbackAction === 'modify')
  const matchedActionableRows = actionableRows.filter((row) => row.matchedSessionId)

  return {
    eventCount: rows.length,
    feedbackEvents: feedbackRows.length,
    actionableEvents: actionableRows.length,
    matchedCount: matchedRows.length,
    coverage: rows.length > 0 ? matchedRows.length / rows.length : 0,
    actionableCoverage: actionableRows.length > 0 ? matchedActionableRows.length / actionableRows.length : 0,
    avgPnlPct: aggregateMean(matchedPnlValues),
    medianPnlPct: median(matchedPnlValues),
    winSessionRate: matchedPnlValues.length > 0
      ? matchedPnlValues.filter((value) => value > 0).length / matchedPnlValues.length
      : 0,
    avgTradeWinRate: aggregateMean(
      matchedRows
        .map((row) => row.matchedTradeWinRate)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    ),
    avgMaxDrawdownPct: aggregateMean(
      matchedRows
        .map((row) => row.matchedMaxDrawdownPct)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )
  }
}

const toSignalTradingSegmentStats = (
  rows: SignalTradingOutcomeRow[],
  keyResolver: (row: SignalTradingOutcomeRow) => string,
  keyName: 'code' | 'period',
  suggestionMap: Map<string, ConflictPolicy>,
  fallbackPolicy: ConflictPolicy
): Array<{
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
  suggestedPolicy: ConflictPolicy
}> => {
  const groups = new Map<string, SignalTradingOutcomeRow[]>()
  for (const row of rows) {
    const key = keyResolver(row)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const stats = Array.from(groups.entries()).map(([key, bucket]) => {
    const summary = summarizeSignalTradingOutcomeRows(bucket)
    const mappedPolicy = suggestionMap.get(key)
    const suggestedPolicy = mappedPolicy === 'keep_all' || mappedPolicy === 'single_best'
      ? mappedPolicy
      : fallbackPolicy
    return {
      key,
      ...summary,
      suggestedPolicy
    }
  })

  const priority = keyName === 'period' ? ['5m', '15m', '1d'] : []
  return stats
    .sort((left, right) => {
      if (priority.length > 0) {
        const leftIndex = priority.indexOf(left.key)
        const rightIndex = priority.indexOf(right.key)
        const leftRank = leftIndex >= 0 ? leftIndex : 99
        const rightRank = rightIndex >= 0 ? rightIndex : 99
        if (leftRank !== rightRank) return leftRank - rightRank
      }
      if (right.eventCount !== left.eventCount) return right.eventCount - left.eventCount
      return left.key.localeCompare(right.key)
    })
    .slice(0, 20)
}

const getDatasetPolicySignalTradingOutcomeReport = (limit?: number) => {
  const database = getDb()
  const blindDatabase = getBlindDb()
  const maxLimit = Math.min(1200, Math.max(1, Number(limit || 300)))
  const matchingWindowDays = 7
  const matchingWindowMs = matchingWindowDays * 24 * 60 * 60 * 1000
  const { defaultPolicy, codePolicyMap, periodPolicyMap } = buildTrendPolicySuggestionContext()

  const eventRows = database.prepare(`
    SELECT
      e.id AS event_id,
      e.code AS code,
      e.period AS period,
      e.signal_type AS signal_type,
      e.created_at AS created_at,
      e.bar_timestamp AS bar_timestamp,
      fb.action AS feedback_action,
      m.dataset_id AS dataset_id,
      (
        SELECT pe.selected_policy
        FROM dataset_policy_evaluations pe
        WHERE pe.applied_dataset_id = m.dataset_id
        ORDER BY pe.created_at DESC, pe.id DESC
        LIMIT 1
      ) AS selected_policy
    FROM signal_events e
    LEFT JOIN model_versions m ON m.id = e.model_id
    LEFT JOIN (
      SELECT f.signal_event_id, f.action
      FROM signal_feedback f
      WHERE f.id = (
        SELECT f2.id
        FROM signal_feedback f2
        WHERE f2.signal_event_id = f.signal_event_id
        ORDER BY f2.created_at DESC, f2.id DESC
        LIMIT 1
      )
    ) fb ON fb.signal_event_id = e.id
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(maxLimit) as Array<{
    event_id: string
    code: string
    period: string
    signal_type: string
    created_at: number
    bar_timestamp: number
    feedback_action: string | null
    dataset_id: string | null
    selected_policy: string | null
  }>

  const sessionRows = blindDatabase.prepare(`
    SELECT
      s.id AS session_id,
      s.stock_code AS stock_code,
      s.interval_type AS interval_type,
      s.started_at AS started_at,
      s.initial_capital AS initial_capital,
      s.final_capital AS final_capital,
      s.realized_pnl AS realized_pnl,
      r.realized_pnl_pct AS review_pnl_pct,
      r.trade_win_rate AS trade_win_rate,
      r.max_drawdown_pct AS max_drawdown_pct
    FROM training_sessions s
    LEFT JOIN session_reviews r ON r.session_id = s.id
    WHERE s.status = 'finished'
    ORDER BY s.started_at ASC
    LIMIT 2500
  `).all() as Array<{
    session_id: string
    stock_code: string
    interval_type: string
    started_at: number
    initial_capital: number | null
    final_capital: number | null
    realized_pnl: number | null
    review_pnl_pct: number | null
    trade_win_rate: number | null
    max_drawdown_pct: number | null
  }>

  const sessionBuckets = new Map<string, Array<{
    sessionId: string
    startedAtMs: number
    pnlPct: number
    tradeWinRate: number
    maxDrawdownPct: number
  }>>()
  for (const row of sessionRows) {
    const code = typeof row.stock_code === 'string' ? row.stock_code.trim() : ''
    const periodNormalized = normalizePeriodAlias(typeof row.interval_type === 'string' ? row.interval_type : '')
    const period = periodNormalized || (typeof row.interval_type === 'string' ? row.interval_type.trim() : '')
    if (!code || !period) continue
    const startedAtMs = toTimestampMillis(row.started_at)
    if (!startedAtMs) continue
    const reviewPnlPct = typeof row.review_pnl_pct === 'number' && Number.isFinite(row.review_pnl_pct)
      ? row.review_pnl_pct
      : null
    const initial = typeof row.initial_capital === 'number' && Number.isFinite(row.initial_capital) ? row.initial_capital : 0
    const final = typeof row.final_capital === 'number' && Number.isFinite(row.final_capital) ? row.final_capital : initial
    const fallbackPnlPct = initial > 0 ? ((final - initial) / initial) * 100 : 0
    const key = `${code}|${period}`
    const bucket = sessionBuckets.get(key)
    const item = {
      sessionId: row.session_id,
      startedAtMs,
      pnlPct: reviewPnlPct ?? fallbackPnlPct,
      tradeWinRate: typeof row.trade_win_rate === 'number' && Number.isFinite(row.trade_win_rate) ? row.trade_win_rate : 0,
      maxDrawdownPct: typeof row.max_drawdown_pct === 'number' && Number.isFinite(row.max_drawdown_pct) ? row.max_drawdown_pct : 0
    }
    if (bucket) bucket.push(item)
    else sessionBuckets.set(key, [item])
  }

  const normalizedRows: SignalTradingOutcomeRow[] = eventRows.map((row) => {
    const code = typeof row.code === 'string' ? row.code.trim() : ''
    const normalizedPeriod = normalizePeriodAlias(typeof row.period === 'string' ? row.period : '')
    const period = normalizedPeriod || (typeof row.period === 'string' ? row.period.trim() : '')
    const feedbackAction = row.feedback_action === 'accept' || row.feedback_action === 'modify' || row.feedback_action === 'ignore'
      ? row.feedback_action
      : 'none'
    const datasetPolicy = normalizePolicyOutcome(row.selected_policy)
    const codePolicy = code ? codePolicyMap.get(code) : undefined
    const periodPolicy = period ? periodPolicyMap.get(period) : undefined

    let policySource: 'dataset' | 'code' | 'period' | 'default' | 'unknown' = 'unknown'
    let suggestedPolicy: PolicyOutcomeKey = 'unknown'
    if (datasetPolicy === 'keep_all' || datasetPolicy === 'single_best') {
      policySource = 'dataset'
      suggestedPolicy = datasetPolicy
    } else if (codePolicy) {
      policySource = 'code'
      suggestedPolicy = codePolicy
    } else if (periodPolicy) {
      policySource = 'period'
      suggestedPolicy = periodPolicy
    } else {
      policySource = 'default'
      suggestedPolicy = defaultPolicy
    }

    const anchorTimestamp = typeof row.bar_timestamp === 'number' && Number.isFinite(row.bar_timestamp) && row.bar_timestamp > 0
      ? row.bar_timestamp
      : row.created_at
    const eventTimeMs = toTimestampMillis(anchorTimestamp)
    const key = `${code}|${period}`
    const sessionBucket = sessionBuckets.get(key) || []
    let matchedSessionId = ''
    let matchedSessionStartMs = 0
    let matchedPnlPct: number | null = null
    let matchedTradeWinRate: number | null = null
    let matchedMaxDrawdownPct: number | null = null

    if (eventTimeMs > 0 && sessionBucket.length > 0) {
      let bestDelta = Number.POSITIVE_INFINITY
      for (const session of sessionBucket) {
        const delta = session.startedAtMs - eventTimeMs
        if (delta < 0) continue
        if (delta > matchingWindowMs) break
        if (delta < bestDelta) {
          bestDelta = delta
          matchedSessionId = session.sessionId
          matchedSessionStartMs = session.startedAtMs
          matchedPnlPct = session.pnlPct
          matchedTradeWinRate = session.tradeWinRate
          matchedMaxDrawdownPct = session.maxDrawdownPct
        }
      }
    }

    return {
      eventId: row.event_id,
      code,
      period,
      signalType: typeof row.signal_type === 'string' ? row.signal_type : '',
      feedbackAction,
      suggestedPolicy,
      policySource,
      eventTimeMs,
      matchedSessionId,
      matchedSessionStartMs,
      matchedPnlPct,
      matchedTradeWinRate,
      matchedMaxDrawdownPct
    }
  })

  const byFeedbackAction = {
    accept: summarizeSignalTradingOutcomeRows(normalizedRows.filter((row) => row.feedbackAction === 'accept')),
    modify: summarizeSignalTradingOutcomeRows(normalizedRows.filter((row) => row.feedbackAction === 'modify')),
    ignore: summarizeSignalTradingOutcomeRows(normalizedRows.filter((row) => row.feedbackAction === 'ignore')),
    none: summarizeSignalTradingOutcomeRows(normalizedRows.filter((row) => row.feedbackAction === 'none'))
  }
  const byPolicy = {
    keep_all: summarizeSignalTradingOutcomeRows(normalizedRows.filter((row) => row.suggestedPolicy === 'keep_all')),
    single_best: summarizeSignalTradingOutcomeRows(normalizedRows.filter((row) => row.suggestedPolicy === 'single_best')),
    unknown: summarizeSignalTradingOutcomeRows(normalizedRows.filter((row) => row.suggestedPolicy === 'unknown'))
  }
  const byPeriod = toSignalTradingSegmentStats(
    normalizedRows,
    (row) => row.period,
    'period',
    periodPolicyMap,
    defaultPolicy
  )
  const byCode = toSignalTradingSegmentStats(
    normalizedRows,
    (row) => row.code,
    'code',
    codePolicyMap,
    defaultPolicy
  )

  const overall = summarizeSignalTradingOutcomeRows(normalizedRows)
  const suggestions: string[] = []
  if (overall.eventCount === 0) {
    suggestions.push('暂无提醒事件，先执行一次盘中推理并产生提醒记录。')
  } else {
    if (overall.feedbackEvents === 0) {
      suggestions.push('当前提醒尚无人工反馈，建议优先对提醒执行采纳/忽略/修正，以便闭环评估。')
    }
    if (overall.actionableEvents > 0 && overall.actionableCoverage < 0.35) {
      suggestions.push(`提醒到盲训会话匹配覆盖仅 ${(overall.actionableCoverage * 100).toFixed(1)}%，建议增加同标的同周期盲训样本以提升归因可信度。`)
    }
    const acceptStats = byFeedbackAction.accept
    const ignoreStats = byFeedbackAction.ignore
    if (acceptStats.matchedCount >= 3 && ignoreStats.matchedCount >= 3) {
      const pnlGap = acceptStats.avgPnlPct - ignoreStats.avgPnlPct
      if (Math.abs(pnlGap) >= 1) {
        suggestions.push(
          pnlGap > 0
            ? `采纳提醒对应会话平均收益率高于忽略提醒 ${pnlGap.toFixed(2)}pct，说明提醒有正向参考价值。`
            : `忽略提醒对应会话平均收益率高于采纳提醒 ${Math.abs(pnlGap).toFixed(2)}pct，建议复核当前提醒阈值与策略。`
        )
      }
    }
    const weakPeriod = byPeriod
      .filter((row) => row.matchedCount >= 3)
      .sort((left, right) => left.avgPnlPct - right.avgPnlPct)[0]
    if (weakPeriod) {
      suggestions.push(
        `${weakPeriod.key} 周期提醒闭环收益偏弱（平均 ${weakPeriod.avgPnlPct.toFixed(2)}%），建议优先优化该周期策略与阈值。`
      )
    }
  }

  const latestMatches = normalizedRows
    .filter((row) => row.matchedSessionId)
    .slice(0, 20)

  return {
    success: true,
    generatedAt: Math.floor(Date.now() / 1000),
    matchingWindowDays,
    totalEvents: overall.eventCount,
    feedbackEvents: overall.feedbackEvents,
    actionableEvents: overall.actionableEvents,
    matchedSessions: overall.matchedCount,
    coverage: {
      eventCoverage: overall.coverage,
      actionableCoverage: overall.actionableCoverage
    },
    byFeedbackAction,
    byPolicy,
    segmentOutcome: {
      byCode,
      byPeriod
    },
    suggestions,
    latestMatches
  }
}

const createDatasetDraft = (input: {
  name?: string
  description?: string
  code?: string
  period?: string
  sourceStrategy?: string
  outcomeFilter?: 'all' | 'qualified_only'
  limit?: number
  conflictPolicy?: 'keep_all' | 'single_best'
}) => {
  const database = getDb()
  const now = Math.floor(Date.now() / 1000)
  const datasetId = `dataset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const dateTag = new Date().toISOString().slice(2, 10).replace(/-/g, '')
  const strategyTag = input.sourceStrategy?.trim() || '候选'
  const datasetName = input.name?.trim() || `${strategyTag}草稿-${dateTag}-${Math.random().toString(36).slice(2, 5)}`
  const conflictPolicy = input.conflictPolicy === 'single_best' ? 'single_best' : 'keep_all'
  const outcomeFilter = input.outcomeFilter === 'qualified_only' ? 'qualified_only' : 'all'
  const whereParts: string[] = ["status = 'accepted'"]
  const values: Array<string | number> = []

  if (input.code && input.code.trim()) {
    whereParts.push('code = ?')
    values.push(input.code.trim())
  }
  if (input.period && input.period.trim()) {
    whereParts.push('period = ?')
    values.push(input.period.trim())
  }
  if (input.sourceStrategy && input.sourceStrategy.trim()) {
    whereParts.push('source_strategy = ?')
    values.push(input.sourceStrategy.trim())
  }
  if (outcomeFilter === 'qualified_only') {
    whereParts.push(`(
      COALESCE(json_extract(payload, '$.outcome_tag'), '') LIKE '%_qualified'
      OR COALESCE(json_extract(payload, '$.outcome_tag'), '') = ''
    )`)
  }
  const limit = Math.min(3000, Math.max(1, Number(input.limit || 800)))

  const sourceFilter = JSON.stringify({
    status: 'accepted',
    code: input.code?.trim() || null,
    period: input.period?.trim() || null,
    sourceStrategy: input.sourceStrategy?.trim() || null,
    outcomeFilter,
    conflictPolicy,
    limit
  })

  database.prepare(`
    INSERT INTO dataset_versions (id, name, status, description, source_filter, sample_count, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, 0, ?, ?)
  `).run(datasetId, datasetName, input.description || null, sourceFilter, now, now)

  const candidates = database.prepare(`
    SELECT id, code, period, bar_timestamp, signal_type, factor_type, score
    FROM signal_candidates
    WHERE ${whereParts.join(' AND ')}
    ORDER BY bar_timestamp ASC, score DESC, created_at ASC
    LIMIT ?
  `).all(...values, limit) as Array<{
    id: string
    code: string
    period: string
    bar_timestamp: number
    signal_type: 'buy' | 'sell'
    factor_type: string | null
    score: number
  }>

  const barBuckets = new Map<string, Array<{
    id: string
    code: string
    period: string
    bar_timestamp: number
    signal_type: 'buy' | 'sell'
    factor_type: string | null
    score: number
  }>>()
  for (const candidate of candidates) {
    if (!candidate) continue
    const key = `${candidate.code}|${candidate.period}|${candidate.bar_timestamp}`
    const bucket = barBuckets.get(key)
    if (bucket) bucket.push(candidate)
    else barBuckets.set(key, [candidate])
  }

  const conflictBarCount = Array.from(barBuckets.values()).filter((bucket) => bucket.length > 1).length
  const sameBarMultiLabelCount = Array.from(barBuckets.values()).filter((bucket) => {
    if (bucket.length <= 1) return false
    return new Set(bucket.map((item) => item.signal_type)).size > 1
  }).length
  const keepAllCount = candidates.length
  const singleBestCount = barBuckets.size
  const recommendedPolicy = recommendConflictPolicy(conflictBarCount, sameBarMultiLabelCount, singleBestCount)

  let selectedCandidates = candidates
  if (conflictPolicy === 'single_best') {
    const bestByBar = new Map<string, {
      id: string
      code: string
      period: string
      bar_timestamp: number
      signal_type: 'buy' | 'sell'
      factor_type: string | null
      score: number
    }>()
    for (const candidate of candidates) {
      if (!candidate) continue
      const key = `${candidate.code}|${candidate.period}|${candidate.bar_timestamp}`
      const existed = bestByBar.get(key)
      if (!existed || Number(candidate.score || 0) > Number(existed.score || 0)) {
        bestByBar.set(key, candidate)
      }
    }
    selectedCandidates = Array.from(bestByBar.values())
      .sort((a, b) => a.bar_timestamp - b.bar_timestamp)
      .slice(0, limit)
  }

  for (let index = 0; index < selectedCandidates.length; index++) {
    const candidate = selectedCandidates[index]
    if (!candidate) continue
    database.prepare(`
      INSERT OR IGNORE INTO dataset_items (
        id, dataset_id, candidate_id, code, period, bar_timestamp, label_type, factor_type, source, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate_review', ?)
    `).run(
      `ds_item_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
      datasetId,
      candidate.id,
      candidate.code,
      candidate.period,
      candidate.bar_timestamp,
      candidate.signal_type,
      candidate.factor_type,
      now
    )
  }

  const sampleCount = recountDatasetItems(datasetId)
  const evaluationId = recordDatasetPolicyEvaluation({
    mode: 'draft_preview',
    filters: {
      code: input.code?.trim() || null,
      period: input.period?.trim() || null,
      sourceStrategy: input.sourceStrategy?.trim() || null,
      outcomeFilter,
      limit
    },
    summary: {
      keepAllCount,
      singleBestCount,
      conflictBarCount,
      sameBarMultiLabelCount,
      outputSampleCount: sampleCount
    },
    recommendedPolicy,
    selectedPolicy: conflictPolicy,
    appliedDatasetId: datasetId
  })
  const dataset = database.prepare('SELECT * FROM dataset_versions WHERE id = ? LIMIT 1').get(datasetId) as Record<string, unknown> | undefined
  if (!dataset) {
    return { id: datasetId, importedCount: sampleCount, conflictPolicy, recommendedPolicy, evaluationId }
  }
  return { ...dataset, importedCount: sampleCount, conflictPolicy, recommendedPolicy, evaluationId }
}

const previewDatasetDraftPolicies = (input: {
  code?: string
  period?: string
  sourceStrategy?: string
  outcomeFilter?: 'all' | 'qualified_only'
  limit?: number
}) => {
  const database = getDb()
  const whereParts: string[] = ["status = 'accepted'"]
  const outcomeFilter = input.outcomeFilter === 'qualified_only' ? 'qualified_only' : 'all'
  const values: Array<string | number> = []
  if (input.code && input.code.trim()) {
    whereParts.push('code = ?')
    values.push(input.code.trim())
  }
  if (input.period && input.period.trim()) {
    whereParts.push('period = ?')
    values.push(input.period.trim())
  }
  if (input.sourceStrategy && input.sourceStrategy.trim()) {
    whereParts.push('source_strategy = ?')
    values.push(input.sourceStrategy.trim())
  }
  if (outcomeFilter === 'qualified_only') {
    whereParts.push(`(
      COALESCE(json_extract(payload, '$.outcome_tag'), '') LIKE '%_qualified'
      OR COALESCE(json_extract(payload, '$.outcome_tag'), '') = ''
    )`)
  }
  const limit = Math.min(3000, Math.max(1, Number(input.limit || 800)))

  const candidates = database.prepare(`
    SELECT id, code, period, bar_timestamp, signal_type, factor_type, score
    FROM signal_candidates
    WHERE ${whereParts.join(' AND ')}
    ORDER BY bar_timestamp ASC, score DESC, created_at ASC
    LIMIT ?
  `).all(...values, limit) as Array<{
    id: string
    code: string
    period: string
    bar_timestamp: number
    signal_type: 'buy' | 'sell'
    factor_type: string | null
    score: number
  }>

  const barBuckets = new Map<string, Array<{
    id: string
    code: string
    period: string
    bar_timestamp: number
    signal_type: 'buy' | 'sell'
    factor_type: string | null
    score: number
  }>>()
  for (const candidate of candidates) {
    if (!candidate) continue
    const key = `${candidate.code}|${candidate.period}|${candidate.bar_timestamp}`
    const bucket = barBuckets.get(key)
    if (bucket) bucket.push(candidate)
    else barBuckets.set(key, [candidate])
  }

  let conflictBarCount = 0
  let sameBarMultiLabelCount = 0
  const conflictPreview: Array<{
    code: string
    period: string
    bar_timestamp: number
    candidate_count: number
    label_types: string
    recommended_label: string
  }> = []

  for (const bucket of barBuckets.values()) {
    if (bucket.length <= 1) continue
    const labelTypes = Array.from(new Set(bucket.map((item) => item.signal_type)))
    if (labelTypes.length > 1) sameBarMultiLabelCount += 1
    conflictBarCount += 1
    const best = [...bucket].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0]
    const first = bucket[0]
    if (!best || !first) continue
    conflictPreview.push({
      code: first.code,
      period: first.period,
      bar_timestamp: first.bar_timestamp,
      candidate_count: bucket.length,
      label_types: labelTypes.join('/'),
      recommended_label: best.signal_type
    })
  }

  const recommendedPolicy = recommendConflictPolicy(conflictBarCount, sameBarMultiLabelCount, barBuckets.size)
  const summary = {
    keepAllCount: candidates.length,
    singleBestCount: barBuckets.size,
    conflictBarCount,
    sameBarMultiLabelCount,
    conflictPreview: conflictPreview
      .sort((a, b) => a.bar_timestamp - b.bar_timestamp)
      .slice(-20)
  }
  const filters = {
    code: input.code?.trim() || null,
    period: input.period?.trim() || null,
    sourceStrategy: input.sourceStrategy?.trim() || null,
    outcomeFilter,
    limit
  }
  const evaluationId = recordDatasetPolicyEvaluation({
    mode: 'draft_preview',
    filters,
    summary,
    recommendedPolicy
  })

  return {
    success: true,
    filters,
    recommendedPolicy,
    evaluationId,
    ...summary
  }
}

const freezeDataset = (datasetId: string) => {
  const database = getDb()
  const now = Math.floor(Date.now() / 1000)

  const dataset = database.prepare('SELECT * FROM dataset_versions WHERE id = ? LIMIT 1').get(datasetId) as
    | { id: string; status: string; source_filter: string | null }
    | undefined
  if (!dataset || dataset.status !== 'draft') return null

  const items = database.prepare(`
    SELECT di.code, di.period, di.label_type, di.factor_type, sc.source_strategy, sc.payload
    FROM dataset_items di
    LEFT JOIN signal_candidates sc ON di.candidate_id = sc.id
    WHERE di.dataset_id = ?
  `).all(datasetId) as Array<{
    code: string
    period: string
    label_type: string
    factor_type: string | null
    source_strategy: string | null
    payload: string | null
  }>

  const strategyCounts: Record<string, number> = {}
  const factorCounts: Record<string, number> = {}
  const labelCounts: Record<string, number> = {}
  const periodCounts: Record<string, number> = {}
  for (const item of items) {
    const strategy = item.source_strategy || 'unknown'
    strategyCounts[strategy] = (strategyCounts[strategy] || 0) + 1
    if (item.factor_type) factorCounts[item.factor_type] = (factorCounts[item.factor_type] || 0) + 1
    labelCounts[item.label_type] = (labelCounts[item.label_type] || 0) + 1
    periodCounts[item.period] = (periodCounts[item.period] || 0) + 1
  }

  let sourceFilter: Record<string, unknown> | null = null
  if (dataset.source_filter) {
    try { sourceFilter = JSON.parse(dataset.source_filter) } catch { /* ignore */ }
  }

  const labelPolicy = {
    frozen_at: new Date(now * 1000).toISOString(),
    total_items: items.length,
    strategy_distribution: strategyCounts,
    factor_distribution: factorCounts,
    label_distribution: labelCounts,
    period_distribution: periodCounts,
    source_filter: sourceFilter
  }

  database.prepare(`
    UPDATE dataset_versions
    SET status = 'frozen', frozen_at = ?, updated_at = ?, label_policy_json = ?
    WHERE id = ? AND status = 'draft'
  `).run(now, now, JSON.stringify(labelPolicy), datasetId)

  return database.prepare('SELECT * FROM dataset_versions WHERE id = ? LIMIT 1').get(datasetId)
}

const deleteDraftDataset = (datasetId: string) => {
  const id = datasetId.trim()
  if (!id) return { success: false, reason: 'invalid_dataset_id' }

  const database = getDb()
  const dataset = database.prepare(`
    SELECT id, name, status
    FROM dataset_versions
    WHERE id = ?
    LIMIT 1
  `).get(id) as { id: string; name: string; status: string } | undefined

  if (!dataset) return { success: false, reason: 'dataset_not_found', datasetId: id }
  if (dataset.status === 'frozen') return { success: false, reason: 'dataset_frozen', datasetId: id }
  if (dataset.status !== 'draft') return { success: false, reason: 'dataset_not_draft', datasetId: id, status: dataset.status }

  const relationCount = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM feature_build_tasks WHERE dataset_id = ?) AS feature_task_count,
      (SELECT COUNT(*) FROM model_training_tasks WHERE dataset_id = ?) AS model_task_count,
      (SELECT COUNT(*) FROM model_versions WHERE dataset_id = ?) AS model_version_count
  `).get(id, id, id) as {
    feature_task_count?: number
    model_task_count?: number
    model_version_count?: number
  } | undefined
  const featureTaskCount = Number(relationCount?.feature_task_count || 0)
  const modelTaskCount = Number(relationCount?.model_task_count || 0)
  const modelVersionCount = Number(relationCount?.model_version_count || 0)
  if (featureTaskCount > 0 || modelTaskCount > 0 || modelVersionCount > 0) {
    return {
      success: false,
      reason: 'dataset_in_use',
      datasetId: id,
      featureTaskCount,
      modelTaskCount,
      modelVersionCount,
    }
  }

  const deletedItems = Number((database.prepare('SELECT COUNT(*) AS count FROM dataset_items WHERE dataset_id = ?').get(id) as { count?: number } | undefined)?.count || 0)
  let deletedDatasets = 0
  try {
    const deleteTransaction = database.transaction(() => {
      database.prepare('DELETE FROM dataset_items WHERE dataset_id = ?').run(id)
      const datasetDeleteResult = database.prepare(`
        DELETE FROM dataset_versions
        WHERE id = ? AND status = 'draft'
      `).run(id)
      return datasetDeleteResult.changes
    })
    deletedDatasets = Number(deleteTransaction() || 0)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'delete_transaction_error'
    if (message.includes('FOREIGN KEY constraint failed')) {
      return { success: false, reason: 'dataset_in_use', datasetId: id }
    }
    return { success: false, reason: 'delete_exception', datasetId: id, message }
  }
  if (deletedDatasets <= 0) return { success: false, reason: 'delete_failed', datasetId: id }

  return {
    success: true,
    datasetId: id,
    datasetName: dataset.name,
    deletedItems,
  }
}

interface DatasetItemRow {
  code: string
  period: string
  bar_timestamp: number
  label_type: string
  factor_type?: string | null
  candidate_id?: string | null
  source?: string | null
}

const datasetItemKey = (row: DatasetItemRow): string => {
  return `${row.code}|${row.period}|${row.bar_timestamp}|${row.label_type}`
}

const toCountMap = (rows: DatasetItemRow[], keyResolver: (row: DatasetItemRow) => string): Record<string, number> => {
  const result: Record<string, number> = {}
  for (const row of rows) {
    const key = keyResolver(row)
    if (!key) continue
    result[key] = (result[key] || 0) + 1
  }
  return result
}

const compareDatasets = (leftDatasetId: string, rightDatasetId: string) => {
  const leftId = leftDatasetId.trim()
  const rightId = rightDatasetId.trim()
  if (!leftId || !rightId) return { success: false, reason: 'invalid_dataset_id' }
  if (leftId === rightId) return { success: false, reason: 'same_dataset' }

  const database = getDb()
  const leftDataset = database.prepare('SELECT id, name, status, sample_count FROM dataset_versions WHERE id = ? LIMIT 1').get(leftId) as Record<string, unknown> | undefined
  const rightDataset = database.prepare('SELECT id, name, status, sample_count FROM dataset_versions WHERE id = ? LIMIT 1').get(rightId) as Record<string, unknown> | undefined
  if (!leftDataset || !rightDataset) return { success: false, reason: 'dataset_not_found' }

  const leftRows = database.prepare(`
    SELECT code, period, bar_timestamp, label_type, factor_type
    FROM dataset_items
    WHERE dataset_id = ?
    ORDER BY bar_timestamp ASC
  `).all(leftId) as DatasetItemRow[]
  const rightRows = database.prepare(`
    SELECT code, period, bar_timestamp, label_type, factor_type
    FROM dataset_items
    WHERE dataset_id = ?
    ORDER BY bar_timestamp ASC
  `).all(rightId) as DatasetItemRow[]

  const leftMap = new Map<string, DatasetItemRow>()
  const rightMap = new Map<string, DatasetItemRow>()
  for (const row of leftRows) leftMap.set(datasetItemKey(row), row)
  for (const row of rightRows) rightMap.set(datasetItemKey(row), row)

  const leftOnly: DatasetItemRow[] = []
  const rightOnly: DatasetItemRow[] = []
  let intersectionCount = 0

  for (const [key, row] of leftMap.entries()) {
    if (rightMap.has(key)) intersectionCount += 1
    else leftOnly.push(row)
  }
  for (const [key, row] of rightMap.entries()) {
    if (!leftMap.has(key)) rightOnly.push(row)
  }

  const leftCount = leftRows.length
  const rightCount = rightRows.length
  const unionCount = leftCount + rightCount - intersectionCount
  const overlapRatio = unionCount > 0 ? intersectionCount / unionCount : 1

  const leftBarLabels = new Map<string, Set<string>>()
  const rightBarLabels = new Map<string, Set<string>>()
  for (const row of leftRows) {
    const key = `${row.code}|${row.period}|${row.bar_timestamp}`
    const labels = leftBarLabels.get(key) || new Set<string>()
    labels.add(row.label_type)
    leftBarLabels.set(key, labels)
  }
  for (const row of rightRows) {
    const key = `${row.code}|${row.period}|${row.bar_timestamp}`
    const labels = rightBarLabels.get(key) || new Set<string>()
    labels.add(row.label_type)
    rightBarLabels.set(key, labels)
  }

  let overlapBarCount = 0
  let sameLabelBarCount = 0
  let conflictingBarCount = 0
  let multiLabelConflictBarCount = 0
  for (const [key, leftLabels] of leftBarLabels.entries()) {
    const rightLabels = rightBarLabels.get(key)
    if (!rightLabels) continue
    overlapBarCount += 1
    const leftArray = Array.from(leftLabels).sort()
    const rightArray = Array.from(rightLabels).sort()
    const leftKey = leftArray.join('|')
    const rightKey = rightArray.join('|')
    if (leftKey === rightKey) {
      sameLabelBarCount += 1
      continue
    }
    conflictingBarCount += 1
    const unionLabelCount = new Set([...leftArray, ...rightArray]).size
    if (unionLabelCount > 1) multiLabelConflictBarCount += 1
  }

  const recommendedPolicy = recommendConflictPolicy(conflictingBarCount, multiLabelConflictBarCount, Math.max(overlapBarCount, 1))
  const summary = {
    leftCount,
    rightCount,
    intersectionCount,
    leftOnlyCount: leftOnly.length,
    rightOnlyCount: rightOnly.length,
    overlapRatio,
    overlapBarCount,
    sameLabelBarCount,
    conflictingBarCount,
    multiLabelConflictBarCount
  }
  const evaluationId = recordDatasetPolicyEvaluation({
    mode: 'dataset_compare',
    leftDatasetId: leftId,
    rightDatasetId: rightId,
    summary,
    recommendedPolicy
  })

  return {
    success: true,
    leftDataset,
    rightDataset,
    summary,
    recommendedPolicy,
    evaluationId,
    distributions: {
      leftLabelType: toCountMap(leftRows, (row) => row.label_type),
      rightLabelType: toCountMap(rightRows, (row) => row.label_type),
      leftPeriod: toCountMap(leftRows, (row) => row.period),
      rightPeriod: toCountMap(rightRows, (row) => row.period)
    },
    leftOnlyPreview: leftOnly.slice(-20),
    rightOnlyPreview: rightOnly.slice(-20)
  }
}

const rollbackDatasetToDraft = (sourceDatasetId: string, draftName?: string) => {
  const sourceId = sourceDatasetId.trim()
  if (!sourceId) return { success: false, reason: 'invalid_dataset_id' }
  const database = getDb()
  const sourceDataset = database.prepare(`
    SELECT id, name, status, source_filter
    FROM dataset_versions
    WHERE id = ?
    LIMIT 1
  `).get(sourceId) as {
    id: string
    name: string
    status: string
    source_filter?: string | null
  } | undefined

  if (!sourceDataset) return { success: false, reason: 'dataset_not_found', sourceDatasetId: sourceId }
  if (sourceDataset.status !== 'frozen') return { success: false, reason: 'source_not_frozen', sourceDatasetId: sourceId }

  const now = Math.floor(Date.now() / 1000)
  const targetDatasetId = `dataset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const dateTag = new Date().toISOString().slice(2, 10).replace(/-/g, '')
  const targetDatasetName = draftName?.trim() || `${sourceDataset.name}-回滚-${dateTag}`
  const rollbackFilter = JSON.stringify({
    mode: 'rollback_clone',
    sourceDatasetId: sourceId,
    inheritedFilter: sourceDataset.source_filter || null
  })

  database.prepare(`
    INSERT INTO dataset_versions (id, name, status, description, source_filter, sample_count, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, 0, ?, ?)
  `).run(
    targetDatasetId,
    targetDatasetName,
    `Rollback clone from ${sourceId}`,
    rollbackFilter,
    now,
    now
  )

  const sourceItems = database.prepare(`
    SELECT candidate_id, code, period, bar_timestamp, label_type, factor_type, source
    FROM dataset_items
    WHERE dataset_id = ?
    ORDER BY bar_timestamp ASC
  `).all(sourceId) as DatasetItemRow[]

  for (let index = 0; index < sourceItems.length; index++) {
    const item = sourceItems[index]
    if (!item) continue
    database.prepare(`
      INSERT OR IGNORE INTO dataset_items (
        id, dataset_id, candidate_id, code, period, bar_timestamp, label_type, factor_type, source, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `ds_item_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
      targetDatasetId,
      item.candidate_id || null,
      item.code,
      item.period,
      item.bar_timestamp,
      item.label_type,
      item.factor_type || null,
      item.source || 'dataset_rollback',
      now
    )
  }

  const importedCount = recountDatasetItems(targetDatasetId)
  const dataset = database.prepare('SELECT * FROM dataset_versions WHERE id = ? LIMIT 1').get(targetDatasetId)
  return {
    success: true,
    sourceDatasetId: sourceId,
    dataset,
    importedCount
  }
}

const mergeDatasetsToDraft = (leftDatasetId: string, rightDatasetId: string, input?: {
  name?: string
  conflictPolicy?: 'keep_all' | 'single_best'
}) => {
  const leftId = leftDatasetId.trim()
  const rightId = rightDatasetId.trim()
  if (!leftId || !rightId) return { success: false, reason: 'invalid_dataset_id' }
  if (leftId === rightId) return { success: false, reason: 'same_dataset' }
  const selectedPolicy = input?.conflictPolicy === 'single_best' ? 'single_best' : (input?.conflictPolicy === 'keep_all' ? 'keep_all' : null)

  const database = getDb()
  const leftDataset = database.prepare('SELECT id, name, status FROM dataset_versions WHERE id = ? LIMIT 1').get(leftId) as {
    id: string
    name: string
    status: string
  } | undefined
  const rightDataset = database.prepare('SELECT id, name, status FROM dataset_versions WHERE id = ? LIMIT 1').get(rightId) as {
    id: string
    name: string
    status: string
  } | undefined
  if (!leftDataset || !rightDataset) return { success: false, reason: 'dataset_not_found' }
  if (leftDataset.status !== 'frozen' || rightDataset.status !== 'frozen') return { success: false, reason: 'dataset_not_frozen' }

  const now = Math.floor(Date.now() / 1000)
  const datasetId = `dataset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const dateTag = new Date().toISOString().slice(2, 10).replace(/-/g, '')
  const fallbackName = `合并-${leftDataset.name}-${rightDataset.name}-${dateTag}`
  const datasetName = input?.name?.trim() || fallbackName
  const sourceFilter = JSON.stringify({
    mode: 'merge_datasets',
    leftDatasetId: leftId,
    rightDatasetId: rightId,
    conflictPolicy: selectedPolicy || 'auto'
  })

  database.prepare(`
    INSERT INTO dataset_versions (id, name, status, description, source_filter, sample_count, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, 0, ?, ?)
  `).run(
    datasetId,
    datasetName,
    `Merged from ${leftId} + ${rightId}`,
    sourceFilter,
    now,
    now
  )

  const rows = database.prepare(`
    SELECT
      i.dataset_id,
      i.candidate_id,
      i.code,
      i.period,
      i.bar_timestamp,
      i.label_type,
      i.factor_type,
      i.source,
      COALESCE(c.score, 0) AS candidate_score
    FROM dataset_items i
    LEFT JOIN signal_candidates c ON c.id = i.candidate_id
    WHERE i.dataset_id IN (?, ?)
    ORDER BY i.bar_timestamp ASC
  `).all(leftId, rightId) as Array<{
    dataset_id: string
    candidate_id?: string | null
    code: string
    period: string
    bar_timestamp: number
    label_type: string
    factor_type?: string | null
    source?: string | null
    candidate_score: number
  }>

  const byBar = new Map<string, Array<{
    dataset_id: string
    candidate_id?: string | null
    code: string
    period: string
    bar_timestamp: number
    label_type: string
    factor_type?: string | null
    source?: string | null
    candidate_score: number
  }>>()
  for (const row of rows) {
    if (!row) continue
    const key = `${row.code}|${row.period}|${row.bar_timestamp}`
    const bucket = byBar.get(key)
    if (bucket) bucket.push(row)
    else byBar.set(key, [row])
  }
  const conflictBarCount = Array.from(byBar.values()).filter((bucket) => bucket.length > 1).length
  const sameBarMultiLabelCount = Array.from(byBar.values()).filter((bucket) => {
    if (bucket.length <= 1) return false
    return new Set(bucket.map((item) => item.label_type)).size > 1
  }).length
  const recommendedPolicy = recommendConflictPolicy(conflictBarCount, sameBarMultiLabelCount, Math.max(byBar.size, 1))
  const conflictPolicy = selectedPolicy || recommendedPolicy
  database.prepare(`
    UPDATE dataset_versions
    SET source_filter = ?, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify({
      mode: 'merge_datasets',
      leftDatasetId: leftId,
      rightDatasetId: rightId,
      conflictPolicy
    }),
    now,
    datasetId
  )

  let selectedRows = rows
  if (conflictPolicy === 'single_best') {
    selectedRows = Array.from(byBar.values()).map((bucket) => {
      const ranked = [...bucket].sort((a, b) => {
        const scoreDelta = Number(b.candidate_score || 0) - Number(a.candidate_score || 0)
        if (scoreDelta !== 0) return scoreDelta
        const aRank = a.dataset_id === leftId ? 0 : 1
        const bRank = b.dataset_id === leftId ? 0 : 1
        return aRank - bRank
      })
      return ranked[0]!
    })
  }

  for (let index = 0; index < selectedRows.length; index++) {
    const row = selectedRows[index]
    if (!row) continue
    database.prepare(`
      INSERT OR IGNORE INTO dataset_items (
        id, dataset_id, candidate_id, code, period, bar_timestamp, label_type, factor_type, source, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `ds_item_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
      datasetId,
      row.candidate_id || null,
      row.code,
      row.period,
      row.bar_timestamp,
      row.label_type,
      row.factor_type || null,
      row.source || 'dataset_merge',
      now
    )
  }

  const importedCount = recountDatasetItems(datasetId)
  const evaluationId = recordDatasetPolicyEvaluation({
    mode: 'dataset_merge',
    leftDatasetId: leftId,
    rightDatasetId: rightId,
    summary: {
      rawRowCount: rows.length,
      barCount: byBar.size,
      conflictBarCount,
      sameBarMultiLabelCount,
      importedCount
    },
    recommendedPolicy,
    selectedPolicy: conflictPolicy,
    appliedDatasetId: datasetId
  })
  const dataset = database.prepare('SELECT * FROM dataset_versions WHERE id = ? LIMIT 1').get(datasetId)
  return {
    success: true,
    dataset,
    importedCount,
    conflictPolicy,
    recommendedPolicy,
    conflictBarCount,
    evaluationId
  }
}

const factorCandidateService = createFactorCandidateService({
  getKlineTable,
  toBarTimestamp
})

const signalInferenceService = createSignalInferenceService({
  normalizePeriodAlias,
  getKlineTable,
  resolveArtifactPath,
  runPredictBatchCli,
  runPredictLiveCli,
  runPredictReplayCli,
})

export const runAutoSignalScan = async (periods: string[], options?: { maxCodesPerPeriod?: number; minConfidence?: number }) => {
  return signalInferenceService.runAutoSignalScan(periods, options)
}

const feedbackRetrainingService = createFeedbackRetrainingService({
  toTradeDateTime,
  createDatasetDraft,
  freezeDataset,
  createFeatureBuildTask,
  createModelTrainingTask
})

export const registerModelIpc = () => {
  registerModelDbLabelingIpcHandlers({
    saveLabelToDb: (label) => saveLabelToDb(label as SaveLabelInput),
    updateLabelStatusInDb
  })

  registerModelDatasetIpcHandlers({
    createDatasetDraft,
    previewDatasetDraftPolicies,
    freezeDataset,
    deleteDraftDataset,
    compareDatasets,
    rollbackDatasetToDraft,
    mergeDatasetsToDraft,
    listDatasetPolicyEvaluations,
    getDatasetPolicyTrendReport,
    getDatasetPolicyOutcomeReport,
    getDatasetPolicyPnlAttributionReport,
    getDatasetPolicySignalTradingOutcomeReport,
    createFeatureBuildTask,
    createModelTrainingTask,
    runLabelInspectCli,
    runFeatureSampleAuditCli,
    runEnsemblePredictCli,
    runEnsembleWalkforwardCli,
    runPredictLiveCli,
    runPredictBatchCli,
    runPredictSeriesCli,
    runLabelGenerateCli,
    cancelLabelGenerateCli,
    runListLabelersCli,
    resolveArtifactPath,
    toBooleanFlag
  })

  registerModelCandidateIpcHandlers({
    isSupportedPeriod: (period) => isSupportedPeriod(period),
    generateFactorCandidates: (code, period, limit) => {
      return factorCandidateService.generateFactorCandidates(code, period as PeriodType, limit)
    }
  })
  registerModelResearchIpc()
  registerModelSignalRetrainingIpcHandlers({
    normalizePeriodAlias,
    runSignalInference: (code, period, minConfidence) => {
      return signalInferenceService.runSignalInference(code, period as PeriodType, minConfidence)
    },
    runAutoSignalScan: (periods, options) => {
      return signalInferenceService.runAutoSignalScan(periods, options)
    },
    runHistoricalReplayScan: (options) => {
      return signalInferenceService.runHistoricalReplayScan(options)
    },
    upsertFeedbackCandidateFromEvent: feedbackRetrainingService.upsertFeedbackCandidateFromEvent,
    backfillFeedbackCandidates: feedbackRetrainingService.backfillFeedbackCandidates,
    createFeedbackRetrainingRun: feedbackRetrainingService.createFeedbackRetrainingRun,
    resolveArtifactPath
  })

}
