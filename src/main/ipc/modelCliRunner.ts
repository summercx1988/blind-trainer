import { app, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import { existsSync } from 'fs'
import { getDb, DB_PATH } from '../db'

export const resolvePythonWorkspace = (): string | null => {
  const candidates = [
    path.join(app.getAppPath(), 'python'),
    path.join(process.cwd(), 'python'),
    path.join(__dirname, '../../../python'),
    path.join(__dirname, '../../python')
  ]
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'trading_trainer', 'cli.py'))) return candidate
  }
  return null
}

export const datasetKey = (datasetId: string): string => {
  const normalized = datasetId.trim().replace(/[\\/ ]/g, '_')
  return normalized.length > 0 ? normalized : 'default_dataset'
}

export const tryParseJsonFromStdout = (stdout: string): Record<string, unknown> | null => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reverse()
  for (const line of lines) {
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    try {
      return JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
  }
  return null
}

export const tryParseJsonFromStdoutAny = (stdout: string): unknown | null => {
  const text = stdout.trim()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    // ignore and try extracting trailing JSON payload
  }

  const startIndices: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{' || char === '[') startIndices.push(index)
  }

  for (let idx = startIndices.length - 1; idx >= 0; idx -= 1) {
    const start = startIndices[idx]
    if (start === undefined) continue
    const candidate = text.slice(start).trim()
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }
  return null
}

export const runFeatureBuildCli = (datasetId: string, specVersion: string, strictRealDataset = false): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  manifestPath: string | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const args = ['-m', 'trading_trainer.cli', 'feature', 'build', '--dataset', datasetId, '--spec', specVersion, '--db', DB_PATH]
    if (strictRealDataset) args.push('--strict-real')
    const command = `python3 ${args.join(' ')}`
    const process = spawn('python3', args, { cwd: workspace })

    let stdout = ''
    let stderr = ''
    process.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    process.on('error', (error) => reject(error))
    process.on('close', (code) => {
      const manifestCandidates = [
        path.join(workspace, 'features', datasetKey(datasetId), `feature_spec_${specVersion}`, 'manifest.json'),
        path.join(workspace, 'features', `feature_spec_${specVersion}`, 'manifest.json')
      ]
      const manifestPath = manifestCandidates.find((candidate) => existsSync(candidate)) || null
      resolve({
        command,
        stdout,
        stderr,
        code: code ?? -1,
        manifestPath
      })
    })
  })
}

export const runModelTrainCli = (
  datasetId: string,
  specVersion: string,
  taskType: string,
  engine: string = 'lightgbm',
  trials: number = 100,
  options?: { numBoostRound?: number; earlyStoppingRounds?: number },
  taskId?: string
): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: Record<string, unknown> | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const args = ['-m', 'trading_trainer.cli', 'model', 'train', '--dataset', datasetId, '--spec', specVersion, '--task', taskType, '--engine', engine, '--trials', String(trials), '--db', DB_PATH]
    if (typeof options?.numBoostRound === 'number' && Number.isFinite(options.numBoostRound) && options.numBoostRound > 0) {
      args.push('--num-boost-round', String(Math.floor(options.numBoostRound)))
    }
    if (typeof options?.earlyStoppingRounds === 'number' && Number.isFinite(options.earlyStoppingRounds) && options.earlyStoppingRounds > 0) {
      args.push('--early-stopping-rounds', String(Math.floor(options.earlyStoppingRounds)))
    }
    const command = `python3 ${args.join(' ')}`
    const childProc = spawn('python3', args, { cwd: workspace, env: { ...process.env, PYTHONUNBUFFERED: '1' } })

    const sendLog = (data: unknown) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('training:log', data)
      }
    }

    let stdout = ''
    let stderr = ''
    childProc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      sendLog({ taskId: taskId || '', stream: 'stdout', text })
    })
    childProc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      sendLog({ taskId: taskId || '', stream: 'stderr', text })
    })
    childProc.on('error', (error: Error) => reject(error))
    childProc.on('close', (code: number | null) => {
      sendLog({ taskId: taskId || '', stream: 'system', text: `process exited with code ${code ?? -1}` })
      resolve({
        command,
        stdout,
        stderr,
        code: code ?? -1,
        payload: tryParseJsonFromStdout(stdout)
      })
    })
  })
}

