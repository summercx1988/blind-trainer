import { getMarketDb } from './dbLoader'
import { getTrainedCodes, getRecentTrainedCodes } from './blindDb'
import type { Database } from 'sql.js'

export interface NormalizedBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface TrainingSample {
  id: string
  code: string
  name: string
  regime: string
  period: string
  warmupBars: number
  forwardBars: number
  actualDate: string
  totalAvailableBars: number
  klines: NormalizedBar[]
}

export interface GetSamplesOptions {
  maxBarsPerSymbol?: number
  profileId?: string
  candidateCount?: number
  minPrice?: number
  excludeRecent?: number
}

const MIN_HISTORY_BARS = 50
const MIN_FORWARD_BARS = 65
const MIN_TOTAL_BARS = MIN_HISTORY_BARS + MIN_FORWARD_BARS

function requireMarketDb(): Database {
  const db = getMarketDb()
  if (!db) throw new Error('行情库未初始化，请先调用 initDb()')
  return db
}

export async function getRandomSamples(
  regime: string,
  count: number,
  options: GetSamplesOptions = {}
): Promise<TrainingSample[]> {
  const marketDb = requireMarketDb()
  const {
    maxBarsPerSymbol = 260,
    profileId = 'default',
    minPrice = 0,
    excludeRecent = 0,
  } = options
  const requestedCandidates = options.candidateCount ?? Math.max(count * 10, 80)
  const candidateLimit = Math.max(20, Math.min(2000, requestedCandidates))
  const actualMaxBars = Math.max(MIN_TOTAL_BARS + 20, Math.min(5000, Math.floor(maxBarsPerSymbol)))

  let excludeCodes: Set<string>
  if (excludeRecent > 0) {
    excludeCodes = new Set(await getRecentTrainedCodes(profileId, excludeRecent))
  } else {
    excludeCodes = new Set(await getTrainedCodes(profileId))
  }

  const fetchLimit = candidateLimit + excludeCodes.size
  const candidateStmt = marketDb.prepare(
    `SELECT DISTINCT code FROM kline_daily ORDER BY RANDOM() LIMIT ?`
  )
  candidateStmt.bind([fetchLimit])
  const allCodes: string[] = []
  while (candidateStmt.step()) {
    allCodes.push(candidateStmt.getAsObject().code as string)
  }
  candidateStmt.free()

  const codes = allCodes.filter((c) => !excludeCodes.has(c)).slice(0, candidateLimit)

  const samples: TrainingSample[] = []
  for (const code of codes) {
    if (samples.length >= count) break

    const nameStmt = marketDb.prepare(`SELECT name FROM stock_list WHERE code = ? LIMIT 1`)
    nameStmt.bind([code])
    nameStmt.step()
    const stockName = (nameStmt.getAsObject().name as string) || code
    nameStmt.free()

    const klineStmt = marketDb.prepare(
      `SELECT trade_date as date, open, high, low, close, volume, amount
       FROM kline_daily WHERE code = ?
       ORDER BY trade_date DESC LIMIT ?`
    )
    klineStmt.bind([code, actualMaxBars])
    const rows: NormalizedBar[] = []
    while (klineStmt.step()) {
      const r = klineStmt.getAsObject()
      rows.push({
        date: r.date as string,
        open: r.open as number,
        high: r.high as number,
        low: r.low as number,
        close: r.close as number,
        volume: r.volume as number,
        amount: r.amount as number,
      })
    }
    klineStmt.free()

    if (rows.length < MIN_TOTAL_BARS) continue

    // minPrice 过滤：rows 是降序，第一根是最新收盘价
    if (minPrice > 0 && rows[0].close < minPrice) continue

    const klines = rows.reverse()
    const totalAvailableBars = klines.length
    const warmupBars = Math.min(MIN_HISTORY_BARS, Math.floor(totalAvailableBars * 0.3))
    const forwardBars = totalAvailableBars - warmupBars
    const actualDate = klines[warmupBars]?.date || klines[0].date

    samples.push({
      id: `${code}-${actualDate}`,
      code,
      name: stockName,
      regime,
      period: '1d',
      warmupBars,
      forwardBars,
      actualDate,
      totalAvailableBars,
      klines,
    })
  }

  return samples
}
