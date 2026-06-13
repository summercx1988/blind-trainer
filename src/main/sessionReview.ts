interface ReviewActionRow {
  action_type?: string
  bar_index?: number
  realized_pnl?: number | null
  shares?: number | null
  price?: number | null
  created_at?: number | null
}

interface SessionReviewMetrics {
  tradeWinRate: number
  realizedPnl: number
  realizedPnlPct: number
  maxDrawdownPct: number
  buyCount: number
  sellCount: number
  holdCount: number
  avgHoldingBars: number
  avgHoldingDays: number
  avgDailyReturnPct: number
  winHoldEfficiency: number
  totalTrades: number
  winningTrades: number
}

interface OpenLot {
  barIndex: number
  shares: number
  price: number
}

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

const barsPerTradingDay = (intervalType: string): number => {
  if (intervalType === '5m') return 48
  if (intervalType === '15m') return 16
  return 1
}

const toHoldingDays = (holdingBars: number, intervalType: string): number => {
  const barsPerDay = barsPerTradingDay(intervalType)
  if (barsPerDay <= 0) return 0
  return Math.max(0, holdingBars) / barsPerDay
}

export const calculateSessionReviewMetrics = (
  actions: ReviewActionRow[],
  initialCapital: number,
  finalCapital: number,
  intervalType = '1d'
): SessionReviewMetrics => {
  const sorted = [...actions].sort((left, right) => {
    const barDiff = Number(left.bar_index || 0) - Number(right.bar_index || 0)
    if (barDiff !== 0) return barDiff
    return Number(left.created_at || 0) - Number(right.created_at || 0)
  })
  const buyCount = sorted.filter((item) => item.action_type === 'buy').length
  const sellCount = sorted.filter((item) => item.action_type === 'sell').length
  const holdCount = sorted.filter((item) => item.action_type === 'hold').length
  const winningTrades = sorted.filter(
    (item) => item.action_type === 'sell' && Number(item.realized_pnl || 0) > 0
  ).length
  const tradeWinRate = sellCount > 0 ? winningTrades / sellCount : 0
  const realizedPnl = sorted.reduce((sum, item) => {
    if (item.action_type !== 'sell') return sum
    return sum + Number(item.realized_pnl || 0)
  }, 0)

  const baseCapital = initialCapital > 0 ? initialCapital : 1
  const realizedPnlPct = ((finalCapital - initialCapital) / baseCapital) * 100

  let peakEquity = initialCapital
  let cumulativeRealizedPnl = 0
  let maxDrawdownPct = 0
  for (const action of sorted) {
    if (action.action_type === 'sell') {
      cumulativeRealizedPnl += Number(action.realized_pnl || 0)
      const equity = initialCapital + cumulativeRealizedPnl
      peakEquity = Math.max(peakEquity, equity)
      if (peakEquity > 0) {
        const drawdownPct = ((peakEquity - equity) / peakEquity) * 100
        maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct)
      }
    }
  }

  const lots: OpenLot[] = []
  let accumulatedHoldingBars = 0
  let accumulatedHoldingDays = 0
  let accumulatedDailyReturnPct = 0
  let closedShares = 0

  for (const action of sorted) {
    const barIndex = Number(action.bar_index || 0)
    if (action.action_type === 'buy') {
      const shares = Number(action.shares || 0)
      const price = Number(action.price || 0)
      if (shares > 0 && price > 0) {
        lots.push({ barIndex, shares, price })
      }
      continue
    }
    if (action.action_type !== 'sell') continue

    let totalSharesToClose = Number(action.shares || 0)
    if (totalSharesToClose <= 0) {
      totalSharesToClose = lots.reduce((sum, lot) => sum + lot.shares, 0)
    }
    if (totalSharesToClose <= 0) continue

    const sellRealizedPnl = Number(action.realized_pnl || 0)
    let remainingToClose = totalSharesToClose

    while (remainingToClose > 0 && lots.length > 0) {
      const headLot = lots[0]
      if (!headLot) break
      const closeShares = Math.min(headLot.shares, remainingToClose)
      const holdingBars = Math.max(0, barIndex - headLot.barIndex)
      const holdingDays = toHoldingDays(holdingBars, intervalType)
      const lotRealizedPnl = sellRealizedPnl * (closeShares / totalSharesToClose)
      const lotCostBasis = headLot.price * closeShares
      const lotReturnPct = lotCostBasis > 0 ? (lotRealizedPnl / lotCostBasis) * 100 : 0
      const lotDailyReturnPct = holdingDays > 0 ? lotReturnPct / holdingDays : lotReturnPct

      accumulatedHoldingBars += holdingBars * closeShares
      accumulatedHoldingDays += holdingDays * closeShares
      accumulatedDailyReturnPct += lotDailyReturnPct * closeShares
      closedShares += closeShares
      remainingToClose -= closeShares
      headLot.shares -= closeShares
      if (headLot.shares <= 0) {
        lots.shift()
      }
    }
  }

  const avgHoldingBars = closedShares > 0 ? accumulatedHoldingBars / closedShares : 0
  const avgHoldingDays = closedShares > 0 ? accumulatedHoldingDays / closedShares : 0
  const avgDailyReturnPct = closedShares > 0 ? accumulatedDailyReturnPct / closedShares : 0
  const winHoldEfficiency = avgHoldingDays > 0 ? (tradeWinRate * 100) / avgHoldingDays : tradeWinRate * 100

  return {
    tradeWinRate,
    realizedPnl,
    realizedPnlPct,
    maxDrawdownPct: clampPercent(maxDrawdownPct),
    buyCount,
    sellCount,
    holdCount,
    avgHoldingBars,
    avgHoldingDays,
    avgDailyReturnPct,
    winHoldEfficiency,
    totalTrades: buyCount + sellCount,
    winningTrades
  }
}
