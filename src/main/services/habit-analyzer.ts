import type {
  HabitIndicators,
  HabitAnalyzerConfig,
  TradeActionRow,
  SessionReviewRow,
  SessionRow,
} from '../../types/agent'
import { DEFAULT_HABIT_CONFIG } from '../../types/agent'

// 降级实现说明（spec §2.3）：
// 追涨率/止损纪律本应 join kline_daily 取前 N 根高点，
// 但盲训 bar_index 与 K 线行号可能不对齐（mask），
// 这里改用同 session 内 buy 价格序列的局部 max 作为"前 N 根高点"代理。
// 精度略损，但保证可算且不依赖外部 K 线表。
export function computeHabitIndicators(
  actions: TradeActionRow[],
  reviews: SessionReviewRow[],
  sessions: SessionRow[],
  config: HabitAnalyzerConfig = DEFAULT_HABIT_CONFIG
): HabitIndicators {
  return {
    chase_high_rate: computeChaseHighRate(actions, config),
    inverse_pyramid_rate: computeInversePyramidRate(actions),
    stop_loss_discipline: computeStopLossDiscipline(actions, config),
    profit_loss_ratio: computeProfitLossRatio(actions),
    profit_taking_timing: computeProfitTakingTiming(actions),
    avg_holding_bars: computeAvgHoldingBars(reviews),
    avg_position_ratio: computeAvgPositionRatio(actions, sessions),
    result_group: computeResultGroup(reviews, sessions),
  }
}

// 追涨率 = 追高买入笔数 / 总买入笔数
// 一笔 buy 视为追高，当其 price >= 同 session 此前所有 buy price 的 max * (1 + threshold)
function computeChaseHighRate(actions: TradeActionRow[], config: HabitAnalyzerConfig): number {
  const bySession = groupBySession(actions)
  let totalBuys = 0
  let chaseBuys = 0
  for (const sessActions of bySession.values()) {
    const buys = sessActions
      .filter(a => a.action_type === 'buy' && a.price != null)
      .sort((a, b) => a.bar_index - b.bar_index)
    let prevMax = -Infinity
    for (const buy of buys) {
      const price = buy.price as number
      totalBuys++
      if (prevMax !== -Infinity && price >= prevMax * (1 + config.chaseHighThreshold)) {
        chaseBuys++
      }
      prevMax = Math.max(prevMax, price)
    }
  }
  if (totalBuys === 0) return 0
  return chaseBuys / totalBuys
}

// 倒金字塔加仓率 = 倒金字塔 session 数 / 有多笔 buy 的 session 数
// 一个 session 视为倒金字塔，当其存在后续 buy price 高于首笔 buy price
function computeInversePyramidRate(actions: TradeActionRow[]): number {
  const bySession = groupBySession(actions)
  let multiBuySessions = 0
  let inversePyramidSessions = 0
  for (const sessActions of bySession.values()) {
    const buys = sessActions
      .filter(a => a.action_type === 'buy' && a.price != null)
      .sort((a, b) => a.bar_index - b.bar_index)
    if (buys.length < 2) continue
    multiBuySessions++
    const firstPrice = buys[0].price as number
    if (buys.some(b => (b.price as number) > firstPrice)) {
      inversePyramidSessions++
    }
  }
  if (multiBuySessions === 0) return 0
  return inversePyramidSessions / multiBuySessions
}

// 盈亏比 = avg(盈利单 realized_pnl) / abs(avg(亏损单 realized_pnl))
function computeProfitLossRatio(actions: TradeActionRow[]): number {
  const sells = actions.filter(a => a.action_type === 'sell' && a.realized_pnl != null)
  const wins = sells.filter(a => (a.realized_pnl as number) > 0)
  const losses = sells.filter(a => (a.realized_pnl as number) < 0)
  if (wins.length === 0 || losses.length === 0) return 0
  const avgWin = wins.reduce((s, a) => s + (a.realized_pnl as number), 0) / wins.length
  const avgLoss = Math.abs(losses.reduce((s, a) => s + (a.realized_pnl as number), 0) / losses.length)
  if (avgLoss === 0) return 0
  return avgWin / avgLoss
}

interface BuySellPair {
  sessionId: string
  buyBar: number
  buyPrice: number | null
  buyShares: number | null
  sellBar: number
  realizedPnl: number
}

// 简化配对：每个 session 内按 bar_index 顺序，buy 后最近的 sell 配对（FIFO 近似）
function pairBuySell(actions: TradeActionRow[]): BuySellPair[] {
  const pairs: BuySellPair[] = []
  const bySession = groupBySession(actions)
  for (const [sessionId, sessActions] of bySession.entries()) {
    const sorted = [...sessActions].sort((a, b) => a.bar_index - b.bar_index)
    let pending: { buyBar: number; buyPrice: number | null; buyShares: number | null } | null = null
    for (const a of sorted) {
      if (a.action_type === 'buy') {
        pending = { buyBar: a.bar_index, buyPrice: a.price, buyShares: a.shares }
      } else if (a.action_type === 'sell' && pending !== null) {
        pairs.push({
          sessionId,
          buyBar: pending.buyBar,
          buyPrice: pending.buyPrice,
          buyShares: pending.buyShares,
          sellBar: a.bar_index,
          realizedPnl: a.realized_pnl ?? 0,
        })
        pending = null
      }
    }
  }
  return pairs
}

