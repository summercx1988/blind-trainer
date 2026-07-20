import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import './logger'
import log from './logger'
import { closeDb, getDb, getDbPath } from './db'
import { closeBlindDb } from './blindDb'
import { registerBlindIpc } from './ipc/blind'
import { registerDataIpc } from './ipc/data'

import { marketDataService } from './services/market-data'
import { stopAutoSync } from './services/auto-sync'

function getPreloadPath(): string {
  const appPath = app.getAppPath().replace('file://', '')
  const candidates = [
    path.join(__dirname, 'preload', 'index.cjs'),
    path.join(appPath, 'dist-electron', 'preload', 'index.cjs'),
    path.join(path.dirname(appPath), 'dist-electron', 'preload', 'index.cjs'),
    path.join(process.cwd(), 'dist-electron', 'preload', 'index.cjs')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0] || path.join(__dirname, 'preload', 'index.cjs')
}

function getRendererIndexPath(): string {
  const appPath = app.getAppPath().replace('file://', '')
  const candidates = [
    path.join(__dirname, '..', 'dist', 'index.html'),
    path.join(appPath, 'dist', 'index.html'),
    path.join(path.dirname(appPath), 'dist', 'index.html'),
    path.join(process.cwd(), 'dist', 'index.html')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0] || path.join(process.cwd(), 'dist', 'index.html')
}

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png')

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: getPreloadPath(),
    },
  })

  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(iconPath)
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(getRendererIndexPath())
  }
}

const DEFAULT_AI_ENDPOINT = 'https://open.bigmodel.cn/api/anthropic/v1/messages'

const registerIpcHandlers = () => {
  ipcMain.handle('app:quit', async () => {
    app.quit()
    return { success: true }
  })
  ipcMain.handle('app:log', async (_, level: string, message: string, data?: unknown) => {
    const fn = log[level as keyof typeof log] as (...args: unknown[]) => void
    if (typeof fn === 'function') {
      fn.call(log, `[Renderer] ${message}`, data)
    } else {
      log.info(`[Renderer] ${message}`, data)
    }
  })
  ipcMain.handle('aichat:getDefaultConfig', async () => {
    return {
      endpoint: process.env.ANTHROPIC_BASE_URL
        ? `${process.env.ANTHROPIC_BASE_URL}/v1/messages`
        : DEFAULT_AI_ENDPOINT,
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN || '',
      model: process.env.ANTHROPIC_MODEL || 'glm-4.7',
    }
  })
  registerBlindIpc()
  registerDataIpc()
}

