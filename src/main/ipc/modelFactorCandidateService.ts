import { getDb } from '../db'
import {
  loadOutcomeGateSettingsFromDb,
  type OutcomeGatePeriodSettings
} from './modelOutcomeGateSettings'

type PeriodType = '5m' | '15m' | '1d'

interface KlineCandidateRow {
  trade_date: string
  trade_time?: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface CandidateDraft {
  barIndex: number
  tradeDate: string
  tradeTime?: string
  signalType: 'buy' | 'sell'
  factorType: string
  sourceStrategy: string
  score: number
  reason: string
  payload: Record<string, unknown>
}

interface FactorCandidateServiceDeps {
  getKlineTable: (period: PeriodType) => string
  toBarTimestamp: (tradeDate: string, tradeTime?: string) => number
}

type OutcomeConfig = OutcomeGatePeriodSettings

interface OutcomeStats {
  futureBars: number
  endIndex: number
  exitReturnPct: number
  maxReturnPct: number
  minReturnPct: number
  riskReward: number
}

interface TrendContext {
  ma20: number | null
  ma60: number | null
  ma20SlopePct: number | null
  ma20VsMa60Pct: number | null
  isUpTrend: boolean
  isDownTrend: boolean
  isTransition: boolean
}

interface OutcomeGateResult {
  accepted: boolean
  qualityScore: number
  outcomeTag: string
  normalizedReason: string
}

const STRATEGY_NAMES = [
  'ma_cross_v1',
  'rsi_reversal_v1',
  'macd_cross_v1',
  'boll_reversion_v1',
  'volume_price_breakout_v1',
  'ma_cross_v2',
  'rsi_reversal_v2',
  'macd_cross_v2',
  'boll_reversion_v2',
  'volume_price_breakout_v2',
] as const

const toMovingAverage = (rows: KlineCandidateRow[], index: number, period: number): number | null => {
  if (index < period - 1) return null
  let sum = 0
  for (let offset = 0; offset < period; offset++) {
    sum += Number(rows[index - offset]?.close || 0)
  }
  return sum / period
}

const windowSeries = (values: number[], endIndex: number, period: number): number[] => {
  const start = Math.max(0, endIndex - period + 1)
  return values.slice(start, endIndex + 1).filter((value) => Number.isFinite(value))
}

const seriesMean = (values: number[]): number => {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const seriesStd = (values: number[]): number => {
  if (values.length < 2) return 0
  const m = seriesMean(values)
  const variance = values.reduce((sum, value) => sum + (value - m) * (value - m), 0) / values.length
  return Math.sqrt(variance)
}

const windowHigh = (rows: KlineCandidateRow[], endIndex: number, period: number): number => {
  const start = Math.max(0, endIndex - period + 1)
  let maxValue = Number.NEGATIVE_INFINITY
  for (let index = start; index <= endIndex; index++) {
    const high = Number(rows[index]?.high || 0)
    if (high > maxValue) maxValue = high
  }
  return Number.isFinite(maxValue) ? maxValue : 0
}

const windowLow = (rows: KlineCandidateRow[], endIndex: number, period: number): number => {
  const start = Math.max(0, endIndex - period + 1)
  let minValue = Number.POSITIVE_INFINITY
  for (let index = start; index <= endIndex; index++) {
    const low = Number(rows[index]?.low || 0)
    if (low < minValue) minValue = low
  }
  return Number.isFinite(minValue) ? minValue : 0
}

const toRsiSeries = (closes: number[], period = 14): Array<number | null> => {
  const result: Array<number | null> = Array.from({ length: closes.length }, () => null)
  if (closes.length <= period) return result

  let gains = 0
  let losses = 0
  for (let index = 1; index <= period; index++) {
    const diff = closes[index]! - closes[index - 1]!
    if (diff >= 0) gains += diff
    else losses += Math.abs(diff)
  }

  let avgGain = gains / period
  let avgLoss = losses / period
  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss))

