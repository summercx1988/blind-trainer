import { getDb } from '../db'
import fs from 'fs'
import path from 'path'

export interface SignalEventFeedbackRow {
  eventId: string
  modelId: string
  code: string
  period: string
  barTimestamp: number
  signalType: 'buy' | 'sell' | 'hold'
  confidence: number
  score: number | null
  threshold: number | null
}

export interface FeedbackBackfillInput {
  limit?: number
  sinceCreatedAt?: number
}

export interface FeedbackRetrainingInput {
  triggerType?: 'manual' | 'scheduled' | 'sync_after'
  specVersion?: string
  taskType?: string
  sampleLimit?: number
  minSamples?: number
  activateOnSuccess?: boolean
  sinceCreatedAt?: number
}

interface CreateDatasetDraftInput {
  name?: string
  description?: string
  code?: string
  period?: string
  sourceStrategy?: string
  limit?: number
  conflictPolicy?: 'keep_all' | 'single_best'
}

interface FeedbackRetrainingServiceDeps {
  toTradeDateTime: (timestamp: number, period: string) => { tradeDate: string; tradeTime?: string }
  createDatasetDraft: (input: CreateDatasetDraftInput) => unknown
  freezeDataset: (datasetId: string) => unknown | null
  createFeatureBuildTask: (datasetId: string, specVersion: string, strictRealDataset?: boolean) => Promise<unknown>
  createModelTrainingTask: (datasetId: string, specVersion: string, taskType: string) => Promise<unknown>
}

