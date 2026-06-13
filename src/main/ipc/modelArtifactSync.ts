import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDb } from '../db'
import { resolvePythonWorkspace } from './modelCliRunner'
import { fail, ok } from './platformResult'

export interface DiscoveredModelArtifact {
  modelId: string
  modelName: string
  modelType: string
  taskType: string
  datasetId: string
  specVersion: string
  threshold: number
  artifactPath: string
  evalJsonPath: string | null
  reportPath: string | null
  backtestPath: string | null
  createdAt: number
  createdAtText: string
  mtimeMs: number
  raw: Record<string, unknown>
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

interface ParsedModelArtifact {
  modelId: string
  modelName: string
  modelType: string
  taskType: string
  datasetId: string
  specVersion: string
  threshold: number
  createdAt: number
}

const ARTIFACT_SUFFIX_BLACKLIST = [
  '.eval.json',
  '.backtest.json',
  '.report.md',
]

const ARTIFACT_PREFIX_BLACKLIST = [
  'walk_forward_',
  'holding_days_experiment_',
  'minute_quality_',
  'experiment_matrix_',
  'batch_backtest_',
  'wf_compare_',
  'predict_',
]

const uniquePaths = (values: Array<string | null | undefined>): string[] => {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
}

const resolveModelSearchRoots = (): string[] => {
  const workspace = resolvePythonWorkspace()
  return uniquePaths([
    path.join(process.cwd(), 'models'),
    workspace ? path.join(workspace, 'models') : null,
    path.join(app.getAppPath(), 'models'),
  ])
}

const parseDateLike = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value >= 1_000_000_000_000 ? Math.floor(value) : Math.floor(value * 1000)
  }
  if (typeof value === 'string' && value.trim()) {
    const raw = value.trim()
    if (/^\d{10,13}$/.test(raw)) {
      const asNumber = Number(raw)
      return asNumber >= 1_000_000_000_000 ? Math.floor(asNumber) : Math.floor(asNumber * 1000)
    }
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

const readJson = (filePath: string): Record<string, unknown> | null => {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

const getSiblingPath = (artifactPath: string, replacement: string): string | null => {
  if (!artifactPath) return null
  return artifactPath.replace(/\.json$/i, replacement)
}

const isModelArtifactFile = (fileName: string): boolean => {
  if (!fileName.endsWith('.json')) return false
  if (ARTIFACT_SUFFIX_BLACKLIST.some((suffix) => fileName.endsWith(suffix))) return false
  if (ARTIFACT_PREFIX_BLACKLIST.some((prefix) => fileName.startsWith(prefix))) return false
  return true
}

const parseModelArtifact = (filePath: string, raw: Record<string, unknown>): ParsedModelArtifact | null => {
  const modelId = typeof raw.model_id === 'string' ? raw.model_id.trim() : ''
  const specVersion = typeof raw.spec_version === 'string' ? raw.spec_version.trim() : ''
  const datasetId = typeof raw.dataset_id === 'string' ? raw.dataset_id.trim() : ''
  if (!modelId || !specVersion || !datasetId) return null

  const engineTag = (typeof raw.model_type === 'string' && raw.model_type.trim())
    ? raw.model_type.trim().replace('lightgbm', 'lgbm').replace('catboost', 'cb').replace('baseline', 'base')
    : 'model'
  const taskLabel = (typeof raw.task_type === 'string' && raw.task_type.includes('sell')) ? '卖点' : '买点'
  const modelName = typeof raw.model_name === 'string' && raw.model_name.trim()
    ? raw.model_name.trim()
    : `${engineTag}-${taskLabel}-${specVersion}`
  const modelType = typeof raw.model_type === 'string' && raw.model_type.trim()
    ? raw.model_type.trim()
    : 'lightgbm'
  const taskType = typeof raw.task_type === 'string' && raw.task_type.trim()
    ? raw.task_type.trim()
    : 'buy_signal'
  const threshold = typeof raw.threshold === 'number' && Number.isFinite(raw.threshold)
    ? raw.threshold
    : 0.5
  const createdAt = parseDateLike(raw.created_at) || fs.statSync(filePath).mtimeMs

  return {
    modelId,
    modelName,
    modelType,
    taskType,
    datasetId,
    specVersion,
    threshold,
    createdAt,
  }
}

const discoverModelArtifactsFromRoot = (rootDir: string): DiscoveredModelArtifact[] => {
  if (!fs.existsSync(rootDir)) return []

  const artifacts: DiscoveredModelArtifact[] = []
  for (const fileName of fs.readdirSync(rootDir)) {
    if (!isModelArtifactFile(fileName)) continue
    const artifactPath = path.join(rootDir, fileName)
    const raw = readJson(artifactPath)
    if (!raw) continue
    const parsed = parseModelArtifact(artifactPath, raw)
    if (!parsed) continue

    const evalJsonPath = getSiblingPath(artifactPath, '.eval.json')
    const reportPath = getSiblingPath(artifactPath, '.report.md')
    const backtestPath = getSiblingPath(artifactPath, '.backtest.json')
    artifacts.push({
      modelId: parsed.modelId,
      modelName: parsed.modelName,
      modelType: parsed.modelType,
      taskType: parsed.taskType,
      datasetId: parsed.datasetId,
      specVersion: parsed.specVersion,
      threshold: parsed.threshold,
      artifactPath,
      evalJsonPath: evalJsonPath && fs.existsSync(evalJsonPath) ? evalJsonPath : null,
      reportPath: reportPath && fs.existsSync(reportPath) ? reportPath : null,
      backtestPath: backtestPath && fs.existsSync(backtestPath) ? backtestPath : null,
      createdAt: parsed.createdAt,
      createdAtText: typeof raw.created_at === 'string'
        ? raw.created_at
        : new Date(parsed.createdAt).toISOString(),
      mtimeMs: fs.statSync(artifactPath).mtimeMs,
      raw,
    })
  }
  return artifacts
}

export const discoverModelArtifacts = (): DiscoveredModelArtifact[] => {
  const roots = resolveModelSearchRoots()
  const byModelId = new Map<string, DiscoveredModelArtifact>()

  for (const root of roots) {
    for (const artifact of discoverModelArtifactsFromRoot(root)) {
      const existing = byModelId.get(artifact.modelId)
      if (!existing) {
        byModelId.set(artifact.modelId, artifact)
        continue
      }
      const nextScore = [
        artifact.createdAt,
        artifact.mtimeMs,
        artifact.evalJsonPath ? 1 : 0,
        artifact.reportPath ? 1 : 0,
      ]
      const currentScore = [
        existing.createdAt,
        existing.mtimeMs,
        existing.evalJsonPath ? 1 : 0,
        existing.reportPath ? 1 : 0,
      ]
      if (
        nextScore[0] > currentScore[0]
        || (nextScore[0] === currentScore[0] && nextScore[1] > currentScore[1])
        || (nextScore[0] === currentScore[0] && nextScore[1] === currentScore[1] && nextScore[2] > currentScore[2])
        || (nextScore[0] === currentScore[0] && nextScore[1] === currentScore[1] && nextScore[2] === currentScore[2] && nextScore[3] > currentScore[3])
      ) {
        byModelId.set(artifact.modelId, artifact)
      }
    }
  }

  return Array.from(byModelId.values()).sort((left, right) => {
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
    return right.modelId.localeCompare(left.modelId)
  })
}

const loadEvalMetrics = (evalJsonPath: string | null): Record<string, unknown> | null => {
  if (!evalJsonPath || !fs.existsSync(evalJsonPath)) return null
  const raw = readJson(evalJsonPath)
  if (!raw) return null
  const metrics = raw.metrics && typeof raw.metrics === 'object'
    ? raw.metrics as Record<string, unknown>
    : raw
  return metrics
}

const ensureDatasetRecord = (database: ReturnType<typeof getDb>, artifact: DiscoveredModelArtifact, now: number): boolean => {
  const exists = database.prepare('SELECT id FROM dataset_versions WHERE id = ? LIMIT 1').get(artifact.datasetId)
  if (exists) return false

  database.prepare(`
    INSERT INTO dataset_versions (
      id, name, status, description, source_filter, sample_count, created_at, updated_at, frozen_at
    )
    VALUES (?, ?, 'frozen', ?, ?, 0, ?, ?, ?)
  `).run(
    artifact.datasetId,
    `同步数据集-${artifact.datasetId.slice(-8)}`,
    `Auto-created while syncing model artifact ${artifact.modelId}.`,
    JSON.stringify({
      source: 'artifact_sync',
      model_id: artifact.modelId,
      artifact_path: artifact.artifactPath,
    }),
    now,
    now,
    now
  )
  return true
}

const ensureTrainingTaskRecord = (
  database: ReturnType<typeof getDb>,
  artifact: DiscoveredModelArtifact,
  taskId: string,
  metricsJson: string | null,
  reportPath: string | null,
  now: number
): { taskId: string; created: boolean } => {
  const existing = database.prepare('SELECT id FROM model_training_tasks WHERE id = ? LIMIT 1').get(taskId)
  if (existing) {
    const updateValues: Array<string | number | null> = [
      artifact.datasetId,
      artifact.specVersion,
      artifact.taskType,
      'artifact_sync',
      artifact.artifactPath,
      reportPath,
      now,
      now,
      taskId,
    ]
    const metricsColumn = metricsJson !== null ? ', metrics_json = ?' : ''
    if (metricsJson !== null) {
      updateValues.splice(6, 0, metricsJson)
    }
    database.prepare(`
      UPDATE model_training_tasks
      SET
        dataset_id = ?,
        spec_version = ?,
        task_type = ?,
        status = 'succeeded',
        command = ?,
        model_artifact_path = ?,
        eval_report_path = ?${metricsColumn},
        finished_at = ?,
        started_at = COALESCE(started_at, ?),
        error_message = NULL
      WHERE id = ?
    `).run(...updateValues)
    return { taskId, created: false }
  }

  database.prepare(`
    INSERT INTO model_training_tasks (
      id, dataset_id, spec_version, task_type, status, feature_task_id, command, model_artifact_path,
      eval_report_path, metrics_json, created_at, started_at, finished_at
    )
    VALUES (?, ?, ?, ?, 'succeeded', NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    artifact.datasetId,
    artifact.specVersion,
    artifact.taskType,
    'artifact_sync',
    artifact.artifactPath,
    reportPath,
    metricsJson,
    now,
    now,
    now
  )
  return { taskId, created: true }
}

const insertModelEvaluations = (
  database: ReturnType<typeof getDb>,
  modelId: string,
  metrics: Record<string, unknown> | null,
  now: number
): number => {
  if (!metrics) return 0

  const splitNames = ['train', 'valid', 'test']
  database.prepare('DELETE FROM model_evaluations WHERE model_id = ?').run(modelId)
  let inserted = 0
  for (const split of splitNames) {
    const splitMetrics = metrics[split]
    if (!splitMetrics || typeof splitMetrics !== 'object') continue
    const record = splitMetrics as Record<string, unknown>
    database.prepare(`
      INSERT INTO model_evaluations (
        id, model_id, split, accuracy, precision, recall, f1, sample_count, report_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `import_eval_${modelId}_${split}_${Math.random().toString(36).slice(2, 6)}`,
      modelId,
      split,
      typeof record.accuracy === 'number' ? record.accuracy : null,
      typeof record.precision === 'number' ? record.precision : null,
      typeof record.recall === 'number' ? record.recall : null,
      typeof record.f1 === 'number' ? record.f1 : null,
      typeof record.sample_count === 'number' ? record.sample_count : null,
      JSON.stringify(record),
      now
    )
    inserted += 1
  }
  return inserted
}

const upsertModelVersion = (
  database: ReturnType<typeof getDb>,
  artifact: DiscoveredModelArtifact,
  taskId: string,
  metricsJson: string | null,
  now: number
): { action: 'imported' | 'updated'; trainingTaskId: string } => {
  const existing = database.prepare(`
    SELECT id, name, status, training_task_id, activated_at
    FROM model_versions
    WHERE id = ?
    LIMIT 1
  `).get(artifact.modelId) as {
    id: string
    name: string
    status: string
    training_task_id: string
    activated_at?: number | null
  } | undefined

  if (!existing) {
    const parsed = metricsJson ? (() => { try { return JSON.parse(metricsJson) } catch { return null } })() : null
    const test = parsed?.test || {}
    const train = parsed?.train || {}
    database.prepare(`
      INSERT INTO model_versions (
        id, name, status, task_type, dataset_id, spec_version, training_task_id, artifact_path, metrics_json, created_at,
        test_auc, test_accuracy, test_f1, test_precision, test_recall, train_auc
      )
      VALUES (?, ?, 'inactive', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifact.modelId,
      artifact.modelName,
      artifact.taskType,
      artifact.datasetId,
      artifact.specVersion,
      taskId,
      artifact.artifactPath,
      metricsJson,
      artifact.createdAt || now,
      typeof test.auc === 'number' ? test.auc : null,
      typeof test.accuracy === 'number' ? test.accuracy : null,
      typeof test.f1 === 'number' ? test.f1 : null,
      typeof test.precision === 'number' ? test.precision : null,
      typeof test.recall === 'number' ? test.recall : null,
      typeof train.auc === 'number' ? train.auc : null
    )
    return { action: 'imported', trainingTaskId: taskId }
  }

  const nextName = existing.name && existing.name !== existing.id && existing.name.trim().length > 0
    ? existing.name
    : artifact.modelName
  const nextMetricsJson = metricsJson ?? null

  if (nextMetricsJson !== null) {
    const parsed = (() => { try { return JSON.parse(nextMetricsJson) } catch { return null } })()
    const test = parsed?.test || {}
    const train = parsed?.train || {}
    database.prepare(`
      UPDATE model_versions
      SET
        name = ?,
        task_type = ?,
        dataset_id = ?,
        spec_version = ?,
        artifact_path = ?,
        metrics_json = ?,
        test_auc = ?,
        test_accuracy = ?,
        test_f1 = ?,
        test_precision = ?,
        test_recall = ?,
        train_auc = ?
      WHERE id = ?
    `).run(
      nextName,
      artifact.taskType,
      artifact.datasetId,
      artifact.specVersion,
      artifact.artifactPath,
      nextMetricsJson,
      typeof test.auc === 'number' ? test.auc : null,
      typeof test.accuracy === 'number' ? test.accuracy : null,
      typeof test.f1 === 'number' ? test.f1 : null,
      typeof test.precision === 'number' ? test.precision : null,
      typeof test.recall === 'number' ? test.recall : null,
      typeof train.auc === 'number' ? train.auc : null,
      artifact.modelId
    )
  } else {
    database.prepare(`
      UPDATE model_versions
      SET
        name = ?,
        task_type = ?,
        dataset_id = ?,
        spec_version = ?,
        artifact_path = ?
      WHERE id = ?
    `).run(
      nextName,
      artifact.taskType,
      artifact.datasetId,
      artifact.specVersion,
      artifact.artifactPath,
      artifact.modelId
    )
  }

  database.prepare(`
    UPDATE model_versions
    SET created_at = COALESCE(created_at, ?)
    WHERE id = ?
  `).run(artifact.createdAt || now, artifact.modelId)

  return { action: 'updated', trainingTaskId: existing.training_task_id }
}

export const syncModelArtifactsIntoDatabase = (): {
  success: true
  summary: ModelArtifactSyncData
} | {
  success: false
  reason: string
  summary: ModelArtifactSyncData
} => {
  const artifacts = discoverModelArtifacts()
  const database = getDb()
  const now = Math.floor(Date.now() / 1000)
  const summary: ModelArtifactSyncData = {
    scannedCount: artifacts.length,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    datasetCreatedCount: 0,
    taskCreatedCount: 0,
    evaluationCount: 0,
    items: [],
  }

  try {
    database.transaction(() => {
      for (const artifact of artifacts) {
        if (!artifact.modelId || !artifact.datasetId || !artifact.specVersion) {
          summary.skippedCount += 1
          summary.items.push({
            modelId: artifact.modelId || '',
            modelName: artifact.modelName || artifact.modelId,
            modelType: artifact.modelType || 'lightgbm',
            taskType: artifact.taskType || 'buy_signal',
            datasetId: artifact.datasetId || '',
            specVersion: artifact.specVersion || '',
            artifactPath: artifact.artifactPath,
            reportPath: artifact.reportPath,
            action: 'skipped',
            reason: 'missing_required_fields',
          })
          continue
        }

        const metrics = loadEvalMetrics(artifact.evalJsonPath)
        const metricsJson = metrics ? JSON.stringify(metrics) : null
        const reportPath = artifact.reportPath || artifact.evalJsonPath
        const datasetCreated = ensureDatasetRecord(database, artifact, now)
        const upsertResult = upsertModelVersion(
          database,
          artifact,
          `import_${artifact.modelId}`,
          metricsJson,
          now
        )

        if (datasetCreated) summary.datasetCreatedCount += 1
        const taskResult = ensureTrainingTaskRecord(database, artifact, upsertResult.trainingTaskId, metricsJson, reportPath, now)
        summary.taskCreatedCount += taskResult.created ? 1 : 0
        const evalCount = insertModelEvaluations(database, artifact.modelId, metrics, now)
        summary.evaluationCount += evalCount
        if (upsertResult.action === 'imported') summary.importedCount += 1
        else summary.updatedCount += 1

        summary.items.push({
          modelId: artifact.modelId,
          modelName: artifact.modelName,
          modelType: artifact.modelType,
          taskType: artifact.taskType,
          datasetId: artifact.datasetId,
          specVersion: artifact.specVersion,
          artifactPath: artifact.artifactPath,
          reportPath,
          action: upsertResult.action,
          reason: metrics ? null : 'no_eval_file',
        })
      }
    })()
    return { success: true, summary }
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : 'unknown_error',
      summary,
    }
  }
}

export const failModelArtifactSync = (reason: string, summary: ModelArtifactSyncData) => {
  return fail('MODEL_ARTIFACT_SYNC_FAILED', `模型产物同步失败：${reason}。`, { reason, summary })
}

export const okModelArtifactSync = (summary: ModelArtifactSyncData) => {
  return ok({ summary })
}