// 止盈过早/过晚 = 盈利单平均持仓 bars / 亏损单平均持仓 bars
// < 0.8 = 赚一点就跑；> 1.3 = 拿得住盈利
function computeProfitTakingTiming(actions: TradeActionRow[]): number {
  const pairs = pairBuySell(actions)
  const winBars: number[] = []
  const lossBars: number[] = []
  for (const p of pairs) {
    const bars = p.sellBar - p.buyBar
    if (p.realizedPnl > 0) winBars.push(bars)
    else if (p.realizedPnl < 0) lossBars.push(bars)
  }
  if (winBars.length === 0 || lossBars.length === 0) return 0
  const avgWin = winBars.reduce((s, b) => s + b, 0) / winBars.length
  const avgLoss = lossBars.reduce((s, b) => s + b, 0) / lossBars.length
  if (avgLoss === 0) return 0
  return avgWin / avgLoss
}

// 止损纪律 = 已止损笔数 / 应止损笔数
// 降级算法：每笔 buy-sell 配对，若 realized_pnl/(buyPrice*buyShares) <= stopLossThreshold 视为"应止损"；
// 若该 sell 在 buy 后 stopLossGraceBars 根 bar 内 → 已止损
function computeStopLossDiscipline(actions: TradeActionRow[], config: HabitAnalyzerConfig): number {
  const pairs = pairBuySell(actions)
  let shouldStop = 0
  let didStop = 0
  for (const p of pairs) {
    if (p.buyPrice == null || p.buyPrice <= 0 || p.buyShares == null || p.buyShares <= 0) continue
    const cost = p.buyPrice * p.buyShares
    if (cost <= 0) continue
    const lossPct = p.realizedPnl / cost
    if (lossPct <= config.stopLossThreshold) {
      shouldStop++
      if (p.sellBar - p.buyBar <= config.stopLossGraceBars) {
        didStop++
      }
    }
  }
  if (shouldStop === 0) return 0
  return didStop / shouldStop
}

// 平均持仓 bars = session_reviews.avg_holding_bars 加权平均
function computeAvgHoldingBars(reviews: SessionReviewRow[]): number {
  if (reviews.length === 0) return 0
  const sum = reviews.reduce((s, r) => s + (r.avg_holding_bars || 0), 0)
  return sum / reviews.length
}

// 单笔仓位占比中位数 = buy amount / session initial_capital
function computeAvgPositionRatio(actions: TradeActionRow[], sessions: SessionRow[]): number {
  const capitalBySession = new Map(sessions.map(s => [s.id, s.initial_capital]))
  const ratios: number[] = []
  for (const a of actions) {
    if (a.action_type !== 'buy' || a.amount == null) continue
    const cap = capitalBySession.get(a.session_id)
    if (!cap || cap <= 0) continue
    ratios.push(a.amount / cap)
  }
  if (ratios.length === 0) return 0
  ratios.sort((x, y) => x - y)
  const mid = Math.floor(ratios.length / 2)
  return ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid]
}

// 结果组：直接从 session_reviews 聚合 + sessions 算连损
function computeResultGroup(reviews: SessionReviewRow[], sessions: SessionRow[]): HabitIndicators['result_group'] {
  if (reviews.length === 0) {
    return { win_rate: 0, avg_pnl_pct: 0, max_drawdown_pct: 0, max_loss_streak: computeMaxLossStreak(sessions) }
  }
  const winRate = reviews.reduce((s, r) => s + (r.trade_win_rate || 0), 0) / reviews.length
  const avgPnlPct = reviews.reduce((s, r) => s + (r.realized_pnl_pct || 0), 0) / reviews.length
  const maxDd = Math.max(...reviews.map(r => r.max_drawdown_pct || 0))
  const maxLossStreak = computeMaxLossStreak(sessions)
  return { win_rate: winRate, avg_pnl_pct: avgPnlPct, max_drawdown_pct: maxDd, max_loss_streak: maxLossStreak }
}

// 连损场次：按 started_at 排序，realized_pnl < 0 视为亏损场，算最长连续
function computeMaxLossStreak(sessions: SessionRow[]): number {
  const sorted = [...sessions].sort((a, b) => a.started_at - b.started_at)
  let max = 0
  let cur = 0
  for (const s of sorted) {
    if ((s.realized_pnl ?? 0) < 0) {
      cur++
      max = Math.max(max, cur)
    } else {
      cur = 0
    }
  }
  return max
}

function groupBySession(actions: TradeActionRow[]): Map<string, TradeActionRow[]> {
  const map = new Map<string, TradeActionRow[]>()
  for (const a of actions) {
    const list = map.get(a.session_id) ?? []
    list.push(a)
    map.set(a.session_id, list)
  }
  return map
}