  for (let index = period + 1; index < closes.length; index++) {
    const diff = closes[index]! - closes[index - 1]!
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    result[index] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss))
  }

  return result
}

const toEmaSeries = (values: number[], period: number): number[] => {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const result: number[] = [values[0] || 0]
  for (let index = 1; index < values.length; index++) {
    const prev = result[index - 1] || 0
    const current = values[index] || 0
    result.push(current * k + prev * (1 - k))
  }
  return result
}

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

const evaluateForwardOutcome = (
  rows: KlineCandidateRow[],
  startIndex: number,
  config: OutcomeConfig
): OutcomeStats | null => {
  const entryRow = rows[startIndex]
  if (!entryRow) return null
  const entryPrice = Number(entryRow.close || 0)
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  if (startIndex >= rows.length - 1) return null

  const endIndex = Math.min(rows.length - 1, startIndex + config.horizonBars)
  const futureBars = endIndex - startIndex
  if (futureBars < config.minFutureBars) return null

  let maxReturnPct = Number.NEGATIVE_INFINITY
  let minReturnPct = Number.POSITIVE_INFINITY

  for (let index = startIndex + 1; index <= endIndex; index++) {
    const row = rows[index]
    if (!row) continue
    const high = Number(row.high || row.close || entryPrice)
    const low = Number(row.low || row.close || entryPrice)
    const up = (high / entryPrice - 1) * 100
    const down = (low / entryPrice - 1) * 100
    if (up > maxReturnPct) maxReturnPct = up
    if (down < minReturnPct) minReturnPct = down
  }

  if (!Number.isFinite(maxReturnPct) || !Number.isFinite(minReturnPct)) return null
  const exitClose = Number(rows[endIndex]?.close || entryPrice)
  const exitReturnPct = (exitClose / entryPrice - 1) * 100
  const riskReward = maxReturnPct / Math.max(0.2, Math.abs(minReturnPct))

  return {
    futureBars,
    endIndex,
    exitReturnPct,
    maxReturnPct,
    minReturnPct,
    riskReward,
  }
}

const evaluateTrendContext = (rows: KlineCandidateRow[], index: number): TrendContext => {
  const row = rows[index]
  const close = Number(row?.close || 0)
  const ma20 = toMovingAverage(rows, index, 20)
  const ma60 = toMovingAverage(rows, index, 60)
  const prevMa20 = index > 0 ? toMovingAverage(rows, index - 1, 20) : null
  const ma20SlopePct = ma20 !== null && prevMa20 !== null && prevMa20 > 0
    ? ((ma20 / prevMa20) - 1) * 100
    : null
  const ma20VsMa60Pct = ma20 !== null && ma60 !== null && close > 0
    ? ((ma20 - ma60) / close) * 100
    : null

  const isUpTrend = ma20 !== null && ma60 !== null && ma20SlopePct !== null
    && close >= ma20
    && ma20 >= ma60
    && ma20SlopePct >= 0

  const isDownTrend = ma20 !== null && ma60 !== null && ma20SlopePct !== null
    && close <= ma20
    && ma20 <= ma60
    && ma20SlopePct <= 0

  return {
    ma20,
    ma60,
    ma20SlopePct,
    ma20VsMa60Pct,
    isUpTrend,
    isDownTrend,
    isTransition: !isUpTrend && !isDownTrend,
  }
}