export const createFeedbackRetrainingService = (deps: FeedbackRetrainingServiceDeps) => {
  const {
    toTradeDateTime,
    createDatasetDraft,
    freezeDataset,
    createFeatureBuildTask,
    createModelTrainingTask
  } = deps

  const upsertFeedbackCandidateFromEvent = (
    database: ReturnType<typeof getDb>,
    eventRow: SignalEventFeedbackRow,
    action: 'accept' | 'modify',
    note: string | null,
    now: number
  ) => {
    if (eventRow.signalType !== 'buy' && eventRow.signalType !== 'sell') {
      return { skipped: true, inserted: false, updated: false, candidateId: '' }
    }

    const candidateId = `cand_feedback_${eventRow.code}_${eventRow.period}_${eventRow.barTimestamp}_${eventRow.signalType}`
    const existed = database.prepare('SELECT id FROM signal_candidates WHERE id = ? LIMIT 1').get(candidateId) as { id: string } | undefined
    const stock = database.prepare('SELECT name FROM stock_list WHERE code = ? LIMIT 1').get(eventRow.code) as { name?: string } | undefined
    const trade = toTradeDateTime(eventRow.barTimestamp, eventRow.period)
    const payload = JSON.stringify({
      signal_event_id: eventRow.eventId,
      model_id: eventRow.modelId,
      feedback_action: action,
      confidence: eventRow.confidence,
      score: eventRow.score,
      threshold: eventRow.threshold,
      note: note || null
    })
    const reason = action === 'modify'
      ? `模型提醒人工修正：${note || '未填写备注'}`
      : `模型提醒人工采纳（置信度 ${(eventRow.confidence * 100).toFixed(1)}%）`

    database.prepare(`
      INSERT INTO signal_candidates (
        id, code, stock_name, period, trade_date, trade_time, bar_timestamp,
        signal_type, factor_type, score, reason, source_strategy, status, payload, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        score = excluded.score,
        reason = excluded.reason,
        status = excluded.status,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(
      candidateId,
      eventRow.code,
      stock?.name || eventRow.code,
      eventRow.period,
      trade.tradeDate,
      trade.tradeTime || null,
      eventRow.barTimestamp,
      eventRow.signalType,
      action === 'modify' ? 'model_feedback_modify' : 'model_feedback',
      eventRow.score ?? 0,
      reason,
      'model_feedback_v1',
      payload,
      now,
      now
    )

    database.prepare(`
      INSERT INTO candidate_review_logs (id, candidate_id, action, operator, note, created_at)
      VALUES (?, ?, ?, 'user', ?, ?)
    `).run(
      `cand_log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      candidateId,
      action === 'modify' ? 'edit' : 'accept',
      note || `from_signal_event:${eventRow.eventId}`,
      now
    )

    return { skipped: false, inserted: !existed, updated: !!existed, candidateId }
  }

  const backfillFeedbackCandidates = (input?: FeedbackBackfillInput) => {
    const database = getDb()
    const whereParts: string[] = ["f.action IN ('accept', 'modify')"]
    const values: Array<number> = []
    if (typeof input?.sinceCreatedAt === 'number' && Number.isFinite(input.sinceCreatedAt) && input.sinceCreatedAt > 0) {
      whereParts.push('f.created_at >= ?')
      values.push(Math.floor(input.sinceCreatedAt))
    }
    const limit = Math.min(5000, Math.max(1, Number(input?.limit || 1200)))
    values.push(limit)

    const rows = database.prepare(`
      SELECT
        f.id AS feedback_id,
        f.action AS feedback_action,
        f.note AS feedback_note,
        f.created_at AS feedback_created_at,
        e.id AS event_id,
        e.model_id AS model_id,
        e.code AS code,
        e.period AS period,
        e.bar_timestamp AS bar_timestamp,
        e.signal_type AS signal_type,
        e.confidence AS confidence,
        e.score AS score,
        e.threshold AS threshold
      FROM signal_feedback f
      INNER JOIN signal_events e ON e.id = f.signal_event_id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY f.created_at ASC
      LIMIT ?
    `).all(...values) as Array<{
      feedback_id: string
      feedback_action: 'accept' | 'modify'
      feedback_note: string | null
      feedback_created_at: number
      event_id: string
      model_id: string
      code: string
      period: string
      bar_timestamp: number
      signal_type: 'buy' | 'sell' | 'hold'
      confidence: number
      score: number | null
      threshold: number | null
    }>

    let inserted = 0
    let updated = 0
    let skipped = 0

    for (const row of rows) {
      if (row.feedback_action !== 'accept' && row.feedback_action !== 'modify') {
        skipped += 1
        continue
      }
      const result = upsertFeedbackCandidateFromEvent(database, {
        eventId: row.event_id,
        modelId: row.model_id,
        code: row.code,
        period: row.period,
        barTimestamp: row.bar_timestamp,
        signalType: row.signal_type,
        confidence: row.confidence,
        score: row.score,
        threshold: row.threshold
      }, row.feedback_action, row.feedback_note, row.feedback_created_at)
      if (result.skipped) skipped += 1
      else if (result.inserted) inserted += 1
      else if (result.updated) updated += 1
    }

    return {
      success: true,
      scanned: rows.length,
      inserted,
      updated,
      skipped,
      sinceCreatedAt: typeof input?.sinceCreatedAt === 'number' ? Math.floor(input.sinceCreatedAt) : null
    }
  }

  const createFeedbackRetrainingRun = async (input?: FeedbackRetrainingInput) => {
    const database = getDb()
    const triggerType = input?.triggerType || 'manual'
    const specVersion = input?.specVersion || (() => {
      const active = database.prepare(`
        SELECT mv.artifact_path FROM model_versions mv WHERE mv.status = 'active' ORDER BY activated_at DESC LIMIT 1
      `).get() as { artifact_path?: string } | undefined
      if (active?.artifact_path) {
        try {
          const artifactDir = path.dirname(active.artifact_path)
          const artifact = JSON.parse(fs.readFileSync(path.join(artifactDir, path.basename(active.artifact_path)), 'utf-8'))
          if (artifact.spec_version) return artifact.spec_version
        } catch { /* fallback */ }
      }
      return 'v001'
    })()
    const taskType = input?.taskType || 'buy_signal'
    const sampleLimit = Math.min(3000, Math.max(50, Number(input?.sampleLimit || 800)))
    const minSamples = Math.min(2000, Math.max(20, Number(input?.minSamples || 80)))
    const activateOnSuccess = input?.activateOnSuccess === true

    const now = Math.floor(Date.now() / 1000)
    const runId = `retrain_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    database.prepare(`
      INSERT INTO retraining_runs (
        id, trigger_type, status, source, spec_version, task_type, sample_limit, activated, created_at, started_at
      )
      VALUES (?, ?, 'running', 'feedback', ?, ?, ?, 0, ?, ?)
    `).run(runId, triggerType, specVersion, taskType, sampleLimit, now, now)

    try {
      const backfill = backfillFeedbackCandidates({
        limit: Math.min(5000, sampleLimit * 3),
        sinceCreatedAt: input?.sinceCreatedAt
      })

      const timeTag = new Date().toISOString().slice(2, 10).replace(/-/g, '') + '_' + new Date().toISOString().slice(11, 16).replace(':', '')
      const dataset = createDatasetDraft({
        name: `反馈再训练-${timeTag}`,
        description: '来源: signal_feedback accept/modify',
        sourceStrategy: 'model_feedback_v1',
        limit: sampleLimit
      }) as Record<string, unknown>

      const datasetId = typeof dataset.id === 'string' ? dataset.id : ''
      const importedCount = Number(dataset.importedCount || dataset.sample_count || 0)
      if (!datasetId) {
        database.prepare(`
          UPDATE retraining_runs
          SET status = 'failed', backfill_summary_json = ?, error_message = ?, finished_at = ?
          WHERE id = ?
        `).run(JSON.stringify(backfill), 'dataset_create_failed', Math.floor(Date.now() / 1000), runId)
        const run = database.prepare('SELECT * FROM retraining_runs WHERE id = ? LIMIT 1').get(runId)
        return { success: false, reason: 'dataset_create_failed', run, backfill }
      }

      if (importedCount < minSamples) {
        database.prepare(`
          UPDATE retraining_runs
          SET
            status = 'failed',
            backfill_summary_json = ?,
            summary_json = ?,
            dataset_id = ?,
            error_message = ?,
            finished_at = ?
          WHERE id = ?
        `).run(
          JSON.stringify(backfill),
          JSON.stringify({ importedCount, minSamples }),
          datasetId,
          'insufficient_samples',
          Math.floor(Date.now() / 1000),
          runId
        )
        const run = database.prepare('SELECT * FROM retraining_runs WHERE id = ? LIMIT 1').get(runId)
        return { success: false, reason: 'insufficient_samples', run, backfill, datasetId, importedCount, minSamples }
      }

      const freeze = freezeDataset(datasetId) as Record<string, unknown> | null
      if (!freeze) {
        database.prepare(`
          UPDATE retraining_runs
          SET status = 'failed', backfill_summary_json = ?, dataset_id = ?, error_message = ?, finished_at = ?
          WHERE id = ?
        `).run(JSON.stringify(backfill), datasetId, 'freeze_failed', Math.floor(Date.now() / 1000), runId)
        const run = database.prepare('SELECT * FROM retraining_runs WHERE id = ? LIMIT 1').get(runId)
        return { success: false, reason: 'freeze_failed', run, backfill, datasetId }
      }

      const featureResult = await createFeatureBuildTask(datasetId, specVersion) as Record<string, unknown>
      const featureTask = featureResult.task && typeof featureResult.task === 'object' ? featureResult.task as Record<string, unknown> : null
      const featureTaskId = featureTask && typeof featureTask.id === 'string' ? featureTask.id : null
      if (featureResult.success !== true) {
        database.prepare(`
          UPDATE retraining_runs
          SET
            status = 'failed',
            backfill_summary_json = ?,
            dataset_id = ?,
            feature_task_id = ?,
            error_message = ?,
            finished_at = ?
          WHERE id = ?
        `).run(
          JSON.stringify(backfill),
          datasetId,
          featureTaskId,
          typeof featureResult.reason === 'string' ? featureResult.reason : 'feature_failed',
          Math.floor(Date.now() / 1000),
          runId
        )
        const run = database.prepare('SELECT * FROM retraining_runs WHERE id = ? LIMIT 1').get(runId)
        return { success: false, reason: 'feature_failed', run, backfill, datasetId, featureTaskId }
      }

      const trainResult = await createModelTrainingTask(datasetId, specVersion, taskType) as Record<string, unknown>
      const modelTask = trainResult.task && typeof trainResult.task === 'object' ? trainResult.task as Record<string, unknown> : null
      const modelTaskId = modelTask && typeof modelTask.id === 'string' ? modelTask.id : null
      const model = trainResult.model && typeof trainResult.model === 'object' ? trainResult.model as Record<string, unknown> : null
      const modelId = model && typeof model.id === 'string' ? model.id : null
      if (trainResult.success !== true || !modelId) {
        database.prepare(`
          UPDATE retraining_runs
          SET
            status = 'failed',
            backfill_summary_json = ?,
            dataset_id = ?,
            feature_task_id = ?,
            model_task_id = ?,
            error_message = ?,
            finished_at = ?
          WHERE id = ?
        `).run(
          JSON.stringify(backfill),
          datasetId,
          featureTaskId,
          modelTaskId,
          typeof trainResult.reason === 'string' ? trainResult.reason : 'train_failed',
          Math.floor(Date.now() / 1000),
          runId
        )
        const run = database.prepare('SELECT * FROM retraining_runs WHERE id = ? LIMIT 1').get(runId)
        return { success: false, reason: 'train_failed', run, backfill, datasetId, featureTaskId, modelTaskId }
      }

      let activated = 0
      if (activateOnSuccess) {
        const activatedAt = Math.floor(Date.now() / 1000)
        database.prepare(`UPDATE model_versions SET status = 'inactive', activated_at = NULL WHERE status = 'active'`).run()
        database.prepare(`UPDATE model_versions SET status = 'active', activated_at = ? WHERE id = ?`).run(activatedAt, modelId)
        activated = 1
      }

      const summary = {
        importedCount,
        minSamples,
        activateOnSuccess,
        activated,
        featureTaskId,
        modelTaskId,
        modelId
      }

      let retrainTestAccuracy: number | null = null
      let retrainTestF1: number | null = null
      if (modelId) {
        const trained = database.prepare(
          'SELECT test_auc, test_accuracy, test_f1 FROM model_versions WHERE id = ?'
        ).get(modelId) as { test_auc: number | null; test_accuracy: number | null; test_f1: number | null } | undefined
        if (trained) {
          retrainTestAccuracy = trained.test_accuracy
          retrainTestF1 = trained.test_f1
        }
      }

      database.prepare(`
        UPDATE retraining_runs
        SET
          status = 'succeeded',
          activated = ?,
          backfill_summary_json = ?,
          summary_json = ?,
          dataset_id = ?,
          feature_task_id = ?,
          model_task_id = ?,
          model_id = ?,
          finished_at = ?,
          train_samples = ?,
          test_accuracy = ?,
          test_f1 = ?,
          feature_count = ?
        WHERE id = ?
      `).run(
        activated,
        JSON.stringify(backfill),
        JSON.stringify(summary),
        datasetId,
        featureTaskId,
        modelTaskId,
        modelId,
        Math.floor(Date.now() / 1000),
        importedCount || null,
        retrainTestAccuracy,
        retrainTestF1,
        null,
        runId
      )

      const run = database.prepare('SELECT * FROM retraining_runs WHERE id = ? LIMIT 1').get(runId)
      return {
        success: true,
        run,
        backfill,
        datasetId,
        featureTaskId,
        modelTaskId,
        modelId,
        activated: activated === 1
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error'
      database.prepare(`
        UPDATE retraining_runs
        SET status = 'failed', error_message = ?, finished_at = ?
        WHERE id = ?
      `).run(message, Math.floor(Date.now() / 1000), runId)
      const run = database.prepare('SELECT * FROM retraining_runs WHERE id = ? LIMIT 1').get(runId)
      return { success: false, reason: 'exception', errorMessage: message, run }
    }
  }

  return {
    upsertFeedbackCandidateFromEvent,
    backfillFeedbackCandidates,
    createFeedbackRetrainingRun
  }
}
