import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import path from 'path'
import { getDb } from '../db'
import { resolvePythonWorkspace, tryParseJsonFromStdout } from './modelCliRunner'

export const registerModelResearchIpc = () => {
  ipcMain.handle('research:listDatasets', async () => {
    const rows = getDb().prepare(`
      SELECT
        d.*,
        COUNT(i.id) AS item_count
      FROM dataset_versions d
      LEFT JOIN dataset_items i ON i.dataset_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at DESC
      LIMIT 100
    `).all() as Array<Record<string, unknown>>

    const datasets = rows.map((row) => {
      const sampleCount = typeof row.sample_count === 'number'
        ? row.sample_count
        : typeof row.item_count === 'number'
          ? row.item_count
          : 0
      return {
        ...row,
        sample_count: sampleCount,
      }
    })

    return { success: true, data: datasets }
  })

  ipcMain.handle('research:listFeatureTasks', async (_event, datasetId: string) => {
    const id = typeof datasetId === 'string' ? datasetId.trim() : ''
    if (!id) {
      return { success: true, data: [] }
    }

    const rows = getDb().prepare(`
      SELECT *
      FROM feature_build_tasks
      WHERE dataset_id = ?
      ORDER BY created_at DESC
      LIMIT 200
    `).all(id) as Array<Record<string, unknown>>

    const tasks = rows
      .filter((row) => row.status === 'succeeded')
      .map((row) => {
        const manifest = typeof row.output_manifest_path === 'string'
          ? row.output_manifest_path.trim()
          : ''
        return {
          ...row,
          output_dir: manifest ? path.dirname(manifest) : '',
        }
      })
      .filter((row) => typeof row.output_dir === 'string' && row.output_dir.length > 0)

    return { success: true, data: tasks }
  })

  ipcMain.handle('modeling:factorAnalyze', async (_event, params: { dataPath: string }) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      return {
        success: false,
        error: { code: 'PYTHON_NOT_FOUND', message: 'Python workspace not found' }
      }
    }

    return new Promise((resolve) => {
      const args = [
        '-m', 'trading_trainer.research.cli', 'factor-analyze',
        '--data-path', params.dataPath,
      ]

      const proc = spawn('python3', args, { cwd: workspace })
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: { code: 'SPAWN_ERROR', message: error.message }
        })
      })

      proc.on('close', (code) => {
        const payload = tryParseJsonFromStdout(stdout)
        if (payload) {
          resolve({ success: true, data: payload })
        } else {
          resolve({
            success: false,
            error: {
              code: 'PARSE_ERROR',
              message: `Exit code ${code}. ${stderr.slice(-500) || stdout.slice(-500)}`
            }
          })
        }
      })
    })
  })

  ipcMain.handle('research:factorAnalyze', async (_event, params: { dataPath: string }) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      return {
        success: false,
        error: { code: 'PYTHON_NOT_FOUND', message: 'Python workspace not found' }
      }
    }

    return new Promise((resolve) => {
      const args = [
        '-m', 'trading_trainer.research.cli', 'factor-analyze',
        '--data-path', params.dataPath,
      ]

      const proc = spawn('python3', args, { cwd: workspace })
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: { code: 'SPAWN_ERROR', message: error.message }
        })
      })

      proc.on('close', (code) => {
        const payload = tryParseJsonFromStdout(stdout)
        if (payload) {
          resolve({ success: true, data: payload })
        } else {
          resolve({
            success: false,
            error: {
              code: 'PARSE_ERROR',
              message: `Exit code ${code}. ${stderr.slice(-500) || stdout.slice(-500)}`
            }
          })
        }
      })
    })
  })

  ipcMain.handle('modeling:labelQuality', async (_event, params?: { datasetId?: string; preset?: 'strict' | 'balanced' | 'lenient' }) => {
    const workspace = resolvePythonWorkspace()
    if (!workspace) {
      return {
        success: false,
        error: { code: 'PYTHON_NOT_FOUND', message: 'Python workspace not found' }
      }
    }

    return new Promise((resolve) => {
      const args = ['-m', 'trading_trainer.research.cli', 'label-quality']
      if (params?.datasetId) {
        args.push('--dataset-id', params.datasetId)
      }
      if (params?.preset) {
        args.push('--preset', params.preset)
      }

      const proc = spawn('python3', args, { cwd: workspace })
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: { code: 'SPAWN_ERROR', message: error.message }
        })
      })

      proc.on('close', (code) => {
        const payload = tryParseJsonFromStdout(stdout)
        if (payload) {
          resolve({ success: true, data: payload })
        } else {
          resolve({
            success: false,
            error: {
              code: 'PARSE_ERROR',
              message: `Exit code ${code}. ${stderr.slice(-500) || stdout.slice(-500)}`
            }
          })
        }
      })
    })
  })
}