const evaluateBuyGate = (
  stats: OutcomeStats,
  trend: TrendContext,
  config: OutcomeConfig
): OutcomeGateResult => {
  const trendOk = trend.isUpTrend
  const maxReturnOk = stats.maxReturnPct >= config.buyMinMaxReturnPct
  const exitReturnOk = stats.exitReturnPct >= config.buyMinExitReturnPct
  const drawdownOk = stats.minReturnPct >= -config.buyMaxDrawdownPct
  const rrOk = stats.riskReward >= config.buyMinRiskReward
  const accepted = trendOk && maxReturnOk && exitReturnOk && drawdownOk && rrOk

  const quality = clamp(
    45
    + stats.maxReturnPct * 5.5
    + stats.exitReturnPct * 4.0
    + stats.riskReward * 10
    - Math.abs(Math.min(0, stats.minReturnPct)) * 4.5
    + (trend.ma20VsMa60Pct || 0) * 2.5,
    0,
    100
  )

  if (accepted) {
    return {
      accepted: true,
      qualityScore: quality,
      outcomeTag: 'buy_trend_qualified',
      normalizedReason: '满足趋势向上、收益兑现和风险收益比门槛',
    }
  }
  if (!trendOk) {
    return {
      accepted: false,
      qualityScore: quality,
      outcomeTag: 'buy_reject_trend_not_up',
      normalizedReason: '趋势不满足上升结构',
    }
  }
  if (!maxReturnOk || !exitReturnOk) {
    return {
      accepted: false,
      qualityScore: quality,
      outcomeTag: 'buy_reject_profit_not_enough',
      normalizedReason: '未来盈利空间或退出收益不足',
    }
  }
  if (!drawdownOk) {
    return {
      accepted: false,
      qualityScore: quality,
      outcomeTag: 'buy_reject_drawdown_too_large',
      normalizedReason: '未来回撤过大',
    }
  }
  return {
    accepted: false,
    qualityScore: quality,
    outcomeTag: 'buy_reject_rr_not_enough',
    normalizedReason: '风险收益比不足',
  }
}

const evaluateSellGate = (
  stats: OutcomeStats,
  trend: TrendContext,
  config: OutcomeConfig
): OutcomeGateResult => {
  const trendOk = trend.isDownTrend || (trend.ma20SlopePct !== null && trend.ma20SlopePct < 0)
  const dropOk = stats.minReturnPct <= -config.sellMinDropPct
  const bounceOk = stats.maxReturnPct <= config.sellMaxBouncePct
  const rr = Math.abs(stats.minReturnPct) / Math.max(0.2, stats.maxReturnPct)
  const rrOk = rr >= config.sellMinRiskReward
  const accepted = trendOk && dropOk && bounceOk && rrOk

  const quality = clamp(
    42
    + Math.abs(Math.min(0, stats.minReturnPct)) * 6.0
    + rr * 10.0
    - Math.max(0, stats.maxReturnPct) * 5.0
    - Math.max(0, stats.exitReturnPct) * 2.5,
    0,
    100
  )

  if (accepted) {
    return {
      accepted: true,
      qualityScore: quality,
      outcomeTag: 'sell_trend_qualified',
      normalizedReason: '满足趋势转弱/下行确认与风险收益门槛',
    }
  }
  if (!trendOk) {
    return {
      accepted: false,
      qualityScore: quality,
      outcomeTag: 'sell_reject_trend_not_weak',
      normalizedReason: '趋势尚未明显转弱',
    }
  }
  if (!dropOk) {
    return {
      accepted: false,
      qualityScore: quality,
      outcomeTag: 'sell_reject_drop_not_confirmed',
      normalizedReason: '后续下跌幅度不足以确认卖点',
    }
  }
  if (!bounceOk) {
    return {
      accepted: false,
      qualityScore: quality,
      outcomeTag: 'sell_reject_rebound_too_strong',
      normalizedReason: '卖点后反弹过强，退出边际不足',
    }
  }
  return {
    accepted: false,
    qualityScore: quality,
    outcomeTag: 'sell_reject_rr_not_enough',
    normalizedReason: '风险收益比不足',
  }
}

