import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { DB_PATH, getDb } from '../db'
import { resolvePythonWorkspace, tryParseJsonFromStdout, tryParseJsonFromStdoutAny } from './modelCliRunner'
import { fail, ok } from './platformResult'

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

const runBacktestCli = (modelId: string, threshold: number, options?: {
  strategyType?: string
  exitMode?: string
  initialCapital?: number
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
      '-m', 'trading_trainer.cli', 'model', 'backtest',
      '--model', modelId,
      '--threshold', String(threshold),
      '--db', DB_PATH,
    ]
    if (options?.strategyType) {
      args.push('--strategy-type', options.strategyType)
    }
    if (options?.exitMode) {
      args.push('--exit-mode', options.exitMode)
    }
    if (options?.initialCapital) {
      args.push('--initial-capital', String(options.initialCapital))
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
        payload: tryParseJsonFromStdout(stdout),
      })
    })
  })
}

const runOptimizeThresholdCli = (modelId: string, objective: string): Promise<{
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
      '-m', 'trading_trainer.cli', 'model', 'optimize-threshold',
      '--model', modelId,
      '--objective', objective,
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

const runBenchmarkCli = (
  modelId: string,
  options?: {
    startDate?: string
    endDate?: string
    codes?: string[]
    holdingDays?: number
    breakoutLookback?: number
    initialCapital?: number
  }
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
      '-m', 'trading_trainer.cli', 'benchmark', 'run-all',
      '--model', modelId,
      '--db', DB_PATH,
    ]
    if (options?.startDate) args.push('--start', String(options.startDate))
    if (options?.endDate) args.push('--end', String(options.endDate))
    if (Array.isArray(options?.codes) && options.codes.length > 0) args.push('--codes', options.codes.join(','))
    if (typeof options?.holdingDays === 'number' && Number.isFinite(options.holdingDays)) args.push('--holding-days', String(Math.max(2, Math.floor(options.holdingDays))))
    if (typeof options?.breakoutLookback === 'number' && Number.isFinite(options.breakoutLookback)) args.push('--breakout-lookback', String(Math.max(5, Math.floor(options.breakoutLookback))))
    if (typeof options?.initialCapital === 'number' && Number.isFinite(options.initialCapital) && options.initialCapital > 0) args.push('--initial-capital', String(options.initialCapital))

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

const readBacktestReport = (modelId: string): Record<string, unknown> | null => {
  const workspace = resolvePythonWorkspace()
  if (!workspace) return null

  const reportPath = path.join(workspace, 'models', `${modelId}.backtest.json`)
  if (!fs.existsSync(reportPath)) return null

  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
  } catch {
    return null
  }
}

const readJsonFile = (filePath: string): Record<string, unknown> | null => {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return asRecord(parsed)
  } catch {
    return null
  }
}

const saveRecommendationsFromBacktest = (modelId: string, threshold: number, report: Record<string, unknown>) => {
  const tradeDetails = report.trade_details
  if (!Array.isArray(tradeDetails) || tradeDetails.length === 0) return

  const database = getDb()
  const modelName = typeof report.model_name === 'string' ? report.model_name : ''
  const specVersion = typeof report.spec_version === 'string' ? report.spec_version : ''
  const btId = `bt_${modelId}_${threshold}_${Date.now()}`
  const now = Math.floor(Date.now() / 1000)

  const insert = database.prepare(`
    INSERT OR IGNORE INTO model_recommendations
      (id, model_id, model_name, code, stock_name, signal_date, period, probability,
       threshold, signal_type, confidence, trade_executed, entry_price, exit_close,
       exit_high, actual_return, best_return, skip_reason, source, backtest_id,
       spec_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, '1d', ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?, 'backtest', ?, ?, ?)
  `)

  const insertMany = database.transaction((items: Array<Record<string, unknown>>) => {
    for (const t of items) {
      const code = String(t.code || '')
      const signalDate = String(t.signal_date || '')
      if (!code || !signalDate) continue
      const recId = `rec_${modelId}_${signalDate}_${code}`
      insert.run(
        recId, modelId, modelName, code,
        String(t.stock_name || ''),
        signalDate,
        typeof t.probability === 'number' ? t.probability : null,
        threshold,
        null,
        t.trade_executed ? 1 : 0,
        typeof t.entry_price === 'number' ? t.entry_price : null,
        typeof t.exit_close === 'number' ? t.exit_close : null,
        typeof t.exit_high === 'number' ? t.exit_high : null,
        typeof t.actual_return === 'number' ? t.actual_return : null,
        typeof t.best_return === 'number' ? t.best_return : null,
        String(t.skip_reason || ''),
        btId, specVersion, now
      )
    }
  })

  insertMany(tradeDetails as Array<Record<string, unknown>>)
}