const resolveSeedDbPath = (): string | null => {
  const candidates = [
    path.join(process.resourcesPath || '', 'blind-seed.db'),
    path.join(process.cwd(), 'data/blind-seed.db'),
    path.join(app.getAppPath(), 'data/blind-seed.db'),
    path.join(__dirname, '../../data/blind-seed.db'),
    path.join(__dirname, '../../../data/blind-seed.db'),
    path.join(process.cwd(), 'data/seed.db'),
    path.join(app.getAppPath(), 'data/seed.db'),
    path.join(__dirname, '../../data/seed.db'),
    path.join(__dirname, '../../../data/seed.db')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const CURRENT_SEED_VERSION = 2
const MAX_PRE_SEED_BACKUPS = 3

const prunePreSeedBackups = (dbDir: string): void => {
  try {
    const entries = fs.readdirSync(dbDir)
      .filter((name) => /^pre-seed-upgrade-\d+\.db$/.test(name))
      .map((name) => ({ name, mtime: fs.statSync(path.join(dbDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const entry of entries.slice(MAX_PRE_SEED_BACKUPS)) {
      try { fs.unlinkSync(path.join(dbDir, entry.name)) } catch { /* ignore */ }
    }
  } catch (error) {
    log.warn('[Init] Failed to prune pre-seed backups:', error)
  }
}


const needsSeedUpgrade = (): { needed: boolean; reason: string } => {
  const seedPath = resolveSeedDbPath()
  if (!seedPath) return { needed: false, reason: 'no_seed' }

  const dir = path.dirname(getDbPath())
  if (!fs.existsSync(dir)) return { needed: true, reason: 'no_dir' }
  if (!fs.existsSync(getDbPath())) return { needed: true, reason: 'no_db' }

  try {
    const db = getDb()
    const row = db.prepare('SELECT COUNT(*) as count FROM stock_list').get() as { count: number }
    if (row.count === 0) return { needed: true, reason: 'empty' }

    const dailyRow = db.prepare('SELECT COUNT(*) as count FROM kline_daily').get() as { count: number }
    if (dailyRow.count < 100000) {
      return { needed: true, reason: `only_${dailyRow.count}_bars` }
    }

    const seedStat = fs.statSync(seedPath)
    const seedVersion = `${CURRENT_SEED_VERSION}_${seedStat.size}`
    try {
      const metaRow = db.prepare("SELECT value_json as value FROM app_preferences WHERE key = 'seed_version'").get() as { value?: string } | undefined
      if (!metaRow || metaRow.value !== seedVersion) {
        return { needed: true, reason: `version_mismatch` }
      }
    } catch {
      return { needed: false, reason: 'meta_table_missing' }
    }
  } catch {
    return { needed: true, reason: 'corrupted' }
  }

  return { needed: false, reason: 'up_to_date' }
}

const performSeedUpgrade = (seedPath: string): void => {
  const seedStat = fs.statSync(seedPath)
  const seedVersion = `${CURRENT_SEED_VERSION}_${seedStat.size}`

  log.info(`[Init] Upgrading seed DB from ${seedPath} (${(seedStat.size / 1024 / 1024).toFixed(1)} MB)...`)
  closeDb()
  const dbDir = path.dirname(getDbPath())
  if (fs.existsSync(getDbPath())) {
    try {
      const backupPath = path.join(dbDir, `pre-seed-upgrade-${Date.now()}.db`)
      fs.copyFileSync(getDbPath(), backupPath)
      log.info(`[Init] Existing DB backup created: ${backupPath}`)
      prunePreSeedBackups(dbDir)
    } catch (error) {
      log.warn('[Init] Failed to create pre-seed backup:', error)
    }
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${getDbPath()}${suffix}`) } catch { /* ignore */ }
  }
  fs.copyFileSync(seedPath, getDbPath())
  log.info('[Init] Seed DB copied.')

  const db = getDb()
  try {
    db.prepare("INSERT OR REPLACE INTO app_preferences (key, value_json, updated_at) VALUES ('seed_version', ?, strftime('%s','now'))").run(seedVersion)
    log.info(`[Init] Seed version ${seedVersion} recorded.`)
  } catch (error) {
    log.error('[Init] Failed to record seed version — next launch will re-trigger upgrade:', error)
  }
}

const runNetworkInit = async (): Promise<void> => {
  log.info('[Init] No seed.db available, falling back to MarketDataService init...')
  try {
    const listResult = await marketDataService.syncStockList()
    log.info(`[Init] Stock list synced: ${listResult.synced} stocks, ${listResult.failed} failed`)

    if (listResult.synced > 0) {
      const db = getDb()
      const codes = db.prepare('SELECT code FROM stock_list ORDER BY code ASC LIMIT 50').all() as { code: string }[]
      const results = await marketDataService.batchSync(codes.map((r) => r.code), '1d', 250)
      const apiCount = results.filter((r) => r.source === 'api').length
      log.info(`[Init] Daily kline synced: ${apiCount}/${results.length} from API`)
    }
  } catch (error) {
    log.error('[Init] Network init failed:', error)
  }
}

try {
  app.whenReady().then(async () => {
    const { needed, reason } = needsSeedUpgrade()
    log.info(`[Init] Seed upgrade check: needed=${needed}, reason=${reason}`)

    if (!needed) {
      getDb()
    }

    registerIpcHandlers()
    createWindow()

    if (needed) {
      const seedPath = resolveSeedDbPath()
      if (seedPath) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        performSeedUpgrade(seedPath)
      } else {
        await runNetworkInit()
      }
    }

    // 盲训 App 不主动同步：仅靠种子数据 + 手动更新（设置页 → 数据管理）
    // startAutoSync()
  })

  app.on('window-all-closed', () => {
    stopAutoSync()
    closeBlindDb()
    closeDb()
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
} catch {
  // 非 Electron 环境（electron-builder 构建时加载检查）：安全跳过
}