const withOutcomeLabel = (
  draft: CandidateDraft,
  rows: KlineCandidateRow[],
  config: OutcomeConfig
): CandidateDraft | null => {
  const stats = evaluateForwardOutcome(rows, draft.barIndex, config)
  if (!stats) return null
  const trend = evaluateTrendContext(rows, draft.barIndex)
  const gate = draft.signalType === 'buy'
    ? evaluateBuyGate(stats, trend, config)
    : evaluateSellGate(stats, trend, config)

  if (!gate.accepted) return null
  const mergedScore = clamp(draft.score * 0.45 + gate.qualityScore * 0.55, 0, 100)
  const trendState = trend.isUpTrend ? 'uptrend' : trend.isDownTrend ? 'downtrend' : 'transition'

  return {
    ...draft,
    score: mergedScore,
    reason: `${draft.reason} | ${gate.normalizedReason}`,
    payload: {
      ...draft.payload,
      forward_exit_return_pct: Number(stats.exitReturnPct.toFixed(4)),
      forward_max_return_pct: Number(stats.maxReturnPct.toFixed(4)),
      forward_min_return_pct: Number(stats.minReturnPct.toFixed(4)),
      forward_risk_reward: Number(stats.riskReward.toFixed(4)),
      forward_holding_bars: stats.futureBars,
      outcome_quality_score: Number(gate.qualityScore.toFixed(4)),
      outcome_tag: gate.outcomeTag,
      trend_state: trendState,
      ma20: trend.ma20 === null ? null : Number(trend.ma20.toFixed(4)),
      ma60: trend.ma60 === null ? null : Number(trend.ma60.toFixed(4)),
      ma20_slope_pct: trend.ma20SlopePct === null ? null : Number(trend.ma20SlopePct.toFixed(4)),
      ma20_vs_ma60_pct: trend.ma20VsMa60Pct === null ? null : Number(trend.ma20VsMa60Pct.toFixed(4)),
      outcome_horizon_bars: config.horizonBars,
    }
  }
}

const buildMaCandidates = (rows: KlineCandidateRow[]): CandidateDraft[] => {
  const inserted: CandidateDraft[] = []
  for (let index = 21; index < rows.length; index++) {
    const prev = rows[index - 1]
    const curr = rows[index]
    if (!prev || !curr) continue

    const prevMa20 = toMovingAverage(rows, index - 1, 20)
    const ma20 = toMovingAverage(rows, index, 20)
    if (prevMa20 === null || ma20 === null || ma20 === 0) continue

    const prevClose = Number(prev.close || 0)
    const close = Number(curr.close || 0)
    const crossedUp = prevClose <= prevMa20 && close > ma20
    const crossedDown = prevClose >= prevMa20 && close < ma20
    if (!crossedUp && !crossedDown) continue

    const signalType: 'buy' | 'sell' = crossedUp ? 'buy' : 'sell'
    const priceDistancePct = Math.abs((close - ma20) / ma20) * 100
    const score = Math.min(100, priceDistancePct * 8)
    const reason = crossedUp
      ? `收盘价上穿 MA20 (${close.toFixed(2)} > ${ma20.toFixed(2)})`
      : `收盘价下穿 MA20 (${close.toFixed(2)} < ${ma20.toFixed(2)})`

    inserted.push({
      barIndex: index,
      tradeDate: curr.trade_date,
      tradeTime: curr.trade_time,
      signalType,
      factorType: 'ma_cross',
      sourceStrategy: 'ma_cross_v2',
      score,
      reason,
      payload: { close, ma20, prevClose, prevMa20 }
    })
  }
  return inserted
}

const buildRsiCandidates = (rows: KlineCandidateRow[]): CandidateDraft[] => {
  const closes = rows.map((row) => Number(row.close || 0))
  const rsi = toRsiSeries(closes, 14)
  const inserted: CandidateDraft[] = []

  for (let index = 15; index < rows.length; index++) {
    const prevRsi = rsi[index - 1]
    const currRsi = rsi[index]
    const curr = rows[index]
    if (!curr || prevRsi === null || currRsi === null) continue

    const crossUp30 = prevRsi <= 30 && currRsi > 30
    const crossDown70 = prevRsi >= 70 && currRsi < 70
    if (!crossUp30 && !crossDown70) continue

    const signalType: 'buy' | 'sell' = crossUp30 ? 'buy' : 'sell'
    const threshold = crossUp30 ? 30 : 70
    const score = Math.min(100, 45 + Math.abs(currRsi - threshold) * 3)
    const reason = crossUp30
      ? `RSI14 上穿超卖线 (${currRsi.toFixed(2)} > 30)`
      : `RSI14 下穿超买线 (${currRsi.toFixed(2)} < 70)`

    inserted.push({
      barIndex: index,
      tradeDate: curr.trade_date,
      tradeTime: curr.trade_time,
      signalType,
      factorType: 'rsi_reversal',
      sourceStrategy: 'rsi_reversal_v2',
      score,
      reason,
      payload: { prevRsi, currRsi }
    })
  }

  return inserted
}