export const createFeatureBuildTask = async (datasetId: string, specVersion: string, strictRealDataset = false) => {
  const database = getDb()
  const dataset = database
    .prepare('SELECT id, status FROM dataset_versions WHERE id = ? LIMIT 1')
    .get(datasetId) as { id: string; status: string } | undefined
  if (!dataset) {
    return { success: false, reason: 'dataset_not_found', datasetId }
  }
  if (dataset.status !== 'frozen') {
    return { success: false, reason: 'dataset_not_frozen', datasetId, status: dataset.status }
  }

  const now = Math.floor(Date.now() / 1000)
  const taskId = `feature_task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const commandPreview = strictRealDataset
    ? `python3 -m trading_trainer.cli feature build --dataset ${datasetId} --spec ${specVersion} --strict-real`
    : `python3 -m trading_trainer.cli feature build --dataset ${datasetId} --spec ${specVersion}`
  database.prepare(`
    INSERT INTO feature_build_tasks (
      id, dataset_id, spec_version, status, command, created_at, started_at
    )
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run(taskId, datasetId, specVersion, commandPreview, now, now)

  try {
    const result = await runFeatureBuildCli(datasetId, specVersion, strictRealDataset)
    const finishedAt = Math.floor(Date.now() / 1000)
    const succeeded = result.code === 0
    const strictMissingDataset = strictRealDataset
      && `${result.stdout}\n${result.stderr}`.includes('strict real dataset mode enabled')
    const failureReason = succeeded
      ? null
      : (strictMissingDataset ? 'strict_real_dataset_missing' : `exit_code_${result.code}`)
    database.prepare(`
      UPDATE feature_build_tasks
      SET
        status = ?,
        command = ?,
        output_manifest_path = ?,
        stdout = ?,
        stderr = ?,
        error_message = ?,
        finished_at = ?
      WHERE id = ?
    `).run(
      succeeded ? 'succeeded' : 'failed',
      result.command,
      result.manifestPath,
      result.stdout.slice(-20000),
      result.stderr.slice(-20000),
      failureReason,
      finishedAt,
      taskId
    )

    const task = database.prepare('SELECT * FROM feature_build_tasks WHERE id = ? LIMIT 1').get(taskId)
    return {
      success: succeeded,
      task,
      reason: succeeded
        ? undefined
        : (strictMissingDataset ? 'strict_real_dataset_missing' : 'cli_failed')
    }
  } catch (error) {
    const finishedAt = Math.floor(Date.now() / 1000)
    database.prepare(`
      UPDATE feature_build_tasks
      SET status = 'failed', error_message = ?, finished_at = ?
      WHERE id = ?
    `).run(error instanceof Error ? error.message : 'unknown_error', finishedAt, taskId)
    const task = database.prepare('SELECT * FROM feature_build_tasks WHERE id = ? LIMIT 1').get(taskId)
    return { success: false, reason: 'cli_exception', task }
  }
}

