import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { saveSnapshot, loadSnapshot } from './idb'

const IDB_NAME = 'blind-trainer'
const IDB_STORE = 'db-snapshots'
const IDB_KEY = 'builtin-db'

let SQL: SqlJsStatic | null = null
let db: Database | null = null

export interface InitOptions {
  /** 直接传入种子包数据（优先级最高，测试用）。不传则走 packUrl fetch。 */
  packData?: Uint8Array
  /** 种子包 URL，默认 /data/builtin-100.sqlite（生产/dev 用） */
  packUrl?: string
  /** 强制重新 fetch，忽略 IndexedDB 缓存 */
  forceRefresh?: boolean
  /** sql.js wasm 文件定位函数，默认指向 /（public 根）。测试可覆盖为 file:// 路径 */
  locateFile?: (file: string) => string
}

/**
 * 初始化数据库：优先级 packData > IndexedDB 缓存 > fetch packUrl。
 * 加载后实例化 sql.js Database，存入模块级变量。
 * 首次 fetch 成功后写入 IndexedDB，后续从缓存秒加载。
 */
export async function initDb(options: InitOptions = {}): Promise<void> {
  const {
    packData,
    packUrl = '/data/builtin-100.sqlite',
    forceRefresh = false,
    locateFile = (file: string) => `/${file}`,
  } = options

  if (!SQL) {
    SQL = await initSqlJs({ locateFile })
  }

  let buffer: Uint8Array | null = packData ?? null
  if (!buffer && !forceRefresh) {
    buffer = await loadSnapshot(IDB_NAME, IDB_STORE, IDB_KEY)
  }
  if (!buffer) {
    const res = await fetch(packUrl)
    if (!res.ok) {
      throw new Error(`加载种子包失败：${packUrl} (${res.status})`)
    }
    buffer = new Uint8Array(await res.arrayBuffer())
    await saveSnapshot(IDB_NAME, IDB_STORE, IDB_KEY, buffer)
  }

  if (db) {
    db.close()
  }
  db = new SQL.Database(buffer)
}

/**
 * 查询某只股票的 K 线。
 * 返回最新的 limit 根，按日期升序（oldest→newest，适配 K 线图）。
 */
export async function queryKline(
  code: string,
  period: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  if (!db) throw new Error('数据库未初始化，请先调用 initDb()')
  // 种子包只有日K，period 仅支持 'daily'，其他值当前不处理（保留参数为后续扩展）
  if (period !== 'daily') {
    throw new Error(`暂不支持的周期：${period}（当前仅支持 daily）`)
  }
  const stmt = db.prepare(
    `SELECT code, trade_date, open, high, low, close, volume, amount, change_pct
     FROM kline_daily
     WHERE code = ?
     ORDER BY trade_date DESC
     LIMIT ?`
  )
  stmt.bind([code, limit])
  const rows: Array<Record<string, unknown>> = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows.reverse() // 转为升序
}

/**
 * 查询股票列表（按 code 升序）。
 */
export async function queryStockList(
  limit: number
): Promise<Array<Record<string, unknown>>> {
  if (!db) throw new Error('数据库未初始化，请先调用 initDb()')
  const stmt = db.prepare(
    `SELECT code, name, market, industry FROM stock_list ORDER BY code LIMIT ?`
  )
  stmt.bind([limit])
  const rows: Array<Record<string, unknown>> = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

/** 获取数据库是否已初始化 */
export function isDbReady(): boolean {
  return db !== null
}

/** 获取行情库实例（供 sampler 等模块查询，不对外暴露写权限） */
export function getMarketDb(): Database | null {
  return db
}