export const registerBacktestIpc = (): void => {
  ipcMain.handle('backtest:listModels', async () => {
    const database = getDb()
    const rows = database.prepare(`
      SELECT v.id AS model_id, v.name AS model_name, v.task_type, v.spec_version, v.artifact_path,
             v.dataset_id, v.metrics_json
      FROM model_versions v
      ORDER BY v.created_at DESC
    `).all() as Array<{
      model_id: string; model_name: string; task_type: string; spec_version: string;
      artifact_path: string; dataset_id: string; metrics_json: string | null
    }>
    return rows.map((row) => {
      let modelType = 'unknown'
      let threshold = 0.5
      try {
        const raw = JSON.parse(fs.readFileSync(row.artifact_path, 'utf-8')) as Record<string, unknown>
        if (typeof raw.model_type === 'string') modelType = raw.model_type
        if (typeof raw.threshold === 'number') threshold = raw.threshold
      } catch { /* fallback */ }
      return {
        model_id: row.model_id,
        model_name: row.model_name,
        model_type: modelType,
        spec_version: row.spec_version,
        dataset_id: row.dataset_id,
        task_type: row.task_type,
        threshold,
        created_at: '',
      }
    })
  })

  ipcMain.handle('backtest:run', async (_, modelId: string, threshold: number, options?: {
    strategyType?: string
    exitMode?: string
    initialCapital?: number
  }) => {
    try {
      const result = await runBacktestCli(modelId, threshold, options)

      if (result.code !== 0) {
        return fail('BACKTEST_RUN_FAILED', `回测执行失败（exit ${result.code}）。`, {
          modelId,
          threshold,
          stderr: result.stderr.slice(-2000),
        }, {
          command: result.command,
        })
      }

      const report = readBacktestReport(modelId) || asRecord(result.payload)
      if (!report) {
        return fail('BACKTEST_REPORT_MISSING', '回测执行完成，但未找到可解析的回测报告。', {
          modelId,
          threshold,
          stdout: result.stdout.slice(-2000),
        }, {
          command: result.command,
        })
      }

      saveRecommendationsFromBacktest(modelId, threshold, report)

      return ok({
        report,
        stdout: result.stdout,
      }, {
        command: result.command,
      })
    } catch (error) {
      return fail('BACKTEST_RUN_EXCEPTION', error instanceof Error ? error.message : 'unknown_error', {
        modelId,
        threshold,
      })
    }
  })

  ipcMain.handle('backtest:getReport', async (_, modelId: string) => {
    const report = readBacktestReport(modelId)
    if (!report) {
      return fail('BACKTEST_REPORT_NOT_FOUND', '未找到回测报告。请先执行一次回测。', { modelId })
    }
    return ok({ report })
  })

  ipcMain.handle('backtest:optimizeThreshold', async (_, modelId: string, objective: string) => {
    try {
      const result = await runOptimizeThresholdCli(modelId, objective)
      if (result.code !== 0) {
        return fail('BACKTEST_OPTIMIZE_FAILED', `阈值优化失败（exit ${result.code}）。`, {
          modelId,
          objective,
          stderr: result.stderr.slice(-2000),
        }, {
          command: result.command,
        })
      }

      const optimization = asRecord(result.payload)
      if (!optimization) {
        return fail('BACKTEST_OPTIMIZE_EMPTY', '阈值优化完成，但未返回可解析结果。', {
          modelId,
          objective,
          stdout: result.stdout.slice(-2000),
        }, {
          command: result.command,
        })
      }

      return ok({
        optimization,
        stdout: result.stdout,
      }, {
        command: result.command,
      })
    } catch (error) {
      return fail('BACKTEST_OPTIMIZE_EXCEPTION', error instanceof Error ? error.message : 'unknown_error', {
        modelId,
        objective,
      })
    }
  })

  ipcMain.handle('backtest:runBenchmark', async (_, modelId: string, options?: {
    startDate?: string
    endDate?: string
    codes?: string[]
    holdingDays?: number
    breakoutLookback?: number
    initialCapital?: number
  }) => {
    try {
      const result = await runBenchmarkCli(modelId, options)
      if (result.code !== 0) {
        return fail('BACKTEST_BENCHMARK_FAILED', `Benchmark 执行失败（exit ${result.code}）。`, {
          modelId,
          options,
          stderr: result.stderr.slice(-3000),
          stdout: result.stdout.slice(-3000),
        }, {
          command: result.command,
        })
      }

      const payload = asRecord(result.payload)
      if (!payload || !Array.isArray(payload.ranking)) {
        return fail('BACKTEST_BENCHMARK_EMPTY', 'Benchmark 执行完成，但未返回可解析排名结果。', {
          modelId,
          options,
          stdout: result.stdout.slice(-3000),
        }, {
          command: result.command,
        })
      }

      return ok({
        benchmark: payload,
        stdout: result.stdout,
      }, {
        command: result.command,
      })
    } catch (error) {
      return fail('BACKTEST_BENCHMARK_EXCEPTION', error instanceof Error ? error.message : 'unknown_error', {
        modelId,
        options,
      })
    }
  })

  ipcMain.handle('backtest:runWalkForward', async (_, params: {
    datasetId: string
    specVersion: string
    threshold?: number
    holdingDays?: number
    trainDays?: number
    testDays?: number
    stepDays?: number
    maxWindows?: number
  }) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      return fail('WF_NO_WORKSPACE', 'python workspace not found', {})
    }

    const args = [
      '-m', 'trading_trainer.cli', 'model', 'walk-forward',
      '--dataset', params.datasetId,
      '--spec', params.specVersion,
      '--db', DB_PATH,
    ]
    if (typeof params.threshold === 'number') args.push('--threshold', String(params.threshold))
    if (typeof params.holdingDays === 'number') args.push('--holding-days', String(Math.max(2, params.holdingDays)))
    if (typeof params.trainDays === 'number') args.push('--train-days', String(params.trainDays))
    if (typeof params.testDays === 'number') args.push('--test-days', String(params.testDays))
    if (typeof params.stepDays === 'number') args.push('--step-days', String(params.stepDays))
    if (typeof params.maxWindows === 'number') args.push('--max-windows', String(params.maxWindows))

    const command = `python3 ${args.join(' ')}`
    try {
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
        const proc = spawn('python3', args, { cwd: workspace })
        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
        proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        proc.on('error', (error: Error) => reject(error))
        proc.on('close', (code: number | null) => {
          resolve({ stdout, stderr, code: code ?? -1 })
        })
      })

      if (result.code !== 0) {
        return fail('WF_RUN_FAILED', `Walk-Forward 执行失败（exit ${result.code}）`, {
          stderr: result.stderr.slice(-2000),
        }, { command })
      }

      const payload = tryParseJsonFromStdoutAny(result.stdout)
      const payloadRecord = asRecord(payload)
      if (!payloadRecord) {
        return fail('WF_PARSE_EMPTY', 'Walk-Forward 执行完成，但未返回可解析结果。', {
          stdout: result.stdout.slice(-2000),
        }, { command })
      }

      const fullReport = typeof payloadRecord.report_path === 'string'
        ? readJsonFile(payloadRecord.report_path)
        : null

      return ok(fullReport || payloadRecord, { command })
    } catch (error) {
      return fail('WF_EXCEPTION', error instanceof Error ? error.message : 'unknown_error', {})
    }
  })
}