const buildMacdCandidates = (rows: KlineCandidateRow[]): CandidateDraft[] => {
  const closes = rows.map((row) => Number(row.close || 0))
  const ema12 = toEmaSeries(closes, 12)
  const ema26 = toEmaSeries(closes, 26)
  const dif = closes.map((_, index) => (ema12[index] || 0) - (ema26[index] || 0))
  const dea = toEmaSeries(dif, 9)
  const inserted: CandidateDraft[] = []

  for (let index = 35; index < rows.length; index++) {
    const prevDiff = dif[index - 1]
    const prevDea = dea[index - 1]
    const diff = dif[index]
    const signal = dea[index]
    const curr = rows[index]
    if (!curr || prevDiff === undefined || prevDea === undefined || diff === undefined || signal === undefined) continue

    const goldCross = prevDiff <= prevDea && diff > signal
    const deadCross = prevDiff >= prevDea && diff < signal
    if (!goldCross && !deadCross) continue

    const signalType: 'buy' | 'sell' = goldCross ? 'buy' : 'sell'
    const score = Math.min(100, 40 + Math.abs(diff - signal) * 300)
    const reason = goldCross
      ? `MACD 金叉 (${diff.toFixed(4)} > ${signal.toFixed(4)})`
      : `MACD 死叉 (${diff.toFixed(4)} < ${signal.toFixed(4)})`

    inserted.push({
      barIndex: index,
      tradeDate: curr.trade_date,
      tradeTime: curr.trade_time,
      signalType,
      factorType: 'macd_cross',
      sourceStrategy: 'macd_cross_v2',
      score,
      reason,
      payload: { prevDiff, prevDea, diff, signal }
    })
  }

  return inserted
}

const buildBollCandidates = (rows: KlineCandidateRow[]): CandidateDraft[] => {
  const closes = rows.map((row) => Number(row.close || 0))
  const inserted: CandidateDraft[] = []

  for (let index = 21; index < rows.length; index++) {
    const prev = rows[index - 1]
    const curr = rows[index]
    if (!prev || !curr) continue

    const prevWindow = windowSeries(closes, index - 1, 20)
    const currWindow = windowSeries(closes, index, 20)
    if (prevWindow.length < 20 || currWindow.length < 20) continue

    const prevMa20 = seriesMean(prevWindow)
    const ma20 = seriesMean(currWindow)
    const prevStd20 = seriesStd(prevWindow)
    const std20 = seriesStd(currWindow)
    if (prevStd20 <= 0 || std20 <= 0 || ma20 === 0) continue

    const prevUpper = prevMa20 + 2 * prevStd20
    const prevLower = prevMa20 - 2 * prevStd20
    const upper = ma20 + 2 * std20
    const lower = ma20 - 2 * std20
    const prevClose = Number(prev.close || 0)
    const close = Number(curr.close || 0)

    const reboundFromLower = prevClose <= prevLower && close > lower
    const pullbackFromUpper = prevClose >= prevUpper && close < upper
    if (!reboundFromLower && !pullbackFromUpper) continue

    const signalType: 'buy' | 'sell' = reboundFromLower ? 'buy' : 'sell'
    const bandWidthPct = ((upper - lower) / ma20) * 100
    const edgeDistance = reboundFromLower ? Math.abs(close - lower) : Math.abs(close - upper)
    const score = Math.min(100, 50 + edgeDistance / ma20 * 180 + bandWidthPct * 1.5)
    const reason = reboundFromLower
      ? `BOLL 下轨反抽 (${close.toFixed(2)} > ${lower.toFixed(2)})`
      : `BOLL 上轨回落 (${close.toFixed(2)} < ${upper.toFixed(2)})`

    inserted.push({
      barIndex: index,
      tradeDate: curr.trade_date,
      tradeTime: curr.trade_time,
      signalType,
      factorType: 'boll_reversion',
      sourceStrategy: 'boll_reversion_v2',
      score,
      reason,
      payload: { prevClose, close, ma20, std20, upper, lower }
    })
  }

  return inserted
}

