import { readFileSync } from 'fs'
import { getDb } from '../db'

type PeriodType = '5m' | '15m' | '1d'

interface SignalInferenceServiceDeps {
  normalizePeriodAlias: (period: string) => PeriodType | null
  getKlineTable: (period: PeriodType) => string
  resolveArtifactPath: (artifactPath: string) => string | null
  runPredictBatchCli: (
    modelId: string,
    codes: string[],
    period: string
  ) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: unknown | null }>
  runPredictLiveCli: (
    modelId: string,
    code: string,
    period: string
  ) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: unknown | null }>
  runPredictReplayCli: (
    modelId: string,
    codes: string[],
    period: string,
    startDate: string,
    endDate: string,
    options?: { threshold?: number; holdingDays?: number; maxPositions?: number }
  ) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: unknown | null }>
}

interface ActiveModelRuntime {
  modelId: string
  modelName: string
  modelType: string
  specVersion: string
  datasetId: string
  threshold: number
  featureColumns: string[]
  means: number[]
  stds: number[]
  weights: number[]
}

type ActiveModelRuntimeResult =
  | { success: true; runtime: ActiveModelRuntime }
  | { success: false; reason: string }

export const createSignalInferenceService = (deps: SignalInferenceServiceDeps) => {
  const { normalizePeriodAlias, getKlineTable, resolveArtifactPath, runPredictBatchCli, runPredictLiveCli, runPredictReplayCli } = deps

  const resolveScanDecisionThreshold = (modelId: string, fallback: number): number => {
    const database = getDb()
    const row = database.prepare(`
      SELECT threshold
      FROM model_recommendations
      WHERE model_id = ?
        AND source = 'backtest'
        AND signal_type = 'buy'
        AND threshold IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get(modelId) as { threshold?: number } | undefined
    const raw = typeof row?.threshold === 'number' && Number.isFinite(row.threshold) ? row.threshold : fallback
    return Math.min(0.99, Math.max(0.5, raw))
  }

  const listRecentlyUpdatedCodes = (period: PeriodType, limit: number): string[] => {
    const database = getDb()
    const table = getKlineTable(period)
    const maxLimit = Math.min(300, Math.max(1, Number(limit || 30)))

    if (period === '1d') {
      const rows = database.prepare(`
        SELECT code, MAX(trade_date) AS latest_key
        FROM ${table}
        GROUP BY code
        ORDER BY latest_key DESC
        LIMIT ?
      `).all(maxLimit) as Array<{ code: string }>
      return rows.map((row) => row.code).filter((code) => !!code)
    }

    const rows = database.prepare(`
      SELECT code, MAX(trade_date || COALESCE(trade_time, '')) AS latest_key
      FROM ${table}
      GROUP BY code
      ORDER BY latest_key DESC
      LIMIT ?
    `).all(maxLimit) as Array<{ code: string }>
    return rows.map((row) => row.code).filter((code) => !!code)
  }

  const resolveActiveModelRuntime = (): ActiveModelRuntimeResult => {
    const database = getDb()
    const activeModel = database.prepare(`
      SELECT *
      FROM model_versions
      WHERE status = 'active'
      ORDER BY activated_at DESC, created_at DESC
      LIMIT 1
    `).get() as {
      id: string
      name?: string
      artifact_path: string
    } | undefined
    if (!activeModel) return { success: false, reason: 'no_active_model' }

    const artifactFile = resolveArtifactPath(activeModel.artifact_path)
    if (!artifactFile) return { success: false, reason: 'artifact_not_found' }

    let artifact: Record<string, unknown>
    try {
      artifact = JSON.parse(readFileSync(artifactFile, 'utf-8')) as Record<string, unknown>
    } catch {
      return { success: false, reason: 'artifact_parse_error' }
    }

    const featureColumns = Array.isArray(artifact.feature_columns)
      ? artifact.feature_columns.filter((item): item is string => typeof item === 'string')
      : []
    const means = Array.isArray(artifact.means)
      ? artifact.means.map((item) => (typeof item === 'number' ? item : 0))
      : []
    const stds = Array.isArray(artifact.stds)
      ? artifact.stds.map((item) => (typeof item === 'number' ? item : 1))
      : []
    const modelType = typeof artifact.model_type === 'string' ? artifact.model_type : 'baseline'
    const specVersion = typeof artifact.spec_version === 'string' ? artifact.spec_version : ''
    const datasetId = typeof artifact.dataset_id === 'string' ? artifact.dataset_id : ''
    const rawThreshold = typeof artifact.threshold === 'number' ? artifact.threshold : 0.5
    const threshold = Math.max(0.5, rawThreshold)
    const weights = Array.isArray(artifact.weights)
      ? artifact.weights.map((item) => (typeof item === 'number' ? item : 0))
      : []

    if (featureColumns.length === 0 || means.length !== featureColumns.length || stds.length !== featureColumns.length) {
      return { success: false, reason: 'artifact_schema_invalid' }
    }

    return {
      success: true,
      runtime: {
        modelId: activeModel.id,
        modelName: typeof activeModel.name === 'string' && activeModel.name ? activeModel.name : activeModel.id,
        modelType,
        specVersion,
        datasetId,
        threshold,
        featureColumns,
        means,
        stds,
        weights,
      },
    }
  }

  const runSignalInference = async (code: string, period: PeriodType, minConfidence: number) => {
    const runtimeResult = resolveActiveModelRuntime()
    if (!runtimeResult.success) return runtimeResult
    const runtime = runtimeResult.runtime
    const decisionThreshold = resolveScanDecisionThreshold(runtime.modelId, runtime.threshold)

    try {
      const cliResult = await runPredictLiveCli(runtime.modelId, code, period)
      if (cliResult.code !== 0 || !cliResult.payload) {
        return { success: false as const, reason: 'cli_predict_failed' }
      }
      const p = (Array.isArray(cliResult.payload) ? cliResult.payload[0] : cliResult.payload) as Record<string, unknown> | undefined
      if (!p || p.error) {
        return { success: false as const, reason: 'cli_predict_error' }
      }

      const score = typeof p.score === 'number' ? p.score : 0
      const confidence = typeof p.confidence === 'number' ? p.confidence : 0
      if (confidence < minConfidence) {
        return { success: false as const, reason: 'low_confidence', confidence, threshold: minConfidence }
      }

      const signalType: 'buy' | 'sell' = score >= decisionThreshold ? 'buy' : 'sell'
      const barTimestamp = typeof p.bar_timestamp === 'number' ? p.bar_timestamp : 0

      const database = getDb()
      const existingEvent = database.prepare(`
        SELECT * FROM signal_events WHERE model_id = ? AND code = ? AND period = ? AND bar_timestamp = ? AND signal_type = ?
        LIMIT 1
      `).get(runtime.modelId, code, period, barTimestamp, signalType)
      if (existingEvent) {
        return { success: true as const, event: existingEvent, modelId: runtime.modelId, deduplicated: true }
      }

      const now = Math.floor(Date.now() / 1000)
      const eventId = `signal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      database.prepare(`
        INSERT INTO signal_events (
          id, model_id, code, period, bar_timestamp, signal_type, confidence, score, threshold, payload_json, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
      `).run(
        eventId, runtime.modelId, code, period, barTimestamp, signalType,
        confidence, score, decisionThreshold,
        JSON.stringify({
          model_type: runtime.modelType,
          feature_count: runtime.featureColumns.length,
          inference_mode: 'cli_live',
          decision_threshold: decisionThreshold,
          artifact_threshold: runtime.threshold,
        }),
        now
      )

      const event = database.prepare('SELECT * FROM signal_events WHERE id = ? LIMIT 1').get(eventId)
      return { success: true as const, event, modelId: runtime.modelId }
    } catch {
      return { success: false as const, reason: 'cli_predict_exception' }
    }
  }

  const runAutoSignalScan = async (periods: string[], options?: { maxCodesPerPeriod?: number; minConfidence?: number }) => {
    const normalizedPeriods: PeriodType[] = Array.from(new Set(
      (periods || [])
        .map((period) => normalizePeriodAlias(period))
        .filter((period): period is PeriodType => period !== null)
    ))
    const targetPeriods: PeriodType[] = normalizedPeriods.length > 0 ? normalizedPeriods : ['15m']

    const maxCodesPerPeriod = Math.min(300, Math.max(1, Number(options?.maxCodesPerPeriod || 30)))
    const minConfidence = Math.min(0.99, Math.max(0, Number(options?.minConfidence ?? 0.85)))
    const runtimeResult = resolveActiveModelRuntime()
    if (!runtimeResult.success) {
      return {
        success: false, reason: runtimeResult.reason, periods: targetPeriods,
        attempted: 0, created: 0, deduplicated: 0, lowConfidence: 0, failed: 0,
      }
    }
    const runtime = runtimeResult.runtime
    const decisionThreshold = resolveScanDecisionThreshold(runtime.modelId, runtime.threshold)

    const summary = {
      success: true as const, periods: targetPeriods,
      attempted: 0, scannedCodes: 0, created: 0, deduplicated: 0, lowConfidence: 0, failed: 0,
      thresholdUsed: decisionThreshold,
      artifactThreshold: runtime.threshold,
      reasonCounts: {} as Record<string, number>,
    }

    for (const period of targetPeriods) {
      const codes = listRecentlyUpdatedCodes(period, maxCodesPerPeriod)
      summary.scannedCodes += codes.length

      const batchSize = 40
      for (let i = 0; i < codes.length; i += batchSize) {
        const batch = codes.slice(i, i + batchSize)
        try {
          const cliResult = await runPredictBatchCli(runtime.modelId, batch, period)
          if (cliResult.code !== 0 || !cliResult.payload) {
            summary.attempted += batch.length
            summary.failed += batch.length
            summary.reasonCounts['cli_batch_failed'] = (summary.reasonCounts['cli_batch_failed'] || 0) + batch.length
            continue
          }
          const predictions = Array.isArray(cliResult.payload) ? cliResult.payload : []
          const database = getDb()
          for (const pred of predictions) {
            summary.attempted += 1
            const p = pred as Record<string, unknown>
            if (p.error) {
              summary.failed += 1
              summary.reasonCounts['cli_predict_error'] = (summary.reasonCounts['cli_predict_error'] || 0) + 1
              continue
            }
            const score = typeof p.score === 'number' ? p.score : 0
            const confidence = typeof p.confidence === 'number' ? p.confidence : 0
            const signalType: 'buy' | 'sell' = score >= decisionThreshold ? 'buy' : 'sell'

            if (confidence < minConfidence) {
              summary.lowConfidence += 1
              continue
            }

            const barTimestamp = typeof p.bar_timestamp === 'number' ? p.bar_timestamp : 0
            const code = String(p.code || '')
            const signalDate = typeof p.signal_date === 'string' ? p.signal_date : ''
            const existingEvent = database.prepare(`
              SELECT id FROM signal_events WHERE model_id = ? AND code = ? AND period = ? AND bar_timestamp = ? AND signal_type = ?
              LIMIT 1
            `).get(runtime.modelId, code, period, barTimestamp, signalType)
            if (existingEvent) {
              summary.deduplicated += 1
              continue
            }

            const now = Math.floor(Date.now() / 1000)
            const eventId = `signal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            database.prepare(`
              INSERT INTO signal_events (id, model_id, code, period, bar_timestamp, signal_type, confidence, score, threshold, payload_json, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
            `).run(
              eventId, runtime.modelId, code, period, barTimestamp, signalType,
              confidence, score, decisionThreshold,
              JSON.stringify({
                model_type: runtime.modelType,
                feature_count: runtime.featureColumns.length,
                inference_mode: 'cli_batch',
                decision_threshold: decisionThreshold,
                artifact_threshold: runtime.threshold,
              }),
              now
            )

            const normalizedSignalDate = signalDate || (typeof p.date === 'string' ? p.date : '')
            if (signalType === 'buy' && normalizedSignalDate) {
              const recId = `rec_realtime_${runtime.modelId}_${period}_${normalizedSignalDate}_${code}`
              database.prepare(`
                INSERT OR REPLACE INTO model_recommendations
                  (id, model_id, code, signal_date, period, probability, threshold,
                   signal_type, confidence, source, spec_version, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'realtime', ?, ?)
              `).run(
                recId, runtime.modelId, code, normalizedSignalDate, period,
                score, decisionThreshold, signalType, confidence,
                runtime.specVersion || (runtime.featureColumns.length > 0 ? 'v001' : ''), now
              )
            }

            summary.created += 1
          }
        } catch {
          summary.attempted += batch.length
          summary.failed += batch.length
          summary.reasonCounts['cli_batch_exception'] = (summary.reasonCounts['cli_batch_exception'] || 0) + batch.length
        }
      }
    }

    return summary
  }

  const listAllCodes = (period: PeriodType): string[] => {
    const database = getDb()
    const table = getKlineTable(period)
    const rows = database.prepare(`
      SELECT DISTINCT code FROM ${table}
      WHERE code NOT LIKE 'sh%' AND code NOT LIKE 'sz%' AND code NOT LIKE 'bj%'
      ORDER BY code
    `).all() as Array<{ code: string }>
    return rows.map((row) => row.code).filter((code) => !!code)
  }

  const runHistoricalReplayScan = async (options: {
    period: string
    startDate: string
    endDate: string
    minConfidence?: number
  }) => {
    const normalizedPeriod = normalizePeriodAlias(options.period)
    if (!normalizedPeriod) {
      return { success: false as const, reason: 'unsupported_period' }
    }
    const runtimeResult = resolveActiveModelRuntime()
    if (!runtimeResult.success) {
      return { success: false as const, reason: runtimeResult.reason }
    }
    const runtime = runtimeResult.runtime
    const decisionThreshold = resolveScanDecisionThreshold(runtime.modelId, runtime.threshold)

    const allCodes = listAllCodes(normalizedPeriod)
    if (allCodes.length === 0) {
      return { success: false as const, reason: 'no_codes_found' }
    }

    const summary = {
      success: true as const,
      period: normalizedPeriod,
      startDate: options.startDate,
      endDate: options.endDate,
      attempted: 0,
      scannedCodes: allCodes.length,
      created: 0,
      deduplicated: 0,
      lowConfidence: 0,
      failed: 0,
      batches: 0,
      thresholdUsed: decisionThreshold,
    }

    const database = getDb()
    database.prepare(`
      DELETE FROM model_recommendations
      WHERE model_id = ?
        AND source = 'replay'
        AND period = ?
        AND signal_date >= ?
        AND signal_date <= ?
    `).run(runtime.modelId, normalizedPeriod, options.startDate, options.endDate)

    summary.batches = 1
    try {
      const cliResult = await runPredictReplayCli(
        runtime.modelId, allCodes, normalizedPeriod,
        options.startDate, options.endDate,
        { threshold: decisionThreshold, holdingDays: 2, maxPositions: 10 },
      )
      if (cliResult.code !== 0 || !cliResult.payload) {
        summary.attempted += allCodes.length
        summary.failed += allCodes.length
        return summary
      }

      const report = cliResult.payload && typeof cliResult.payload === 'object' && !Array.isArray(cliResult.payload)
        ? cliResult.payload as Record<string, unknown>
        : {}
      const tradeDetails = Array.isArray(report.trade_details) ? report.trade_details : []
          const backtestId = typeof report.report_path === 'string' && report.report_path
            ? report.report_path
            : `replay_${runtime.modelId}_${options.startDate}_${options.endDate}`
          const now = Math.floor(Date.now() / 1000)

      for (const pred of tradeDetails) {
        summary.attempted += 1
        const p = pred as Record<string, unknown>
        const score = typeof p.probability === 'number' ? p.probability : 0
        const confidence = Math.min(1.0, Math.abs(score - decisionThreshold) / Math.max(decisionThreshold, 1 - decisionThreshold))
        const code = String(p.code || '')
        const signalDate = typeof p.signal_date === 'string' ? p.signal_date : ''

        if (signalDate) {
          const recId = `rec_replay_${runtime.modelId}_${normalizedPeriod}_${signalDate}_${code}`
          const tradeExecuted = p.trade_executed === true ? 1 : 0
          database.prepare(`
            INSERT OR REPLACE INTO model_recommendations
              (id, model_id, model_name, code, stock_name, signal_date, period, probability,
               threshold, signal_type, confidence, trade_executed, entry_price, exit_close,
               exit_high, actual_return, best_return, skip_reason, source, backtest_id,
               spec_version, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?, 'replay', ?, ?, ?)
          `).run(
            recId,
            runtime.modelId,
            runtime.modelName,
            code,
            typeof p.stock_name === 'string' ? p.stock_name : '',
            signalDate,
            normalizedPeriod,
            score,
            decisionThreshold,
            confidence,
            tradeExecuted,
            typeof p.entry_price === 'number' ? p.entry_price : null,
            typeof p.exit_close === 'number' ? p.exit_close : null,
            typeof p.exit_high === 'number' ? p.exit_high : null,
            typeof p.actual_return === 'number' ? p.actual_return : null,
            typeof p.best_return === 'number' ? p.best_return : null,
            typeof p.skip_reason === 'string' ? p.skip_reason : '',
            backtestId,
            runtime.specVersion,
            now,
          )
        }

        summary.created += 1
      }
    } catch {
      summary.attempted += allCodes.length
      summary.failed += allCodes.length
    }

    return summary
  }

  return { runSignalInference, runAutoSignalScan, runHistoricalReplayScan }
}