export const createModelTrainingTask = async (
  datasetId: string,
  specVersion: string,
  taskType: string,
  engine: string = 'lightgbm',
  trials: number = 100,
  options?: { numBoostRound?: number; earlyStoppingRounds?: number; runName?: string }
) => {
  const database = getDb()
  const runName = options?.runName?.trim()
  const engineTag = engine === 'catboost' ? 'cb' : 'lgb'
  const dateTag = new Date().toISOString().slice(2, 10).replace(/-/g, '')
  const dataset = database
    .prepare('SELECT id, status FROM dataset_versions WHERE id = ? LIMIT 1')
    .get(datasetId) as { id: string; status: string } | undefined
  if (!dataset) {
    return { success: false, reason: 'dataset_not_found', datasetId }
  }
  if (dataset.status !== 'frozen') {
    return { success: false, reason: 'dataset_not_frozen', datasetId, status: dataset.status }
  }

  const featureTask = database.prepare(`
    SELECT id
    FROM feature_build_tasks
    WHERE dataset_id = ? AND spec_version = ? AND status = 'succeeded'
    ORDER BY finished_at DESC
    LIMIT 1
  `).get(datasetId, specVersion) as { id: string } | undefined
  if (!featureTask) {
    return { success: false, reason: 'feature_not_ready', datasetId, specVersion }
  }

  const now = Math.floor(Date.now() / 1000)
  const namePrefix = runName ? `${runName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_]/g, '_').slice(0, 20)}_` : ''
  const taskId = `train_${engineTag}_${specVersion.replace('v', '')}_${dateTag}_${namePrefix}${Math.random().toString(36).slice(2, 6)}`
  let commandPreview = `python3 -m trading_trainer.cli model train --dataset ${datasetId} --spec ${specVersion} --task ${taskType} --engine ${engine} --trials ${trials}`
  if (typeof options?.numBoostRound === 'number' && Number.isFinite(options.numBoostRound) && options.numBoostRound > 0) {
    commandPreview += ` --num-boost-round ${Math.floor(options.numBoostRound)}`
  }
  if (typeof options?.earlyStoppingRounds === 'number' && Number.isFinite(options.earlyStoppingRounds) && options.earlyStoppingRounds > 0) {
    commandPreview += ` --early-stopping-rounds ${Math.floor(options.earlyStoppingRounds)}`
  }
  database.prepare(`
    INSERT INTO model_training_tasks (
      id, dataset_id, spec_version, task_type, status, feature_task_id, command, created_at, started_at
    )
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)
  `).run(taskId, datasetId, specVersion, taskType, featureTask.id, commandPreview, now, now)

  try {
    const result = await runModelTrainCli(datasetId, specVersion, taskType, engine, trials, options, taskId)
    const finishedAt = Math.floor(Date.now() / 1000)
    const succeeded = result.code === 0 && !!result.payload

    const payload = result.payload || {}
    const artifactPath = typeof payload.artifact_path === 'string' ? payload.artifact_path : null
    const evaluationPath = typeof payload.evaluation_path === 'string' ? payload.evaluation_path : null
    const metrics = payload.metrics && typeof payload.metrics === 'object'
      ? payload.metrics as Record<string, unknown>
      : null
    const errorMessage = succeeded ? null : (result.code !== 0 ? `exit_code_${result.code}` : 'invalid_train_output')
    const testMetrics = (metrics?.test || {}) as Record<string, unknown>
    const trainMetrics = (metrics?.train || {}) as Record<string, unknown>

    database.prepare(`
      UPDATE model_training_tasks
      SET
        status = ?,
        command = ?,
        model_artifact_path = ?,
        eval_report_path = ?,
        metrics_json = ?,
        stdout = ?,
        stderr = ?,
        error_message = ?,
        finished_at = ?,
        test_auc = ?,
        test_accuracy = ?,
        test_f1 = ?
      WHERE id = ?
    `).run(
      succeeded ? 'succeeded' : 'failed',
      result.command,
      artifactPath,
      evaluationPath,
      metrics ? JSON.stringify(metrics) : null,
      result.stdout.slice(-20000),
      result.stderr.slice(-20000),
      errorMessage,
      finishedAt,
      typeof testMetrics?.auc === 'number' ? testMetrics.auc : null,
      typeof testMetrics?.accuracy === 'number' ? testMetrics.accuracy : null,
      typeof testMetrics?.f1 === 'number' ? testMetrics.f1 : null,
      taskId
    )

    let modelRecord: Record<string, unknown> | null = null
    if (succeeded && artifactPath) {
      const pyModelId = typeof payload.model_id === 'string' ? payload.model_id : ''
      const modelId = pyModelId || `model_${engineTag}_${dateTag}_${Math.random().toString(36).slice(2, 6)}`
      const taskLabel = taskType === 'buy_signal' ? '买点' : '卖点'
      let displayName = ''
      if (runName) {
        displayName = `${runName} (${engine}-${specVersion})`
      } else {
        const todayPrefix = `${engine}-${taskLabel}-${specVersion}-${dateTag}`
        const sameDayCount = database.prepare(
          "SELECT COUNT(*) AS cnt FROM model_versions WHERE name LIKE ? AND id != ?"
        ).get(`${todayPrefix}%`, modelId) as { cnt: number }
        const seq = String(sameDayCount.cnt + 1).padStart(2, '0')
        displayName = `${todayPrefix}-${seq}`
      }
      const createdAt = Math.floor(Date.now() / 1000)

      database.prepare(`
        INSERT INTO model_versions (
          id, name, status, task_type, dataset_id, spec_version, training_task_id, artifact_path, metrics_json, created_at,
          test_auc, test_accuracy, test_f1, test_precision, test_recall, train_auc
        )
        VALUES (?, ?, 'inactive', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        modelId,
        displayName,
        taskType,
        datasetId,
        specVersion,
        taskId,
        artifactPath,
        metrics ? JSON.stringify(metrics) : null,
        createdAt,
        typeof testMetrics.auc === 'number' ? testMetrics.auc : null,
        typeof testMetrics.accuracy === 'number' ? testMetrics.accuracy : null,
        typeof testMetrics.f1 === 'number' ? testMetrics.f1 : null,
        typeof testMetrics.precision === 'number' ? testMetrics.precision : null,
        typeof testMetrics.recall === 'number' ? testMetrics.recall : null,
        typeof trainMetrics.auc === 'number' ? trainMetrics.auc : null
      )

      if (metrics) {
        const splitNames = ['train', 'valid', 'test']
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
            `eval_${Date.now()}_${split}_${Math.random().toString(36).slice(2, 5)}`,
            modelId,
            split,
            typeof record.accuracy === 'number' ? record.accuracy : null,
            typeof record.precision === 'number' ? record.precision : null,
            typeof record.recall === 'number' ? record.recall : null,
            typeof record.f1 === 'number' ? record.f1 : null,
            typeof record.sample_count === 'number' ? record.sample_count : null,
            JSON.stringify(record),
            createdAt
          )
        }
      }

      modelRecord = database.prepare('SELECT * FROM model_versions WHERE id = ? LIMIT 1').get(modelId) as Record<string, unknown> | null
    }

    const task = database.prepare('SELECT * FROM model_training_tasks WHERE id = ? LIMIT 1').get(taskId)
    return {
      success: succeeded,
      task,
      model: modelRecord,
      reason: succeeded ? undefined : 'train_failed'
    }
  } catch (error) {
    const finishedAt = Math.floor(Date.now() / 1000)
    database.prepare(`
      UPDATE model_training_tasks
      SET status = 'failed', error_message = ?, finished_at = ?
      WHERE id = ?
    `).run(error instanceof Error ? error.message : 'unknown_error', finishedAt, taskId)
    const task = database.prepare('SELECT * FROM model_training_tasks WHERE id = ? LIMIT 1').get(taskId)
    return { success: false, reason: 'train_exception', task }
  }
}

export const runEnsemblePredictCli = (trendModelId: string, reversalModelId: string, weightTrend: number): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: Record<string, unknown> | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const args = ['-m', 'trading_trainer.cli', 'ensemble', 'predict',
      '--trend-model', trendModelId,
      '--reversal-model', reversalModelId,
      '--weight-trend', String(weightTrend),
      '--db', DB_PATH,
    ]
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      resolve({
        command,
        stdout,
        stderr,
        code: code ?? -1,
        payload: tryParseJsonFromStdout(stdout),
      })
    })
  })
}

export const runEnsembleWalkforwardCli = (params: {
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
}): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: Record<string, unknown> | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const args = ['-m', 'trading_trainer.cli', 'ensemble', 'walkforward',
      '--dataset', params.datasetId,
      '--spec', params.specVersion,
      '--engines', params.engines.join(','),
      '--weights', params.weights.join(','),
      '--method', params.method,
      '--threshold', String(params.threshold),
      '--train-days', String(params.trainDays),
      '--test-days', String(params.testDays),
      '--step-days', String(params.stepDays),
      '--max-windows', String(params.maxWindows),
      '--holding-days', String(params.holdingDays),
      '--max-positions', String(params.maxPositions),
      '--num-boost-round', String(params.numBoostRound),
      '--db', DB_PATH,
    ]
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      resolve({
        command,
        stdout,
        stderr,
        code: code ?? -1,
        payload: tryParseJsonFromStdout(stdout),
      })
    })
  })
}

export const runEnsembleMultiPredictCli = (params: {
  models: Array<{ model_id: string; weight: number }>
  featuresPath: string
  method: string
  threshold: number
}): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: Record<string, unknown> | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const args = ['-m', 'trading_trainer.cli', 'ensemble', 'multi-predict',
      '--models', JSON.stringify(params.models),
      '--features', params.featuresPath,
      '--method', params.method,
      '--threshold', String(params.threshold),
    ]
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      resolve({
        command,
        stdout,
        stderr,
        code: code ?? -1,
        payload: tryParseJsonFromStdout(stdout),
      })
    })
  })
}

export const runPredictLiveCli = (modelId: string, code: string, period: string): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: unknown | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const args = ['-m', 'trading_trainer.cli', 'predict', 'live', '--model', modelId, '--code', code, '--period', period, '--db', DB_PATH]
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      resolve({
        command,
        stdout,
        stderr,
        code: code ?? -1,
        payload: tryParseJsonFromStdoutAny(stdout),
      })
    })
  })
}

export const runPredictReplayCli = (
  modelId: string,
  codes: string[],
  period: string,
  startDate: string,
  endDate: string,
  options?: { threshold?: number; holdingDays?: number; maxPositions?: number }
): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: unknown | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const args = [
      '-m', 'trading_trainer.cli', 'predict', 'replay-backtest',
      '--model', modelId, '--codes', codes.join(','),
      '--period', period,
      '--start-date', startDate, '--end-date', endDate,
      '--db', DB_PATH,
    ]
    if (typeof options?.threshold === 'number' && Number.isFinite(options.threshold)) {
      args.push('--threshold', String(options.threshold))
    }
    if (typeof options?.holdingDays === 'number' && Number.isFinite(options.holdingDays)) {
      args.push('--holding-days', String(Math.max(2, Math.floor(options.holdingDays))))
    }
    if (typeof options?.maxPositions === 'number' && Number.isFinite(options.maxPositions)) {
      args.push('--max-positions', String(Math.max(1, Math.floor(options.maxPositions))))
    }
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      resolve({
        command,
        stdout,
        stderr,
        code: code ?? -1,
        payload: tryParseJsonFromStdoutAny(stdout),
      })
    })
  })
}

export const runPredictBatchCli = (modelId: string, codes: string[], period: string): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: unknown | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const args = ['-m', 'trading_trainer.cli', 'predict', 'batch', '--model', modelId, '--codes', codes.join(','), '--period', period, '--db', DB_PATH]
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      resolve({
        command,
        stdout,
        stderr,
        code: code ?? -1,
        payload: tryParseJsonFromStdoutAny(stdout),
      })
    })
  })
}

export const runLabelInspectCli = (params: {
  db: string
  datasetId: string
  code: string
  limit: number
}): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: Record<string, unknown> | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }
    const args = [
      '-m', 'trading_trainer.cli', 'label', 'inspect',
      '--db', DB_PATH,
      '--dataset', params.datasetId,
      '--code', params.code,
      '--limit', String(Math.max(1, Math.min(200, Number(params.limit || 50)))),
    ]
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      resolve({ command, stdout, stderr, code: code ?? -1, payload: tryParseJsonFromStdout(stdout) })
    })
  })
}

export const runFeatureSampleAuditCli = (manifestPath: string): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: Record<string, unknown> | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const args = ['-m', 'trading_trainer.cli', 'feature', 'audit-samples', '--manifest', manifestPath]
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      const payload = tryParseJsonFromStdoutAny(stdout)
      resolve({
        command,
        stdout,
        stderr,
        code: code ?? -1,
        payload: payload && typeof payload === 'object' && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : null
      })
    })
  })
}

export const runSwingLabelGenerateCli = (params: {
  db?: string
  marketDb?: string
  labelDb?: string
  codes?: string[]
  start?: string
  end?: string
  forwardDays?: number
  adxThreshold?: number
  minProfit?: number
  strategy?: string
  qualityPreset?: string
  stockLimit?: number
  lookbackBars?: number
  minRequiredBars?: number
  useL1Filter?: boolean
  l1Lambda?: number
  l1IrlsIters?: number
  l1CgIters?: number
  l1Eps?: number
  l1MinSlopePct?: number
  l1MinGapBars?: number
  disablePriorityPrefilter?: boolean
  auditDecisions?: boolean
  runName?: string
  saveDb?: boolean
}): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  aborted?: boolean
  payload: Record<string, unknown> | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const labelDbPath = params.labelDb || params.db || DB_PATH
    const marketDbPath = params.marketDb || labelDbPath
    const args = [
      '-m', 'trading_trainer.labeling.swing_labeler',
      '--label-db', labelDbPath,
      '--market-db', marketDbPath,
      '--save-db',
    ]
    if (params.codes && params.codes.length > 0) args.push('--codes', params.codes.join(','))
    if (params.start) args.push('--start', params.start)
    if (params.end) args.push('--end', params.end)
    if (params.forwardDays) args.push('--forward-days', String(params.forwardDays))
    if (params.adxThreshold) args.push('--adx-threshold', String(params.adxThreshold))
    if (params.minProfit) args.push('--min-profit', String(params.minProfit))
    if (params.qualityPreset) args.push('--quality-preset', params.qualityPreset)
    if (params.stockLimit && params.stockLimit > 0) args.push('--stock-limit', String(Math.floor(params.stockLimit)))
    if (typeof params.lookbackBars === 'number' && params.lookbackBars >= 0) {
      args.push('--lookback-bars', String(Math.floor(params.lookbackBars)))
    }
    if (params.minRequiredBars && params.minRequiredBars > 0) args.push('--min-required-bars', String(Math.floor(params.minRequiredBars)))
    if (params.useL1Filter) args.push('--use-l1-filter')
    if (typeof params.l1Lambda === 'number') args.push('--l1-lambda', String(params.l1Lambda))
    if (typeof params.l1IrlsIters === 'number') args.push('--l1-irls-iters', String(Math.floor(params.l1IrlsIters)))
    if (typeof params.l1CgIters === 'number') args.push('--l1-cg-iters', String(Math.floor(params.l1CgIters)))
    if (typeof params.l1Eps === 'number') args.push('--l1-eps', String(params.l1Eps))
    if (typeof params.l1MinSlopePct === 'number') args.push('--l1-min-slope-pct', String(params.l1MinSlopePct))
    if (typeof params.l1MinGapBars === 'number') args.push('--l1-min-gap-bars', String(Math.floor(params.l1MinGapBars)))
    if (params.disablePriorityPrefilter) args.push('--disable-priority-prefilter')
    if (params.auditDecisions) args.push('--audit-decisions')
    if (params.strategy) args.push('--strategy', params.strategy)
    if (params.runName && params.runName.trim()) args.push('--run-name', params.runName.trim())

    if (activeSwingLabelProcess) {
      reject(new Error('swing_label_generation_already_running'))
      return
    }

    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })
    activeSwingLabelProcess = proc
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code, signal) => {
      if (activeSwingLabelKillTimer) {
        clearTimeout(activeSwingLabelKillTimer)
        activeSwingLabelKillTimer = null
      }
      const aborted = signal === 'SIGTERM' || signal === 'SIGKILL'
      activeSwingLabelProcess = null
      resolve({ command, stdout, stderr, code: code ?? -1, aborted, payload: tryParseJsonFromStdout(stdout) })
    })
  })
}

let activeSwingLabelProcess: ChildProcessWithoutNullStreams | null = null
let activeSwingLabelKillTimer: NodeJS.Timeout | null = null

export const cancelSwingLabelGenerateCli = (): { success: boolean; status: 'idle' | 'cancelling' } => {
  if (!activeSwingLabelProcess) {
    return { success: false, status: 'idle' }
  }
  const runningProc = activeSwingLabelProcess
  try {
    runningProc.kill('SIGTERM')
  } catch {
    // ignore and fallback to hard kill timer
  }
  if (!activeSwingLabelKillTimer) {
    activeSwingLabelKillTimer = setTimeout(() => {
      try {
        if (activeSwingLabelProcess && activeSwingLabelProcess.pid === runningProc.pid) {
          activeSwingLabelProcess.kill('SIGKILL')
        }
      } catch {
        // ignore kill failure
      }
    }, 5000)
  }
  return { success: true, status: 'cancelling' }
}

let activeReversalLabelProcess: ChildProcessWithoutNullStreams | null = null
let activeReversalLabelKillTimer: NodeJS.Timeout | null = null

export const runReversalReboundLabelCli = (params: {
  marketDb?: string
  labelDb?: string
  qualityPreset?: string
  stockLimit?: number
  lookbackBars?: number
  minRequiredBars?: number
  strategy?: string
  saveDb?: boolean
}): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  aborted?: boolean
  payload: Record<string, unknown> | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const labelDbPath = params.labelDb || DB_PATH
    const marketDbPath = params.marketDb || labelDbPath
    const args = [
      '-m', 'trading_trainer.labeling.reversal_rebound_labeler',
      '--label-db', labelDbPath,
      '--market-db', marketDbPath,
      '--save-db',
    ]
    if (params.qualityPreset) args.push('--quality-preset', params.qualityPreset)
    if (params.stockLimit && params.stockLimit > 0) args.push('--stock-limit', String(Math.floor(params.stockLimit)))
    if (typeof params.lookbackBars === 'number' && params.lookbackBars >= 0) {
      args.push('--lookback-bars', String(Math.floor(params.lookbackBars)))
    }
    if (params.minRequiredBars && params.minRequiredBars > 0) args.push('--min-required-bars', String(Math.floor(params.minRequiredBars)))
    if (params.strategy) args.push('--strategy', params.strategy)

    if (activeReversalLabelProcess) {
      reject(new Error('reversal_label_generation_already_running'))
      return
    }

    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })
    activeReversalLabelProcess = proc
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code, signal) => {
      if (activeReversalLabelKillTimer) {
        clearTimeout(activeReversalLabelKillTimer)
        activeReversalLabelKillTimer = null
      }
      const aborted = signal === 'SIGTERM' || signal === 'SIGKILL'
      activeReversalLabelProcess = null
      resolve({ command, stdout, stderr, code: code ?? -1, aborted, payload: tryParseJsonFromStdout(stdout) })
    })
  })
}

export const cancelReversalReboundLabelCli = (): { success: boolean; status: 'idle' | 'cancelling' } => {
  if (!activeReversalLabelProcess) {
    return { success: false, status: 'idle' }
  }
  const runningProc = activeReversalLabelProcess
  try {
    runningProc.kill('SIGTERM')
  } catch {
    // ignore
  }
  if (!activeReversalLabelKillTimer) {
    activeReversalLabelKillTimer = setTimeout(() => {
      try {
        if (activeReversalLabelProcess && activeReversalLabelProcess.pid === runningProc.pid) {
          activeReversalLabelProcess.kill('SIGKILL')
        }
      } catch {
        // ignore
      }
    }, 5000)
  }
  return { success: true, status: 'cancelling' }
}

let activeGenericLabelProcess: ChildProcessWithoutNullStreams | null = null
let activeGenericLabelKillTimer: NodeJS.Timeout | null = null

export const runLabelGenerateCli = (params: {
  labeler: string
  marketDb?: string
  labelDb?: string
  codes?: string[]
  start?: string
  end?: string
  strategy?: string
  qualityPreset?: string
  stockLimit?: number
  lookbackBars?: number
  minRequiredBars?: number
  forwardDays?: number
  saveDb?: boolean
  onProgress?: (msg: string) => void
}): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  aborted?: boolean
  payload: Record<string, unknown> | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }

    const labelDbPath = params.labelDb || DB_PATH
    const marketDbPath = params.marketDb || labelDbPath
    const args = [
      '-m', 'trading_trainer.cli', 'label', 'generate',
      '--labeler', params.labeler,
      '--market-db', marketDbPath,
      '--label-db', labelDbPath,
      '--quality-preset', params.qualityPreset || 'balanced',
    ]
    if (params.codes && params.codes.length > 0) args.push('--codes', params.codes.join(','))
    if (params.start) args.push('--start', params.start)
    if (params.end) args.push('--end', params.end)
    if (params.strategy) args.push('--strategy', params.strategy)
    if (params.stockLimit && params.stockLimit > 0) args.push('--stock-limit', String(Math.floor(params.stockLimit)))
    if (typeof params.lookbackBars === 'number' && params.lookbackBars >= 0) {
      args.push('--lookback-bars', String(Math.floor(params.lookbackBars)))
    }
    if (params.minRequiredBars && params.minRequiredBars > 0) args.push('--min-required-bars', String(Math.floor(params.minRequiredBars)))
    if (params.forwardDays) args.push('--forward-days', String(params.forwardDays))
    if (params.saveDb) args.push('--save-db')

    if (activeGenericLabelProcess) {
      reject(new Error('label_generation_already_running'))
      return
    }

    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })
    activeGenericLabelProcess = proc
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      if (params.onProgress) {
        const cleaned = text.replace(/\r/g, '\n')
        for (const seg of cleaned.split('\n')) {
          const trimmed = seg.trim()
          if (trimmed.startsWith('[PROGRESS]')) {
            params.onProgress(trimmed.slice('[PROGRESS] '.length))
          }
        }
      }
    })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code, signal) => {
      if (activeGenericLabelKillTimer) {
        clearTimeout(activeGenericLabelKillTimer)
        activeGenericLabelKillTimer = null
      }
      const aborted = signal === 'SIGTERM' || signal === 'SIGKILL'
      activeGenericLabelProcess = null
      resolve({ command, stdout, stderr, code: code ?? -1, aborted, payload: tryParseJsonFromStdout(stdout) })
    })
  })
}

export const cancelLabelGenerateCli = (): { success: boolean; status: 'idle' | 'cancelling' } => {
  if (!activeGenericLabelProcess) {
    return { success: false, status: 'idle' }
  }
  const runningProc = activeGenericLabelProcess
  try {
    runningProc.kill('SIGTERM')
  } catch {
    // ignore
  }
  if (!activeGenericLabelKillTimer) {
    activeGenericLabelKillTimer = setTimeout(() => {
      try {
        if (activeGenericLabelProcess && activeGenericLabelProcess.pid === runningProc.pid) {
          activeGenericLabelProcess.kill('SIGKILL')
        }
      } catch {
        // ignore
      }
    }, 5000)
  }
  return { success: true, status: 'cancelling' }
}

export interface LabelerInfo {
  name: string
  display_name: string
  supported_presets: string[]
  default_strategy: string
  description: string
}

export const runListLabelersCli = (): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  labelers: LabelerInfo[]
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }
    const args = ['-m', 'trading_trainer.cli', 'label', 'list', '--json']
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      let labelers: LabelerInfo[] = []
      try {
        const parsed = JSON.parse(stdout.trim())
        if (Array.isArray(parsed)) labelers = parsed
      } catch { /* ignore parse failure */ }
      resolve({ command, stdout, stderr, code: code ?? -1, labelers })
    })
  })
}

export const runPredictSeriesCli = (modelId: string, code: string, period: string): Promise<{
  command: string
  stdout: string
  stderr: string
  code: number
  payload: unknown | null
}> => {
  return new Promise((resolve, reject) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      reject(new Error('python workspace not found'))
      return
    }
    const args = ['-m', 'trading_trainer.cli', 'predict', 'series', '--model', modelId, '--code', code, '--period', period, '--db', DB_PATH]
    const command = `python3 ${args.join(' ')}`
    const proc = spawn('python3', args, { cwd: workspace })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      resolve({ command, stdout, stderr, code: code ?? -1, payload: tryParseJsonFromStdoutAny(stdout) })
    })
  })
}