const buildVolumePriceCandidates = (rows: KlineCandidateRow[]): CandidateDraft[] => {
  const inserted: CandidateDraft[] = []
  const volumes = rows.map((row) => Number(row.volume || 0))

  for (let index = 21; index < rows.length; index++) {
    const prev = rows[index - 1]
    const curr = rows[index]
    if (!prev || !curr) continue

    const prevClose = Number(prev.close || 0)
    const close = Number(curr.close || 0)
    const open = Number(curr.open || close)
    const currentVolume = Number(curr.volume || 0)
    const volume20Avg = seriesMean(windowSeries(volumes, index, 20))
    if (volume20Avg <= 0) continue

    const volumeRatio = currentVolume / volume20Avg
    const priceChangePct = prevClose !== 0 ? (close / prevClose - 1) * 100 : 0
    const breakoutHigh = windowHigh(rows, index - 1, 20)
    const breakoutLow = windowLow(rows, index - 1, 20)

    const breakoutUp = prevClose <= breakoutHigh && close > breakoutHigh && close >= open
    const breakoutDown = prevClose >= breakoutLow && close < breakoutLow && close <= open
    const volumeConfirmed = volumeRatio >= 1.4
    if (!volumeConfirmed || (!breakoutUp && !breakoutDown)) continue

    const signalType: 'buy' | 'sell' = breakoutUp ? 'buy' : 'sell'
    const breakoutLevel = breakoutUp ? breakoutHigh : breakoutLow
    const score = Math.min(100, 52 + Math.max(0, volumeRatio - 1) * 18 + Math.abs(priceChangePct) * 5)
    const reason = breakoutUp
      ? `放量突破前高 (${close.toFixed(2)} > ${breakoutHigh.toFixed(2)}，量比${volumeRatio.toFixed(2)})`
      : `放量跌破前低 (${close.toFixed(2)} < ${breakoutLow.toFixed(2)}，量比${volumeRatio.toFixed(2)})`

    inserted.push({
      barIndex: index,
      tradeDate: curr.trade_date,
      tradeTime: curr.trade_time,
      signalType,
      factorType: 'volume_price_breakout',
      sourceStrategy: 'volume_price_breakout_v2',
      score,
      reason,
      payload: { prevClose, close, open, breakoutLevel, volume20Avg, volumeRatio, priceChangePct }
    })
  }

  return inserted
}

