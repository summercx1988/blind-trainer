import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { saveSnapshot, loadSnapshot } from './idb'

const IDB_NAME = 'blind-trainer'
const IDB_STORE = 'db-snapshots'
const IDB_KEY = 'blind-db'

let SQL: SqlJsStatic | null = null
let blindDb: Database | null = null

export interface BlindInitOptions {
  forceRefresh?: boolean
  locateFile?: (file: string) => string
}

export interface SaveSessionInput {
  id: string
  sample_id: string
  stock_code: string
  stock_name: string
  interval_type: string
  started_at: number
  initial_capital: number
  created_at: number
  profile_id: string
}

export async function initBlindDb(options: BlindInitOptions = {}): Promise<void> {
  const { forceRefresh = false, locateFile = (file: string) => `/${file}` } = options

  if (!SQL) {
    SQL = await initSqlJs({ locateFile })
  }

  let buffer: Uint8Array | null = null
  if (!forceRefresh) {
    buffer = await loadSnapshot(IDB_NAME, IDB_STORE, IDB_KEY)
  }

  if (buffer) {
    if (blindDb) blindDb.close()
    blindDb = new SQL.Database(buffer)
  } else {
    if (blindDb) blindDb.close()
    blindDb = new SQL.Database()
    createTables(blindDb)
    await persist()
  }
}

function createTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS training_sessions (
      id TEXT PRIMARY KEY,
      sample_id TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      interval_type TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT DEFAULT 'active',
      initial_capital REAL NOT NULL,
      final_capital REAL,
      realized_pnl REAL,
      total_trades INTEGER DEFAULT 0,
      winning_trades INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      profile_id TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS trade_actions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      bar_index INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      price REAL,
      shares INTEGER,
      amount REAL,
      commission REAL,
      realized_pnl REAL,
      source TEXT DEFAULT 'manual',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trained_stocks (
      code TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      trained_at INTEGER NOT NULL,
      PRIMARY KEY (code, profile_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_profile ON training_sessions(profile_id);
    CREATE INDEX IF NOT EXISTS idx_trained_profile ON trained_stocks(profile_id);
  `)
}

async function persist(): Promise<void> {
  if (!blindDb) return
  const data = blindDb.export()
  await saveSnapshot(IDB_NAME, IDB_STORE, IDB_KEY, data)
}

export function isBlindDbReady(): boolean {
  return blindDb !== null
}

function requireDb(): Database {
  if (!blindDb) throw new Error('盲训库未初始化，请先调用 initBlindDb()')
  return blindDb
}

export async function saveSession(input: SaveSessionInput): Promise<void> {
  const db = requireDb()
  db.run(
    `INSERT INTO training_sessions
      (id, sample_id, stock_code, stock_name, interval_type, started_at, initial_capital, created_at, profile_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [input.id, input.sample_id, input.stock_code, input.stock_name,
     input.interval_type, input.started_at, input.initial_capital,
     input.created_at, input.profile_id]
  )
  await markTrained(input.stock_code, input.profile_id)
}

export async function markTrained(code: string, profileId: string): Promise<void> {
  const db = requireDb()
  db.run(
    `INSERT OR IGNORE INTO trained_stocks (code, profile_id, trained_at) VALUES (?, ?, ?)`,
    [code, profileId, Math.floor(Date.now() / 1000)]
  )
  await persist()
}

export async function getTrainedCodes(profileId: string): Promise<string[]> {
  const db = requireDb()
  const stmt = db.prepare(
    `SELECT code FROM trained_stocks WHERE profile_id = ? ORDER BY code`
  )
  stmt.bind([profileId])
  const codes: string[] = []
  while (stmt.step()) {
    codes.push(stmt.getAsObject().code as string)
  }
  stmt.free()
  return codes
}
