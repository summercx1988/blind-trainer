import { ipcMain, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { getDb, DB_PATH } from '../db'
import { resolveMarketDbPath } from '../marketDb'
import {
  loadOutcomeGateSettingsFromDb,
  mergeOutcomeGateSettings,
  saveOutcomeGateSettingsToDb
} from './modelOutcomeGateSettings'
import { fail, ok } from './platformResult'

const getActiveModelSpecVersion = (): string | null => {
  try {
    const database = getDb()
    const active = database.prepare(`
      SELECT artifact_path FROM model_versions WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1
    `).get() as { artifact_path?: string } | undefined
    if (!active?.artifact_path) return null
    const artifact = JSON.parse(readFileSync(active.artifact_path, 'utf-8')) as Record<string, unknown>
    return typeof artifact.spec_version === 'string' ? artifact.spec_version : null
  } catch {
    return null
  }
}

interface CreateDatasetDraftInput {
  name?: string
  description?: string
  code?: string
  period?: string
  sourceStrategy?: string
  outcomeFilter?: 'all' | 'qualified_only'
  limit?: number
  conflictPolicy?: 'keep_all' | 'single_best'
}

interface PreviewDatasetDraftPoliciesInput {
  code?: string
  period?: string
  sourceStrategy?: string
  outcomeFilter?: 'all' | 'qualified_only'
  limit?: number
}

interface MergeDatasetsToDraftInput {
  name?: string
  conflictPolicy?: 'keep_all' | 'single_best'
}

interface ModelDatasetDeps {
  createDatasetDraft: (input: CreateDatasetDraftInput) => unknown
  previewDatasetDraftPolicies: (input: PreviewDatasetDraftPoliciesInput) => unknown
  freezeDataset: (datasetId: string) => unknown | null
  deleteDraftDataset: (datasetId: string) => unknown
  compareDatasets: (leftDatasetId: string, rightDatasetId: string) => unknown
  rollbackDatasetToDraft: (sourceDatasetId: string, draftName?: string) => unknown
  mergeDatasetsToDraft: (leftDatasetId: string, rightDatasetId: string, input: MergeDatasetsToDraftInput) => unknown
  listDatasetPolicyEvaluations: (mode?: string, limit?: number) => unknown
  getDatasetPolicyTrendReport: (limit?: number) => unknown
  getDatasetPolicyOutcomeReport: (limit?: number) => unknown
  getDatasetPolicyPnlAttributionReport: (limit?: number) => unknown
  getDatasetPolicySignalTradingOutcomeReport: (limit?: number) => unknown
  createFeatureBuildTask: (datasetId: string, specVersion: string, strictRealDataset: boolean) => Promise<unknown>
  createModelTrainingTask: (
    datasetId: string,
    specVersion: string,
    taskType: string,
    engine: string,
    trials: number,
    options?: { numBoostRound?: number; earlyStoppingRounds?: number; runName?: string }
  ) => Promise<unknown>
  runLabelInspectCli: (params: { db: string; datasetId: string; code: string; limit: number }) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: Record<string, unknown> | null }>
  runFeatureSampleAuditCli: (manifestPath: string) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: Record<string, unknown> | null }>
  runEnsemblePredictCli: (trendModelId: string, reversalModelId: string, weightTrend: number) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: Record<string, unknown> | null }>
  runEnsembleWalkforwardCli: (params: { datasetId: string; specVersion: string; engines: string[]; weights: number[]; method: string; threshold: number; trainDays: number; testDays: number; stepDays: number; maxWindows: number; holdingDays: number; maxPositions: number; numBoostRound: number }) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: Record<string, unknown> | null }>
  runPredictLiveCli: (modelId: string, code: string, period: string) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: unknown | null }>
  runPredictBatchCli: (modelId: string, codes: string[], period: string) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: unknown | null }>
  runPredictSeriesCli: (modelId: string, code: string, period: string) => Promise<{ command: string; stdout: string; stderr: string; code: number; payload: unknown | null }>
  runLabelGenerateCli: (params: { labeler: string; marketDb?: string; labelDb?: string; codes?: string[]; start?: string; end?: string; strategy?: string; qualityPreset?: string; stockLimit?: number; lookbackBars?: number; minRequiredBars?: number; forwardDays?: number; saveDb?: boolean; onProgress?: (msg: string) => void }) => Promise<{ command: string; stdout: string; stderr: string; code: number; aborted?: boolean; payload: Record<string, unknown> | null }>
  cancelLabelGenerateCli: () => { success: boolean; status: 'idle' | 'cancelling' }
  runListLabelersCli: () => Promise<{ command: string; stdout: string; stderr: string; code: number; labelers: Array<{ name: string; display_name: string; supported_presets: string[]; default_strategy: string; description: string }> }>
  resolveArtifactPath: (artifactPath: string) => string | null
  toBooleanFlag: (value: unknown) => boolean
}

type CliJsonPayload = Record<string, unknown> | Array<Record<string, unknown>> | null

const normalizeCliPayload = (payload: unknown): CliJsonPayload => {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>
  }
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>
  }
  return null
}

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

const asString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback
}

type PredictionPeriod = '5m' | '15m' | '1d'

interface PredictionSettings {
  autoRefreshEnabled: boolean
  autoRefreshIntervalSec: number
  freshnessThresholdMinutes: Record<PredictionPeriod, number>
}

const PREDICTION_SETTINGS_KEY = 'prediction_settings_v1'

const DEFAULT_PREDICTION_SETTINGS: PredictionSettings = {
  autoRefreshEnabled: false,
  autoRefreshIntervalSec: 60,
  freshnessThresholdMinutes: {
    '5m': 20,
    '15m': 60,
    '1d': 36 * 60,
  }
}

const asBoundedInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

const parseOptionalBoundedInt = (value: unknown, min: number, max: number): number | undefined => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

const sanitizePredictionSettings = (
  input: Record<string, unknown>,
  fallback: PredictionSettings = DEFAULT_PREDICTION_SETTINGS
): PredictionSettings => {
  const thresholdNode = input.freshnessThresholdMinutes
  const thresholds = thresholdNode && typeof thresholdNode === 'object'
    ? thresholdNode as Record<string, unknown>
    : {}
  return {
    autoRefreshEnabled: typeof input.autoRefreshEnabled === 'boolean'
      ? input.autoRefreshEnabled
      : fallback.autoRefreshEnabled,
    autoRefreshIntervalSec: asBoundedInt(input.autoRefreshIntervalSec, fallback.autoRefreshIntervalSec, 10, 1800),
    freshnessThresholdMinutes: {
      '5m': asBoundedInt(thresholds['5m'], fallback.freshnessThresholdMinutes['5m'], 5, 240),
      '15m': asBoundedInt(thresholds['15m'], fallback.freshnessThresholdMinutes['15m'], 10, 720),
      '1d': asBoundedInt(thresholds['1d'], fallback.freshnessThresholdMinutes['1d'], 60, 20160),
    }
  }
}

const loadPredictionSettingsFromDb = (): PredictionSettings => {
  const row = getDb()
    .prepare('SELECT value_json FROM app_preferences WHERE key = ? LIMIT 1')
    .get(PREDICTION_SETTINGS_KEY) as { value_json: string } | undefined
  if (!row?.value_json) return DEFAULT_PREDICTION_SETTINGS
  try {
    const parsed = JSON.parse(row.value_json)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREDICTION_SETTINGS
    return sanitizePredictionSettings(parsed as Record<string, unknown>, DEFAULT_PREDICTION_SETTINGS)
  } catch {
    return DEFAULT_PREDICTION_SETTINGS
  }
}

const mergePredictionSettings = (current: PredictionSettings, patch: Record<string, unknown>): PredictionSettings => {
  const patchThresholdNode = patch.freshnessThresholdMinutes
  const patchThresholds = patchThresholdNode && typeof patchThresholdNode === 'object'
    ? patchThresholdNode as Record<string, unknown>
    : {}
  return sanitizePredictionSettings({
    autoRefreshEnabled: patch.autoRefreshEnabled,
    autoRefreshIntervalSec: patch.autoRefreshIntervalSec,
    freshnessThresholdMinutes: {
      ...current.freshnessThresholdMinutes,
      ...patchThresholds,
    }
  }, current)
}