export const createFactorCandidateService = (deps: FactorCandidateServiceDeps) => {
  const { getKlineTable, toBarTimestamp } = deps

  const loadOrderedKlines = (code: string, period: PeriodType, limit: number) => {
    const database = getDb()
    const table = getKlineTable(period)
    const stock = database.prepare('SELECT name FROM stock_list WHERE code = ? LIMIT 1').get(code) as { name?: string } | undefined
    const stockName = stock?.name || code
    const rows = period === '1d'
      ? database.prepare(`
          SELECT trade_date, open, high, low, close, volume
          FROM ${table}
          WHERE code = ?
          ORDER BY trade_date DESC
          LIMIT ?
        `).all(code, limit) as KlineCandidateRow[]
      : database.prepare(`
          SELECT trade_date, trade_time, open, high, low, close, volume
          FROM ${table}
          WHERE code = ?
          ORDER BY trade_date DESC, trade_time DESC
          LIMIT ?
        `).all(code, limit) as KlineCandidateRow[]

    return { stockName, ordered: [...rows].reverse() }
  }

  const generateFactorCandidates = (code: string, period: PeriodType, limit = 260) => {
    const database = getDb()
    const { stockName, ordered } = loadOrderedKlines(code, period, limit)
    const outcomeSettings = loadOutcomeGateSettingsFromDb()
    const outcomeConfig = outcomeSettings[period]

    if (ordered.length < 90) {
      return {
        code,
        period,
        created: 0,
        reason: 'kline_not_enough',
        minRequired: 90,
        available: ordered.length
      }
    }

    const now = Math.floor(Date.now() / 1000)
    const placeholders = STRATEGY_NAMES.map(() => '?').join(', ')
    database.prepare(`
      DELETE FROM signal_candidates
      WHERE code = ? AND period = ? AND status = 'proposed' AND source_strategy IN (${placeholders})
    `).run(code, period, ...STRATEGY_NAMES)

    const inserted: Array<{
      id: string
      signalType: 'buy' | 'sell'
      tradeDate: string
      tradeTime?: string
      score: number
      reason: string
      factorType: string
      forwardExitReturnPct: number | null
      forwardMaxReturnPct: number | null
      forwardMinReturnPct: number | null
      forwardRiskReward: number | null
      outcomeTag: string
    }> = []

    const factorDrafts = [
      ...buildMaCandidates(ordered),
      ...buildRsiCandidates(ordered),
      ...buildMacdCandidates(ordered),
      ...buildBollCandidates(ordered),
      ...buildVolumePriceCandidates(ordered)
    ]

    const qualifiedDrafts = factorDrafts
      .map((draft) => withOutcomeLabel(draft, ordered, outcomeConfig))
      .filter((draft): draft is CandidateDraft => draft !== null)

    for (let index = 0; index < qualifiedDrafts.length; index++) {
      const draft = qualifiedDrafts[index]
      const candidateId = `cand_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`
      database.prepare(`
        INSERT INTO signal_candidates (
          id, code, stock_name, period, trade_date, trade_time, bar_timestamp,
          signal_type, factor_type, score, reason, source_strategy, status, payload, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)
      `).run(
        candidateId,
        code,
        stockName,
        period,
        draft.tradeDate,
        draft.tradeTime || null,
        toBarTimestamp(draft.tradeDate, draft.tradeTime),
        draft.signalType,
        draft.factorType,
        draft.score,
        draft.reason,
        draft.sourceStrategy,
        JSON.stringify(draft.payload),
        now,
        now
      )

      const forwardExitReturnPct = typeof draft.payload.forward_exit_return_pct === 'number' ? draft.payload.forward_exit_return_pct : null
      const forwardMaxReturnPct = typeof draft.payload.forward_max_return_pct === 'number' ? draft.payload.forward_max_return_pct : null
      const forwardMinReturnPct = typeof draft.payload.forward_min_return_pct === 'number' ? draft.payload.forward_min_return_pct : null
      const forwardRiskReward = typeof draft.payload.forward_risk_reward === 'number' ? draft.payload.forward_risk_reward : null
      const outcomeTag = typeof draft.payload.outcome_tag === 'string' ? draft.payload.outcome_tag : ''

      inserted.push({
        id: candidateId,
        signalType: draft.signalType,
        tradeDate: draft.tradeDate,
        tradeTime: draft.tradeTime,
        score: draft.score,
        reason: draft.reason,
        factorType: draft.factorType,
        forwardExitReturnPct,
        forwardMaxReturnPct,
        forwardMinReturnPct,
        forwardRiskReward,
        outcomeTag,
      })
    }

    return {
      code,
      period,
      created: inserted.length,
      factors: ['ma_cross', 'rsi_reversal', 'macd_cross', 'boll_reversion', 'volume_price_breakout'],
      candidates: inserted.slice(-100)
    }
  }

  return {
    generateFactorCandidates
  }
}