const savePredictionSettingsToDb = (settings: PredictionSettings): void => {
  const now = Math.floor(Date.now() / 1000)
  getDb().prepare(`
    INSERT INTO app_preferences (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(PREDICTION_SETTINGS_KEY, JSON.stringify(settings), now)
}

const omitSuccess = (value: Record<string, unknown>): Record<string, unknown> => {
  const rest = { ...value }
  delete rest.success
  return rest
}

const featureTaskFailure = (reason: string, details?: Record<string, unknown>) => {
  if (reason === 'dataset_not_found') return fail('FEATURE_DATASET_NOT_FOUND', '未找到目标数据集。', details)
  if (reason === 'dataset_not_frozen') return fail('FEATURE_DATASET_NOT_FROZEN', '仅支持从冻结数据集构建特征。', details)
  if (reason === 'strict_real_dataset_missing') return fail('FEATURE_STRICT_DATASET_MISSING', '严格真实数据模式下缺少可用数据。', details)
  if (reason === 'cli_exception') return fail('FEATURE_CLI_EXCEPTION', '特征构建进程启动失败。', details)
  return fail('FEATURE_TASK_FAILED', '特征构建失败，请检查任务日志。', details)
}

const modelTaskFailure = (reason: string, details?: Record<string, unknown>) => {
  if (reason === 'dataset_not_found') return fail('MODEL_DATASET_NOT_FOUND', '未找到目标数据集。', details)
  if (reason === 'dataset_not_frozen') return fail('MODEL_DATASET_NOT_FROZEN', '仅支持从冻结数据集训练模型。', details)
  if (reason === 'feature_not_ready') return fail('MODEL_FEATURE_NOT_READY', '请先完成对应规格的特征构建。', details)
  if (reason === 'train_exception') return fail('MODEL_TRAIN_EXCEPTION', '模型训练进程启动失败。', details)
  return fail('MODEL_TRAIN_FAILED', '模型训练失败，请检查任务日志。', details)
}

export const registerModelDatasetIpcHandlers = (deps: ModelDatasetDeps) => {
  const {
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
    resolveArtifactPath,
    toBooleanFlag
  } = deps

  ipcMain.handle('modeling:listDatasets', async () => {
    return getDb().prepare(`
      SELECT
        d.*,
        COUNT(i.id) AS item_count
      FROM dataset_versions d
      LEFT JOIN dataset_items i ON i.dataset_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at DESC
      LIMIT 100
    `).all()
  })

  ipcMain.handle('modeling:getDataset', async (_, datasetId: string) => {
    const database = getDb()
    const dataset = database.prepare('SELECT * FROM dataset_versions WHERE id = ? LIMIT 1').get(datasetId) as Record<string, unknown> | undefined
    if (!dataset) return null
    const items = database.prepare(`
      SELECT *
      FROM dataset_items
      WHERE dataset_id = ?
      ORDER BY bar_timestamp ASC
      LIMIT 1000
    `).all(datasetId)
    return { ...dataset, items }
  })

  ipcMain.handle('modeling:createDatasetDraft', async (_, input?: CreateDatasetDraftInput) => {
    return createDatasetDraft(input || {})
  })

  ipcMain.handle('modeling:getDatasetLabelDetails', async (_, datasetId: string, code: string, limit: number = 50) => {
    try {
      const result = await runLabelInspectCli({
        db: DB_PATH,
        datasetId,
        code,
        limit,
      })
      if (result.code !== 0) {
        return {
          success: false,
          error: `Label inspection failed (exit ${result.code})`,
          stderr: result.stderr.slice(-2000),
        }
      }
      if (!result.payload) {
        return {
          success: false,
          error: 'Label inspection returned empty payload',
          stdout: result.stdout.slice(-2000),
        }
      }
      return result.payload
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'unknown_error' }
    }
  })

  ipcMain.handle('modeling:previewDatasetDraftPolicies', async (_, input?: PreviewDatasetDraftPoliciesInput) => {
    const result = asRecord(previewDatasetDraftPolicies(input || {}))
    return ok({ preview: omitSuccess(result) })
  })

  ipcMain.handle('modeling:freezeDataset', async (_, datasetId: string) => {
    const dataset = freezeDataset(datasetId)
    if (!dataset) return fail('DATASET_FREEZE_NOT_FOUND', '未找到可冻结的数据集，或数据集状态不是草稿。', { datasetId })
    return ok({ datasetId, dataset: dataset as Record<string, unknown> })
  })

  ipcMain.handle('modeling:deleteDraftDataset', async (_, datasetId: string) => {
    const result = asRecord(deleteDraftDataset(datasetId))
    if (result.success !== true) {
      const reason = asString(result.reason, 'delete_failed')
      const codeMap: Record<string, string> = {
        invalid_dataset_id: 'DATASET_DELETE_INVALID_ID',
        dataset_not_found: 'DATASET_DELETE_NOT_FOUND',
        dataset_frozen: 'DATASET_DELETE_FROZEN_DENIED',
        dataset_not_draft: 'DATASET_DELETE_NOT_DRAFT',
        dataset_in_use: 'DATASET_DELETE_IN_USE',
        delete_failed: 'DATASET_DELETE_FAILED',
        delete_exception: 'DATASET_DELETE_EXCEPTION',
      }
      const messageMap: Record<string, string> = {
        invalid_dataset_id: '请选择有效的数据集后再删除。',
        dataset_not_found: '待删除的数据集不存在。',
        dataset_frozen: '冻结数据集不可删除。',
        dataset_not_draft: '仅支持删除草稿数据集。',
        dataset_in_use: '该草稿已被特征/训练任务引用，无法删除。',
        delete_failed: '删除数据集失败，请稍后重试。',
        delete_exception: '删除数据集时出现异常，请稍后重试。',
      }
      return fail(codeMap[reason] || 'DATASET_DELETE_FAILED', messageMap[reason] || `删除数据集失败：${reason}。`, result)
    }
    return ok({
      datasetId: asString(result.datasetId),
      datasetName: asString(result.datasetName),
      deletedItems: Number(result.deletedItems || 0),
    })
  })

  ipcMain.handle('modeling:compareDatasets', async (_, leftDatasetId: string, rightDatasetId: string) => {
    const result = asRecord(compareDatasets(leftDatasetId, rightDatasetId))
    if (result.success !== true) {
      const reason = asString(result.reason, 'compare_failed')
      const codeMap: Record<string, string> = {
        invalid_dataset_id: 'DATASET_COMPARE_INVALID_ID',
        same_dataset: 'DATASET_COMPARE_SAME_DATASET',
        dataset_not_found: 'DATASET_COMPARE_NOT_FOUND',
      }
      const messageMap: Record<string, string> = {
        invalid_dataset_id: '请选择两个有效的数据集。',
        same_dataset: '请选择两个不同的数据集进行对比。',
        dataset_not_found: '待对比的数据集不存在。',
      }
      return fail(codeMap[reason] || 'DATASET_COMPARE_FAILED', messageMap[reason] || `数据集对比失败：${reason}。`, result)
    }
    return ok({ comparison: omitSuccess(result) })
  })

  ipcMain.handle('modeling:rollbackDatasetToDraft', async (_, sourceDatasetId: string, draftName?: string) => {
    const result = asRecord(rollbackDatasetToDraft(sourceDatasetId, draftName))
    if (result.success !== true) {
      const reason = asString(result.reason, 'rollback_failed')
      const codeMap: Record<string, string> = {
        invalid_dataset_id: 'DATASET_ROLLBACK_INVALID_ID',
        dataset_not_found: 'DATASET_ROLLBACK_NOT_FOUND',
        source_not_frozen: 'DATASET_ROLLBACK_SOURCE_NOT_FROZEN',
      }
      const messageMap: Record<string, string> = {
        invalid_dataset_id: '请选择有效的数据集后再回滚。',
        dataset_not_found: '源数据集不存在。',
        source_not_frozen: '仅支持从冻结数据集回滚为草稿。',
      }
      return fail(codeMap[reason] || 'DATASET_ROLLBACK_FAILED', messageMap[reason] || `数据集回滚失败：${reason}。`, result)
    }
    return ok({
      sourceDatasetId,
      dataset: result.dataset && typeof result.dataset === 'object' ? result.dataset as Record<string, unknown> : null,
      importedCount: Number(result.importedCount || 0),
    })
  })

  ipcMain.handle('modeling:mergeDatasetsToDraft', async (
    _,
    leftDatasetId: string,
    rightDatasetId: string,
    input?: MergeDatasetsToDraftInput
  ) => {
    const result = asRecord(mergeDatasetsToDraft(leftDatasetId, rightDatasetId, input || {}))
    if (result.success !== true) {
      const reason = asString(result.reason, 'merge_failed')
      const codeMap: Record<string, string> = {
        invalid_dataset_id: 'DATASET_MERGE_INVALID_ID',
        same_dataset: 'DATASET_MERGE_SAME_DATASET',
        dataset_not_found: 'DATASET_MERGE_NOT_FOUND',
        dataset_not_frozen: 'DATASET_MERGE_NOT_FROZEN',
      }
      const messageMap: Record<string, string> = {
        invalid_dataset_id: '请选择两个有效的数据集后再合并。',
        same_dataset: '请选择两个不同的数据集进行合并。',
        dataset_not_found: '待合并的数据集不存在。',
        dataset_not_frozen: '仅支持合并冻结数据集。',
      }
      return fail(codeMap[reason] || 'DATASET_MERGE_FAILED', messageMap[reason] || `数据集合并失败：${reason}。`, result)
    }
    return ok({
      dataset: result.dataset && typeof result.dataset === 'object' ? result.dataset as Record<string, unknown> : null,
      importedCount: Number(result.importedCount || 0),
      conflictBarCount: Number(result.conflictBarCount || 0),
      recommendedPolicy: asString(result.recommendedPolicy),
    })
  })

  ipcMain.handle('modeling:listDatasetPolicyEvaluations', async (_, mode?: string, limit?: number) => {
    return listDatasetPolicyEvaluations(mode, limit)
  })

  ipcMain.handle('modeling:getDatasetPolicyTrendReport', async (_, limit?: number) => {
    return getDatasetPolicyTrendReport(limit)
  })

  ipcMain.handle('modeling:getDatasetPolicyOutcomeReport', async (_, limit?: number) => {
    return getDatasetPolicyOutcomeReport(limit)
  })

  ipcMain.handle('modeling:getDatasetPolicyPnlAttributionReport', async (_, limit?: number) => {
    return getDatasetPolicyPnlAttributionReport(limit)
  })

  ipcMain.handle('modeling:getDatasetPolicySignalTradingOutcomeReport', async (_, limit?: number) => {
    return getDatasetPolicySignalTradingOutcomeReport(limit)
  })

  ipcMain.handle('modeling:createFeatureBuildTask', async (_, datasetId: string, specVersion?: string, strictRealDataset?: boolean) => {
    const resolvedSpecVersion = specVersion || getActiveModelSpecVersion() || 'v001'
    const result = asRecord(await createFeatureBuildTask(datasetId, resolvedSpecVersion, toBooleanFlag(strictRealDataset)))
    const success = result.success === true
    const task = result.task && typeof result.task === 'object' ? result.task as Record<string, unknown> : null
    if (success) {
      return ok({
        taskId: asString(task?.id),
        task,
      })
    }
    return featureTaskFailure(asString(result.reason, 'task_failed'), {
      datasetId,
      specVersion: resolvedSpecVersion,
      strictRealDataset: toBooleanFlag(strictRealDataset),
      taskId: asString(task?.id),
    })
  })

  ipcMain.handle('modeling:listFeatureBuildTasks', async (_, datasetId?: string, limit?: number) => {
    const maxLimit = Math.min(200, Math.max(1, Number(limit || 50)))
    if (datasetId && datasetId.trim()) {
      return getDb().prepare(`
        SELECT
          t.*,
          COALESCE(d.name, '') AS dataset_name
        FROM feature_build_tasks t
        LEFT JOIN dataset_versions d ON d.id = t.dataset_id
        WHERE t.dataset_id = ?
        ORDER BY t.created_at DESC
        LIMIT ?
      `).all(datasetId.trim(), maxLimit)
    }
    return getDb().prepare(`
      SELECT
        t.*,
        COALESCE(d.name, '') AS dataset_name
      FROM feature_build_tasks t
      LEFT JOIN dataset_versions d ON d.id = t.dataset_id
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(maxLimit)
  })

  ipcMain.handle('modeling:getFeatureSampleAudit', async (_, featureTaskId: string) => {
    const id = asString(featureTaskId).trim()
    if (!id) return fail('FEATURE_AUDIT_INVALID_TASK', '特征任务ID不能为空。')

    const row = getDb().prepare(`
      SELECT id, dataset_id, spec_version, status, output_manifest_path
      FROM feature_build_tasks
      WHERE id = ?
      LIMIT 1
    `).get(id) as { id: string; dataset_id: string; spec_version: string; status: string; output_manifest_path?: string | null } | undefined

    if (!row) {
      return fail('FEATURE_AUDIT_TASK_NOT_FOUND', '未找到特征构建任务。', { featureTaskId: id })
    }
    if (row.status !== 'succeeded') {
      return fail('FEATURE_AUDIT_TASK_NOT_READY', '特征任务尚未成功完成。', { featureTaskId: id, status: row.status })
    }

    const manifestRaw = asString(row.output_manifest_path).trim()
    if (!manifestRaw) {
      return fail('FEATURE_AUDIT_MANIFEST_MISSING', '任务缺少 manifest 路径。', { featureTaskId: id })
    }

    const manifestPath = resolveArtifactPath(manifestRaw)
    if (!manifestPath) {
      return fail('FEATURE_AUDIT_MANIFEST_NOT_FOUND', 'manifest 文件不存在。', { featureTaskId: id, manifestPath: manifestRaw })
    }

    try {
      const result = await runFeatureSampleAuditCli(manifestPath)
      if (result.code !== 0 || !result.payload) {
        return fail('FEATURE_AUDIT_CLI_FAILED', `样本审计失败（exit ${result.code}）。`, {
          featureTaskId: id,
          command: result.command,
          stderr: result.stderr.slice(-1000),
          stdout: result.stdout.slice(-1000),
        })
      }
      return ok({
        featureTaskId: id,
        datasetId: row.dataset_id,
        specVersion: row.spec_version,
        audit: result.payload,
      })
    } catch (error) {
      return fail('FEATURE_AUDIT_EXCEPTION', error instanceof Error ? error.message : 'unknown_error', { featureTaskId: id })
    }
  })

  ipcMain.handle(
    'modeling:createModelTrainingTask',
    async (
      _,
      datasetId: string,
      specVersion?: string,
      taskType: string = 'buy_signal',
      engine: string = 'lightgbm',
      trials: number = 100,
      trainingOptions?: { numBoostRound?: number; earlyStoppingRounds?: number; runName?: string }
    ) => {
    const resolvedSpecVersion = specVersion || getActiveModelSpecVersion() || 'v001'
    const numBoostRound = parseOptionalBoundedInt(trainingOptions?.numBoostRound, 50, 5000)
    const earlyStoppingRounds = parseOptionalBoundedInt(trainingOptions?.earlyStoppingRounds, 10, 1000)
    const runName = trainingOptions?.runName?.trim() || undefined
    const result = asRecord(await createModelTrainingTask(
      datasetId,
      resolvedSpecVersion,
      taskType,
      engine,
      trials,
      { numBoostRound, earlyStoppingRounds, runName }
    ))
    const success = result.success === true
    const task = result.task && typeof result.task === 'object' ? result.task as Record<string, unknown> : null
    const model = result.model && typeof result.model === 'object' ? result.model as Record<string, unknown> : null
    if (success) {
      return ok({
        taskId: asString(task?.id),
        task,
        modelId: asString(model?.id),
        model,
      })
    }
    return modelTaskFailure(asString(result.reason, 'train_failed'), {
      datasetId,
      specVersion: resolvedSpecVersion,
      taskType,
      engine,
      trials,
      numBoostRound: numBoostRound ?? null,
      earlyStoppingRounds: earlyStoppingRounds ?? null,
      taskId: asString(task?.id),
      modelId: asString(model?.id),
    })
  })

  ipcMain.handle('modeling:listModelTrainingTasks', async (_, datasetId?: string, limit?: number) => {
    const maxLimit = Math.min(200, Math.max(1, Number(limit || 50)))
    if (datasetId && datasetId.trim()) {
      return getDb().prepare(`
        SELECT *
        FROM model_training_tasks
        WHERE dataset_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(datasetId.trim(), maxLimit)
    }
    return getDb().prepare(`
      SELECT *
      FROM model_training_tasks
      ORDER BY created_at DESC
      LIMIT ?
    `).all(maxLimit)
  })

  ipcMain.handle('modeling:deleteTrainingTask', async (_, taskId: string) => {
    if (!taskId || !taskId.trim()) return ok(false)
    const database = getDb()
    const task = database.prepare('SELECT id, status FROM model_training_tasks WHERE id = ?').get(taskId.trim()) as { id: string; status: string } | undefined
    if (!task) return fail('NOT_FOUND', `训练任务 ${taskId} 不存在`)
    if (task.status === 'running' || task.status === 'queued') return fail('TASK_RUNNING', '运行中的任务不能删除')
    database.prepare('DELETE FROM model_training_tasks WHERE id = ?').run(taskId.trim())
    return ok(true)
  })

  ipcMain.handle('modeling:deleteFeatureTask', async (_, taskId: string) => {
    if (!taskId || !taskId.trim()) return ok(false)
    const database = getDb()
    const task = database.prepare('SELECT id, status FROM feature_build_tasks WHERE id = ?').get(taskId.trim()) as { id: string; status: string } | undefined
    if (!task) return fail('NOT_FOUND', `特征任务 ${taskId} 不存在`)
    if (task.status === 'running') return fail('TASK_RUNNING', '运行中的特征任务不能删除')
    database.prepare('DELETE FROM feature_build_tasks WHERE id = ?').run(taskId.trim())
    return ok(true)
  })

  ipcMain.handle('modeling:deleteRetrainingRun', async (_, runId: string) => {
    if (!runId || !runId.trim()) return ok(false)
    const database = getDb()
    const run = database.prepare('SELECT id, status, activated, model_id FROM retraining_runs WHERE id = ?').get(runId.trim()) as { id: string; status: string; activated: number; model_id: string | null } | undefined
    if (!run) return fail('NOT_FOUND', `再训练记录 ${runId} 不存在`)
    if (run.status === 'running') return fail('RUN_RUNNING', '运行中的再训练不能删除')
    if (run.activated && run.model_id) {
      const model = database.prepare('SELECT status FROM model_versions WHERE id = ?').get(run.model_id) as { status: string } | undefined
      if (model?.status === 'active') return fail('MODEL_ACTIVE', '关联模型已激活，不能删除此再训练记录')
    }
    database.prepare('DELETE FROM retraining_runs WHERE id = ?').run(runId.trim())
    return ok(true)
  })

  ipcMain.handle('modeling:deleteLabelingTask', async (_, taskId: string) => {
    if (!taskId || !taskId.trim()) return ok(false)
    const database = getDb()
    const task = database.prepare('SELECT id, status FROM labeling_tasks WHERE id = ?').get(taskId.trim()) as { id: string; status: string } | undefined
    if (!task) return fail('NOT_FOUND', `标注任务 ${taskId} 不存在`)
    if (task.status === 'running') return fail('TASK_RUNNING', '运行中的标注任务不能删除')
    database.prepare('DELETE FROM labeling_tasks WHERE id = ?').run(taskId.trim())
    return ok(true)
  })

  ipcMain.handle('modeling:clearOldRecords', async (_, table: string, days: number) => {
    const database = getDb()
    const cutoff = Math.floor(Date.now() / 1000) - Math.max(7, Math.min(365, days)) * 86400
    const allowed = ['dataset_policy_evaluations', 'model_recommendations', 'candidate_review_logs']
    if (!allowed.includes(table)) return fail('INVALID_TABLE', `不支持清理表: ${table}`)
    const result = database.prepare(`DELETE FROM ${table} WHERE created_at < ?`).run(cutoff)
    return ok({ deleted: result.changes })
  })

  ipcMain.handle('modeling:updateTrainingTaskStatus', async (_, taskId: string, status: string) => {
    const allowed = ['queued', 'running', 'succeeded', 'failed']
    if (!allowed.includes(status)) return fail('INVALID_STATUS', `无效状态: ${status}，允许: ${allowed.join('/')}`)
    if (!taskId || !taskId.trim()) return ok(false)
    const database = getDb()
    const task = database.prepare('SELECT id FROM model_training_tasks WHERE id = ?').get(taskId.trim())
    if (!task) return fail('NOT_FOUND', `训练任务 ${taskId} 不存在`)
    const now = Math.floor(Date.now() / 1000)
    database.prepare('UPDATE model_training_tasks SET status = ?, finished_at = ? WHERE id = ?').run(status, now, taskId.trim())
    return ok(true)
  })

  ipcMain.handle('modeling:listModels', async () => {
    return getDb().prepare(`
      SELECT *
      FROM model_versions
      ORDER BY created_at DESC
      LIMIT 100
    `).all()
  })

  ipcMain.handle('modeling:getModel', async (_, modelId: string) => {
    const database = getDb()
    const model = database.prepare('SELECT * FROM model_versions WHERE id = ? LIMIT 1').get(modelId)
    if (!model) return null
    const evaluations = database.prepare(`
      SELECT *
      FROM model_evaluations
      WHERE model_id = ?
      ORDER BY created_at DESC
    `).all(modelId)
    return { ...model, evaluations }
  })

  ipcMain.handle('modeling:listModelEvaluations', async (_, modelId?: string, limit?: number) => {
    const maxLimit = Math.min(500, Math.max(1, Number(limit || 100)))
    if (modelId && modelId.trim()) {
      return getDb().prepare(`
        SELECT *
        FROM model_evaluations
        WHERE model_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(modelId.trim(), maxLimit)
    }
    return getDb().prepare(`
      SELECT *
      FROM model_evaluations
      ORDER BY created_at DESC
      LIMIT ?
    `).all(maxLimit)
  })

  ipcMain.handle('modeling:getActiveModel', async () => {
    return getDb().prepare(`
      SELECT *
      FROM model_versions
      WHERE status = 'active'
      ORDER BY activated_at DESC, created_at DESC
      LIMIT 1
    `).get()
  })

  ipcMain.handle('modeling:getPredictionSettings', async () => {
    return ok({
      settings: loadPredictionSettingsFromDb()
    })
  })

  ipcMain.handle('modeling:updatePredictionSettings', async (_, input?: Record<string, unknown>) => {
    const current = loadPredictionSettingsFromDb()
    const next = mergePredictionSettings(current, asRecord(input || {}))
    savePredictionSettingsToDb(next)
    return ok({
      settings: next
    })
  })

  ipcMain.handle('modeling:getOutcomeGateSettings', async () => {
    return ok({
      settings: loadOutcomeGateSettingsFromDb()
    })
  })

  ipcMain.handle('modeling:updateOutcomeGateSettings', async (_, input?: Record<string, unknown>) => {
    const current = loadOutcomeGateSettingsFromDb()
    const next = mergeOutcomeGateSettings(current, asRecord(input || {}))
    saveOutcomeGateSettingsToDb(next)
    return ok({
      settings: next
    })
  })

  ipcMain.handle('modeling:createEnsemble', async (_, trendModelId: string, reversalModelId: string, weightTrend: number = 0.6) => {
    try {
      const result = await runEnsemblePredictCli(trendModelId, reversalModelId, weightTrend)
      if (result.code !== 0) {
        return fail('MODEL_ENSEMBLE_FAILED', `集成模型运行失败（exit ${result.code}）。`, {
          stderr: result.stderr.slice(-2000),
        })
      }
      return ok({ result: result.payload })
    } catch (error) {
      return fail('MODEL_ENSEMBLE_EXCEPTION', error instanceof Error ? error.message : 'unknown_error')
    }
  })

  ipcMain.handle('modeling:ensembleWalkforward', async (_, params: {
    datasetId: string
    specVersion: string
    engines: string[]
    weights: number[]
    method: string
    threshold: number
    trainDays: number
    testDays: number
    stepDays: number
    maxWindows: number
    holdingDays: number
    maxPositions: number
    numBoostRound: number
  }) => {
    try {
      const result = await deps.runEnsembleWalkforwardCli(params)
      if (result.code !== 0) {
        return fail('ENSEMBLE_WF_FAILED', `集成 walk-forward 失败（exit ${result.code}）。`, {
          stderr: result.stderr.slice(-2000),
        })
      }
      return ok({ result: normalizeCliPayload(result.payload) })
    } catch (error) {
      return fail('ENSEMBLE_WF_EXCEPTION', error instanceof Error ? error.message : 'unknown_error')
    }
  })

  ipcMain.handle('modeling:predictLive', async (_, modelId: string, code: string, period: string) => {
    try {
      const result = await deps.runPredictLiveCli(modelId, code, period)
      if (result.code !== 0) {
        return fail('MODEL_PREDICT_LIVE_FAILED', `实时预测失败（exit ${result.code}）。`, {
          modelId,
          code,
          period,
          stderr: result.stderr.slice(-2000),
        })
      }
      return ok({ prediction: normalizeCliPayload(result.payload) })
    } catch (error) {
      return fail('MODEL_PREDICT_LIVE_EXCEPTION', error instanceof Error ? error.message : 'unknown_error', {
        modelId,
        code,
        period,
      })
    }
  })

  ipcMain.handle('modeling:predictBatch', async (_, modelId: string, codes: string[], period: string) => {
    try {
      const result = await deps.runPredictBatchCli(modelId, codes, period)
      if (result.code !== 0) {
        return fail('MODEL_PREDICT_BATCH_FAILED', `批量预测失败（exit ${result.code}）。`, {
          modelId,
          period,
          codeCount: codes.length,
          stderr: result.stderr.slice(-2000),
        })
      }
      return ok({ predictions: normalizeCliPayload(result.payload) })
    } catch (error) {
      return fail('MODEL_PREDICT_BATCH_EXCEPTION', error instanceof Error ? error.message : 'unknown_error', {
        modelId,
        period,
        codeCount: codes.length,
      })
    }
  })

  ipcMain.handle('modeling:predictSeries', async (_, modelId: string, code: string, period: string) => {
    try {
      const result = await deps.runPredictSeriesCli(modelId, code, period)
      if (result.code !== 0) {
        return fail('MODEL_PREDICT_SERIES_FAILED', `序列预测失败（exit ${result.code}）。`, {
          modelId,
          code,
          period,
          stderr: result.stderr.slice(-2000),
        })
      }
      return ok({ signals: normalizeCliPayload(result.payload) })
    } catch (error) {
      return fail('MODEL_PREDICT_SERIES_EXCEPTION', error instanceof Error ? error.message : 'unknown_error', {
        modelId,
        code,
        period,
      })
    }
  })

  ipcMain.handle('modeling:getModelArtifact', async (_, modelId: string) => {
    const database = getDb()
    const row = database.prepare('SELECT artifact_path FROM model_versions WHERE id = ?').get(modelId) as { artifact_path: string } | undefined
    if (!row?.artifact_path) return fail('MODEL_ARTIFACT_PATH_MISSING', '模型产物路径不存在。', { modelId })
    const absPath = deps.resolveArtifactPath(row.artifact_path)
    if (!absPath) return fail('MODEL_ARTIFACT_NOT_FOUND', '未找到模型产物文件。', { modelId, artifactPath: row.artifact_path })
    try {
      const raw = JSON.parse(readFileSync(absPath, 'utf-8'))
      return ok({
        artifact: {
          feature_importance: raw.feature_importance || {},
          best_params: raw.best_params || {},
          threshold: raw.threshold || 0.5,
          num_trees: raw.num_trees || 0,
          optuna_trials: raw.optuna_trials || 0,
          model_type: raw.model_type || 'baseline',
          task_type: raw.task_type || '',
          spec_version: raw.spec_version || '',
          dataset_id: raw.dataset_id || '',
          created_at: raw.created_at || '',
        }
      })
    } catch {
      return fail('MODEL_ARTIFACT_PARSE_ERROR', '模型产物解析失败。', { modelId, artifactPath: absPath })
    }
  })

  ipcMain.handle('modeling:getModelReport', async (_, modelId: string) => {
    const database = getDb()
    const row = database.prepare(
      "SELECT eval_report_path FROM model_training_tasks WHERE model_artifact_path LIKE '%' || ? || '%' AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1"
    ).get(modelId) as { eval_report_path: string } | undefined
    if (!row?.eval_report_path) return fail('MODEL_REPORT_PATH_MISSING', '模型评估报告路径不存在。', { modelId })
    const absPath = deps.resolveArtifactPath(row.eval_report_path)
    if (!absPath) return fail('MODEL_REPORT_NOT_FOUND', '未找到模型评估报告。', { modelId, reportPath: row.eval_report_path })
    try {
      const content = readFileSync(absPath, 'utf-8')
      return ok({ content })
    } catch {
      return fail('MODEL_REPORT_READ_ERROR', '模型评估报告读取失败。', { modelId, reportPath: absPath })
    }
  })

  ipcMain.handle('modeling:generateLabels', async (_, params: {
    labeler: string
    codes?: string[]
    start?: string
    end?: string
    strategy?: string
    qualityPreset?: string
    stockLimit?: number
    lookbackBars?: number
    minRequiredBars?: number
    forwardDays?: number
  }) => {
    try {
      const marketDb = resolveMarketDbPath()
      const result = await deps.runLabelGenerateCli({
        labeler: params.labeler,
        labelDb: DB_PATH,
        marketDb: marketDb.exists ? marketDb.path : DB_PATH,
        codes: params.codes,
        start: params.start,
        end: params.end,
        strategy: params.strategy,
        qualityPreset: params.qualityPreset,
        stockLimit: params.stockLimit,
        lookbackBars: params.lookbackBars,
        minRequiredBars: params.minRequiredBars,
        forwardDays: params.forwardDays,
        saveDb: true,
        onProgress: (msg: string) => {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send('modeling:labelProgress', msg)
          }
        },
      })
      if (result.code !== 0) {
        if (result.aborted) {
          return fail('LABEL_GENERATE_ABORTED', '标签生成已中止。')
        }
        return fail('LABEL_GENERATE_FAILED', `标签生成失败（exit ${result.code}）。`, {
          stderr: result.stderr.slice(-2000),
        })
      }
      return ok({
        output: result.payload,
        stdout: result.stdout,
        aborted: !!result.aborted,
      })
    } catch (error) {
      return fail('LABEL_GENERATE_EXCEPTION', error instanceof Error ? error.message : 'unknown_error')
    }
  })

  ipcMain.handle('modeling:runLabelingTask', async (_, params: {
    labeler: string
    qualityPreset?: string
    stockLimit?: number
    saveDb?: boolean
  }) => {
    return deps.runLabelGenerateCli({
      labeler: params.labeler,
      labelDb: DB_PATH,
      marketDb: DB_PATH,
      qualityPreset: params.qualityPreset || 'balanced',
      stockLimit: params.stockLimit,
      saveDb: params.saveDb ?? true,
    })
  })

  ipcMain.handle('modeling:cancelLabelGeneration', async () => {
    const result = deps.cancelLabelGenerateCli()
    if (!result.success) {
      return fail('LABEL_NOT_RUNNING', '当前没有正在运行的标签任务。')
    }
    return ok(result)
  })

  ipcMain.handle('modeling:listLabelers', async () => {
    try {
      const result = await deps.runListLabelersCli()
      if (result.code !== 0) {
        return fail('LIST_LABELERS_FAILED', `获取标签器列表失败（exit ${result.code}）。`)
      }
      return ok(result.labelers)
    } catch (error) {
      return fail('LIST_LABELERS_EXCEPTION', error instanceof Error ? error.message : 'unknown_error')
    }
  })

  ipcMain.handle('modeling:getSwingReviewQueue', async (_, params: {
    sampleSize?: number
    status?: string
    sourceStrategy?: string
    signalType?: string
    stratify?: boolean
    runId?: string
    latestRunOnly?: boolean
  }) => {
    const database = getDb()
    const safeParams = params || {}
    const sampleSize = Math.min(100, Math.max(5, Number(safeParams.sampleSize || 30)))
    const status = safeParams.status || 'proposed'
    const baseConditions: string[] = ['period = ?', 'status = ?']
    const baseValues: Array<string | number> = ['1d', status]

    if (safeParams.sourceStrategy) {
      baseConditions.push('source_strategy = ?')
      baseValues.push(safeParams.sourceStrategy)
    }

    const explicitRunId = safeParams.runId ? String(safeParams.runId).trim() : ''
    let selectedRunId = explicitRunId
    if (explicitRunId) {
      baseConditions.push("COALESCE(json_extract(payload, '$.run_meta.run_id'), '') = ?")
      baseValues.push(explicitRunId)
    } else if (safeParams.latestRunOnly !== false) {
      const latestRunConditions: string[] = ['period = ?']
      const latestRunValues: Array<string | number> = ['1d']
      if (safeParams.sourceStrategy) {
        latestRunConditions.push('source_strategy = ?')
        latestRunValues.push(safeParams.sourceStrategy)
      }
      latestRunConditions.push("COALESCE(json_extract(payload, '$.run_meta.run_id'), '') <> ''")
      const latestRun = database.prepare(`
        SELECT COALESCE(json_extract(payload, '$.run_meta.run_id'), '') AS run_id
        FROM signal_candidates
        WHERE ${latestRunConditions.join(' AND ')}
        ORDER BY created_at DESC, updated_at DESC, rowid DESC
        LIMIT 1
      `).get(...latestRunValues) as { run_id?: string } | undefined
      const latestRunId = String(latestRun?.run_id || '').trim()
      if (latestRunId) {
        selectedRunId = latestRunId
        baseConditions.push("COALESCE(json_extract(payload, '$.run_meta.run_id'), '') = ?")
        baseValues.push(latestRunId)
      }
    }
    const selectedSourceStrategy = safeParams.sourceStrategy ? String(safeParams.sourceStrategy).trim() : ''
    let selectedRunName = ''
    if (selectedRunId) {
      const runNameConditions: string[] = ["COALESCE(json_extract(payload, '$.run_meta.run_id'), '') = ?"]
      const runNameValues: Array<string | number> = [selectedRunId]
      if (selectedSourceStrategy) {
        runNameConditions.push('source_strategy = ?')
        runNameValues.push(selectedSourceStrategy)
      }
      const runNameRow = database.prepare(`
        SELECT COALESCE(json_extract(payload, '$.run_meta.run_name'), '') AS run_name
        FROM signal_candidates
        WHERE ${runNameConditions.join(' AND ')}
        ORDER BY created_at DESC, updated_at DESC, rowid DESC
        LIMIT 1
      `).get(...runNameValues) as { run_name?: string } | undefined
      selectedRunName = String(runNameRow?.run_name || '').trim()
    }
    const simpleWhere = `WHERE ${baseConditions.join(' AND ')}`
    const finalConditions: string[] = []
    const finalValues: Array<string | number> = []
    if (safeParams.signalType) {
      finalConditions.push('signal_type = ?')
      finalValues.push(safeParams.signalType)
    }

    let runStats: Record<string, unknown> = {}
    if (selectedRunId) {
      const runConditions = ['period = ?', "COALESCE(json_extract(payload, '$.run_meta.run_id'), '') = ?"]
      const runValues: Array<string | number> = ['1d', selectedRunId]
      if (selectedSourceStrategy) {
        runConditions.push('source_strategy = ?')
        runValues.push(selectedSourceStrategy)
      }
      runStats = database.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) AS proposed,
          SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          COUNT(DISTINCT code) AS stock_count,
          COUNT(DISTINCT CASE
            WHEN COALESCE(json_extract(payload, '$.pair_id'), '') <> ''
            THEN code || '|' || COALESCE(json_extract(payload, '$.pair_id'), '')
            ELSE NULL
          END) AS pair_count
        FROM signal_candidates
        WHERE ${runConditions.join(' AND ')}
      `).get(...runValues) as Record<string, unknown>
    }

    if (params.stratify) {
      const combinedWhere = finalConditions.length > 0
        ? `${simpleWhere} AND ${finalConditions.join(' AND ')}`
        : simpleWhere
      const codeGroups = database.prepare(`
        SELECT code, COUNT(*) as cnt
        FROM signal_candidates
        ${combinedWhere}
        GROUP BY code
        ORDER BY cnt DESC
        LIMIT 50
      `).all(...baseValues, ...finalValues) as Array<{ code: string; cnt: number }>

      if (codeGroups.length === 0) {
        return ok({
          samples: [],
          total: 0,
          runId: selectedRunId || null,
          runName: selectedRunName || null,
          sourceStrategy: selectedSourceStrategy || null,
          runStats,
        })
      }

      const topCodes = codeGroups.map((g) => g.code)
      const codePlaceholders = topCodes.map(() => '?').join(',')
      const samples = database.prepare(`
        SELECT * FROM signal_candidates
        WHERE ${[...baseConditions, ...finalConditions, `code IN (${codePlaceholders})`].join(' AND ')}
        ORDER BY RANDOM()
        LIMIT ?
      `).all(...baseValues, ...finalValues, ...topCodes, sampleSize) as Array<Record<string, unknown>>

      const total = database.prepare(`
        SELECT COUNT(*) as cnt FROM signal_candidates ${combinedWhere}
      `).get(...baseValues, ...finalValues) as { cnt: number }
      return ok({
        samples: samples.slice(0, sampleSize),
        total: total.cnt,
        runId: selectedRunId || null,
        runName: selectedRunName || null,
        sourceStrategy: selectedSourceStrategy || null,
        runStats,
      })
    }

    const samples = database.prepare(`
      SELECT * FROM signal_candidates
      ${finalConditions.length > 0 ? `WHERE ${[...baseConditions, ...finalConditions].join(' AND ')}` : simpleWhere}
      ORDER BY RANDOM()
      LIMIT ?
    `).all(...baseValues, ...finalValues, sampleSize) as Array<Record<string, unknown>>

    const total = database.prepare(`
      SELECT COUNT(*) as cnt FROM signal_candidates ${simpleWhere}
    `).get(...baseValues) as { cnt: number }
    return ok({
      samples,
      total: total.cnt,
      runId: selectedRunId || null,
      runName: selectedRunName || null,
      sourceStrategy: selectedSourceStrategy || null,
      runStats,
    })
  })

  ipcMain.handle('modeling:reviewSwingLabelRun', async (_, input?: {
    decision?: 'accept' | 'reject'
    runId?: string
    sourceStrategy?: string
    latestRunOnly?: boolean
    status?: string
  }) => {
    const database = getDb()
    const payload = input || {}
    const decision = payload.decision === 'reject' ? 'reject' : payload.decision === 'accept' ? 'accept' : ''
    if (!decision) {
      return fail('SWING_RUN_REVIEW_INVALID_DECISION', '整版审核仅支持 accept/reject。')
    }
    const targetStatus = decision === 'accept' ? 'accepted' : 'rejected'
    const fromStatus = payload.status ? String(payload.status).trim() : 'proposed'
    const sourceStrategy = payload.sourceStrategy ? String(payload.sourceStrategy).trim() : ''

    let runId = payload.runId ? String(payload.runId).trim() : ''
    if (!runId && payload.latestRunOnly !== false) {
      const latestRunConditions: string[] = ['period = ?', "COALESCE(json_extract(payload, '$.run_meta.run_id'), '') <> ''"]
      const latestRunValues: Array<string | number> = ['1d']
      if (sourceStrategy) {
        latestRunConditions.push('source_strategy = ?')
        latestRunValues.push(sourceStrategy)
      }
      const latestRun = database.prepare(`
        SELECT COALESCE(json_extract(payload, '$.run_meta.run_id'), '') AS run_id
        FROM signal_candidates
        WHERE ${latestRunConditions.join(' AND ')}
        ORDER BY created_at DESC, updated_at DESC, rowid DESC
        LIMIT 1
      `).get(...latestRunValues) as { run_id?: string } | undefined
      runId = String(latestRun?.run_id || '').trim()
    }

    if (!runId) {
      return fail('SWING_RUN_REVIEW_NO_RUN', '未找到可审核的打标版本。')
    }

    const whereParts = [
      "COALESCE(json_extract(payload, '$.run_meta.run_id'), '') = ?",
      'period = ?',
    ]
    const whereValues: Array<string | number> = [runId, '1d']
    if (sourceStrategy) {
      whereParts.push('source_strategy = ?')
      whereValues.push(sourceStrategy)
    }
    if (fromStatus) {
      whereParts.push('status = ?')
      whereValues.push(fromStatus)
    }

    const now = Math.floor(Date.now() / 1000)
    const updateResult = database.prepare(`
      UPDATE signal_candidates
      SET status = ?, updated_at = ?
      WHERE ${whereParts.join(' AND ')}
    `).run(targetStatus, now, ...whereValues)

    return ok({
      decision,
      runId,
      sourceStrategy: sourceStrategy || null,
      fromStatus,
      toStatus: targetStatus,
      updated: updateResult.changes || 0,
    })
  })

  ipcMain.handle('modeling:getSwingLabelDetails', async (_, input: {
    code: string
    signalType?: string
    sourceStrategy?: string
    status?: string
    pairOnly?: boolean
    limit?: number
    runId?: string
    latestRunOnly?: boolean
  } | string, legacySignalType?: string) => {
    const payload = typeof input === 'string'
      ? { code: input, signalType: legacySignalType }
      : (input || { code: '' })

    const code = String(payload.code || '').trim()
    if (!code) return fail('SWING_LABEL_DETAILS_INVALID_CODE', '标的代码不能为空。')

    const signalType = payload.signalType ? String(payload.signalType) : ''
    const sourceStrategy = payload.sourceStrategy ? String(payload.sourceStrategy) : ''
    const status = payload.status ? String(payload.status) : ''
    const pairOnly = payload.pairOnly !== false
    const limit = Math.max(20, Math.min(2000, Number(payload.limit || 1000)))

    const database = getDb()
    const conditions = ['code = ?', "period = '1d'"]
    const values: Array<string | number> = [code]
    if (sourceStrategy) {
      conditions.push('source_strategy = ?')
      values.push(sourceStrategy)
    }
    if (status) {
      conditions.push('status = ?')
      values.push(status)
    }
    const explicitRunId = payload.runId ? String(payload.runId).trim() : ''
    if (explicitRunId) {
      conditions.push("COALESCE(json_extract(payload, '$.run_meta.run_id'), '') = ?")
      values.push(explicitRunId)
    } else if (payload.latestRunOnly !== false) {
      const latestRunConditions = [...conditions, "COALESCE(json_extract(payload, '$.run_meta.run_id'), '') <> ''"]
      const latestRun = database.prepare(`
        SELECT COALESCE(json_extract(payload, '$.run_meta.run_id'), '') AS run_id
        FROM signal_candidates
        WHERE ${latestRunConditions.join(' AND ')}
        ORDER BY created_at DESC, updated_at DESC, rowid DESC
        LIMIT 1
      `).get(...values) as { run_id?: string } | undefined
      const latestRunId = String(latestRun?.run_id || '').trim()
      if (latestRunId) {
        conditions.push("COALESCE(json_extract(payload, '$.run_meta.run_id'), '') = ?")
        values.push(latestRunId)
      }
    }
    const scopedWhereSql = `WHERE ${conditions.join(' AND ')}`

    let signals: Array<Record<string, unknown>> = []
    let stats: Record<string, unknown> = {}

    if (pairOnly) {
      const dedupedPairScopeSql = `
        WITH scoped AS (
          SELECT rowid, *, COALESCE(json_extract(payload, '$.pair_id'), '') AS pair_id
          FROM signal_candidates
          ${scopedWhereSql}
        ),
        complete_pairs AS (
          SELECT code, source_strategy, period, status, pair_id
          FROM scoped
          WHERE pair_id <> ''
          GROUP BY code, source_strategy, period, status, pair_id
          HAVING SUM(CASE WHEN signal_type = 'buy' THEN 1 ELSE 0 END) > 0
            AND SUM(CASE WHEN signal_type = 'sell' THEN 1 ELSE 0 END) > 0
        ),
        dedup AS (
          SELECT s.*
          FROM scoped s
          INNER JOIN complete_pairs cp
            ON cp.code = s.code
            AND COALESCE(cp.source_strategy, '') = COALESCE(s.source_strategy, '')
            AND cp.period = s.period
            AND cp.status = s.status
            AND cp.pair_id = s.pair_id
          INNER JOIN (
            SELECT MAX(rowid) AS rowid
            FROM scoped
            WHERE pair_id <> ''
            GROUP BY code, COALESCE(source_strategy, ''), period, status, pair_id, signal_type
          ) latest ON latest.rowid = s.rowid
        )
      `
      const detailConditions: string[] = []
      const detailValues: Array<string | number> = []
      if (signalType) {
        detailConditions.push('signal_type = ?')
        detailValues.push(signalType)
      }
      const detailWhereSql = detailConditions.length > 0 ? `WHERE ${detailConditions.join(' AND ')}` : ''

      signals = database.prepare(`
        ${dedupedPairScopeSql}
        SELECT * FROM dedup
        ${detailWhereSql}
        ORDER BY bar_timestamp ASC
        LIMIT ?
      `).all(...values, ...detailValues, limit) as Array<Record<string, unknown>>

      stats = database.prepare(`
        ${dedupedPairScopeSql}
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN signal_type = 'buy' THEN 1 ELSE 0 END) as buy_count,
          SUM(CASE WHEN signal_type = 'sell' THEN 1 ELSE 0 END) as sell_count,
          SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted_count,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
          SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) as proposed_count
        FROM dedup
        ${detailWhereSql}
      `).get(...values, ...detailValues) as Record<string, unknown>
    } else {
      if (signalType) {
        conditions.push('signal_type = ?')
        values.push(signalType)
      }
      const whereSql = `WHERE ${conditions.join(' AND ')}`

      signals = database.prepare(`
        SELECT * FROM signal_candidates
        ${whereSql}
        ORDER BY bar_timestamp ASC
        LIMIT ?
      `).all(...values, limit) as Array<Record<string, unknown>>

      stats = database.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN signal_type = 'buy' THEN 1 ELSE 0 END) as buy_count,
          SUM(CASE WHEN signal_type = 'sell' THEN 1 ELSE 0 END) as sell_count,
          SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted_count,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
          SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) as proposed_count
        FROM signal_candidates
        ${whereSql}
      `).get(...values) as Record<string, unknown>
    }

    return ok({ signals, stats })
  })

  ipcMain.handle('modeling:listSwingLabelRuns', async (_, input?: {
    sourceStrategy?: string
    limit?: number
    includeRejected?: boolean
  }) => {
    const database = getDb()
    const payload = input || {}
    const limit = Math.min(300, Math.max(10, Number(payload.limit || 80)))
    const whereParts: string[] = [
      "COALESCE(json_extract(payload, '$.run_meta.run_id'), '') <> ''",
      "period = '1d'",
    ]
    const values: Array<string | number> = []
    if (payload.sourceStrategy && String(payload.sourceStrategy).trim()) {
      whereParts.push('source_strategy = ?')
      values.push(String(payload.sourceStrategy).trim())
    }
    if (!payload.includeRejected) {
      whereParts.push("status <> 'rejected'")
    }
    const rows = database.prepare(`
      SELECT
        COALESCE(json_extract(payload, '$.run_meta.run_id'), '') AS run_id,
        COALESCE(json_extract(payload, '$.run_meta.run_name'), '') AS run_name,
        COALESCE(source_strategy, '') AS source_strategy,
        MAX(created_at) AS created_at,
        MAX(updated_at) AS updated_at,
        COUNT(*) AS total_count,
        SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) AS proposed_count,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
        COUNT(DISTINCT code) AS stock_count,
        COUNT(DISTINCT CASE
          WHEN COALESCE(json_extract(payload, '$.pair_id'), '') <> ''
          THEN code || '|' || COALESCE(json_extract(payload, '$.pair_id'), '')
          ELSE NULL
        END) AS pair_count
      FROM signal_candidates
      WHERE ${whereParts.join(' AND ')}
      GROUP BY run_id, run_name, source_strategy
      ORDER BY created_at DESC, updated_at DESC
      LIMIT ?
    `).all(...values, limit) as Array<Record<string, unknown>>

    const items = rows.map((row) => {
      const proposed = Number(row.proposed_count || 0)
      const accepted = Number(row.accepted_count || 0)
      const rejected = Number(row.rejected_count || 0)
      const state = proposed > 0
        ? 'proposed'
        : accepted > 0 && rejected === 0
          ? 'accepted'
          : accepted > 0 && rejected > 0
            ? 'mixed'
            : rejected > 0
              ? 'rejected'
              : 'unknown'
      return {
        runId: String(row.run_id || ''),
        runName: String(row.run_name || ''),
        sourceStrategy: String(row.source_strategy || ''),
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
        total: Number(row.total_count || 0),
        proposed,
        accepted,
        rejected,
        stockCount: Number(row.stock_count || 0),
        pairCount: Number(row.pair_count || 0),
        state,
      }
    })
    return ok({ runs: items, total: items.length })
  })

  ipcMain.handle('modeling:createDatasetDraftFromRuns', async (_, input?: {
    runIds?: string[]
    name?: string
    sourceStrategy?: string
    conflictPolicy?: 'keep_all' | 'single_best'
    includeStatuses?: Array<'accepted' | 'proposed' | 'rejected'>
    limit?: number
    qualityFilter?: {
      labelMode: 'triple_barrier' | 'binary_profit' | 'raw'
      minProfitPct?: number
      minDrawdownRatio?: number
      minHoldDays?: number
    }
  }) => {
    const database = getDb()
    const payload = input || {}
    const runIds = Array.isArray(payload.runIds)
      ? payload.runIds.map((id) => String(id || '').trim()).filter((id) => id.length > 0)
      : []
    if (runIds.length === 0) {
      return fail('DATASET_RUNS_EMPTY', '请至少选择一个标签版本。')
    }
    const includeStatuses = Array.isArray(payload.includeStatuses) && payload.includeStatuses.length > 0
      ? payload.includeStatuses
      : ['accepted']
    const allowedStatuses = includeStatuses
      .map((s) => String(s))
      .filter((s) => s === 'accepted' || s === 'proposed' || s === 'rejected')
    if (allowedStatuses.length === 0) {
      return fail('DATASET_RUNS_INVALID_STATUS', '无效的状态过滤条件。')
    }
    const conflictPolicy = payload.conflictPolicy === 'single_best' ? 'single_best' : 'keep_all'
    const limit = Math.min(50000, Math.max(100, Number(payload.limit || 15000)))
    const sourceStrategy = payload.sourceStrategy ? String(payload.sourceStrategy).trim() : ''

    const now = Math.floor(Date.now() / 1000)
    const datasetId = `dataset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const dateTag = new Date().toISOString().slice(2, 10).replace(/-/g, '')
    const datasetName = payload.name?.trim() || `版本草稿-${dateTag}-${Math.random().toString(36).slice(2, 5)}`

    const whereParts: string[] = [
      "period = '1d'",
      `COALESCE(json_extract(payload, '$.run_meta.run_id'), '') IN (${runIds.map(() => '?').join(',')})`,
      `status IN (${allowedStatuses.map(() => '?').join(',')})`,
    ]
    const whereValues: Array<string | number> = [...runIds, ...allowedStatuses]
    if (sourceStrategy) {
      whereParts.push('source_strategy = ?')
      whereValues.push(sourceStrategy)
    }

    const qf = payload.qualityFilter || { labelMode: 'raw' }
    const sourceFilter = JSON.stringify({
      type: 'run_based',
      runIds,
      sourceStrategy: sourceStrategy || null,
      includeStatuses: allowedStatuses,
      conflictPolicy,
      limit,
      qualityFilter: qf,
    })

    database.prepare(`
      INSERT INTO dataset_versions (id, name, status, description, source_filter, sample_count, created_at, updated_at)
      VALUES (?, ?, 'draft', ?, ?, 0, ?, ?)
    `).run(datasetId, datasetName, '由标签版本构建的数据集草稿', sourceFilter, now, now)

    const candidates = database.prepare(`
      SELECT id, code, period, bar_timestamp, signal_type, factor_type, score, payload, created_at
      FROM signal_candidates
      WHERE ${whereParts.join(' AND ')}
      ORDER BY bar_timestamp ASC, score DESC, created_at ASC
      LIMIT ?
    `).all(...whereValues, limit) as Array<{
      id: string
      code: string
      period: string
      bar_timestamp: number
      signal_type: 'buy' | 'sell'
      factor_type: string | null
      score: number
      payload: string | null
      created_at: number
    }>

    let selectedCandidates = candidates
    if (conflictPolicy === 'single_best') {
      const bestByBar = new Map<string, (typeof candidates)[number]>()
      for (const candidate of candidates) {
        const key = `${candidate.code}|${candidate.period}|${candidate.bar_timestamp}|${candidate.signal_type}`
        const existed = bestByBar.get(key)
        if (!existed || Number(candidate.score || 0) > Number(existed.score || 0)) {
          bestByBar.set(key, candidate)
        }
      }
      selectedCandidates = Array.from(bestByBar.values()).sort((a, b) => a.bar_timestamp - b.bar_timestamp)
    }

    if (qf.labelMode !== 'raw' && qf.labelMode) {
      const minProfit = Number(qf.minProfitPct || 0)
      const minDDRatio = Number(qf.minDrawdownRatio || 0)
      const minHold = Number(qf.minHoldDays || 0)
      selectedCandidates = selectedCandidates.filter((c) => {
        let p: Record<string, unknown> = {}
        try { p = JSON.parse(c.payload || '{}') } catch { return true }

        const outcome = String(p.outcome || p.barrier_result || p.exit_reason || '')
        const profitPct = Math.abs(Number(p.max_profit_pct || p.forward_max_profit_pct || p.profit_pct || p.forward_exit_return_pct || 0))
        const drawdownPct = Math.abs(Number(p.max_drawdown_pct || p.forward_max_drawdown_pct || 0))
        const holdDays = Number(p.hold_days || p.forward_holding_days || 0)
        const isProfitable = p.is_profitable === true || p.is_profitable === 1

        if (qf.labelMode === 'triple_barrier') {
          const isTP = outcome === 'take_profit' || outcome === 'swing_high' || isProfitable
          const isSL = outcome === 'stop_loss' || outcome === 'distribution'
          if (isTP) {
            if (minProfit > 0 && profitPct < minProfit) return false
            if (minDDRatio > 0 && drawdownPct > 0 && (profitPct / drawdownPct) < minDDRatio) return false
            if (minHold > 0 && holdDays < minHold) return false
            return true
          }
          if (isSL) return true
          return false
        }
        if (qf.labelMode === 'binary_profit') {
          if (profitPct > 0) {
            return profitPct >= minProfit
          }
          return isProfitable
        }
        return true
      })
    }

    for (let index = 0; index < selectedCandidates.length; index++) {
      const candidate = selectedCandidates[index]
      if (!candidate) continue
      let labelType = candidate.signal_type
      if (qf.labelMode === 'triple_barrier') {
        let p: Record<string, unknown> = {}
        try { p = JSON.parse(candidate.payload || '{}') } catch { /* ignore */ }
        const outcome = String(p.outcome || p.barrier_result || p.exit_reason || '')
        const isTP = outcome === 'take_profit' || outcome === 'swing_high' || p.is_profitable === true || p.is_profitable === 1
        labelType = isTP ? 'buy' : 'sell'
      } else if (qf.labelMode === 'binary_profit') {
        labelType = 'buy'
      }
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
        labelType,
        candidate.factor_type,
        now
      )
    }

    const sampleCountRow = database.prepare('SELECT COUNT(*) AS cnt FROM dataset_items WHERE dataset_id = ?').get(datasetId) as { cnt: number } | undefined
    const sampleCount = Number(sampleCountRow?.cnt || 0)
    database.prepare('UPDATE dataset_versions SET sample_count = ?, updated_at = ? WHERE id = ?').run(sampleCount, now, datasetId)
    const dataset = database.prepare('SELECT * FROM dataset_versions WHERE id = ? LIMIT 1').get(datasetId) as Record<string, unknown> | undefined
    return ok({
      dataset: dataset || { id: datasetId, name: datasetName, status: 'draft' },
      importedCount: sampleCount,
      selectedRunCount: runIds.length,
      conflictPolicy,
    })
  })
}
