import { useState, useEffect, useMemo } from 'react'
import type { SessionReview } from '../../../types/ipc'
import type { LocalActionLog, TrainingSample } from '../blind/types'
import { TRADE_REASON_OPTIONS } from '../blind/types'
import BaseKlineChart from '../blind/BaseKlineChart'
import type { BaseMarker } from '../blind/BaseKlineChart'
import { toSignedMoney, toSignedPct } from './formatters'

interface BenchmarkSignal {
  barIndex: number
  signalType: 'buy' | 'sell'
  score: number
  factorType: string
}

interface ResultSummaryProps {
  totalPnl: number
  totalPnlPct: number
  actions: LocalActionLog[]
  sessionReview: SessionReview | null
  activeSample: TrainingSample | null
  continuousMode: boolean
  onContinueTraining: () => void
  onExitContinuous: () => void
  onSwitchSample: () => void
}

const ResultSummary = ({
  totalPnl,
  totalPnlPct,
  actions,
  sessionReview,
  activeSample,
  continuousMode,
  onContinueTraining,
  onExitContinuous,
  onSwitchSample
}: ResultSummaryProps) => {
  const [showChart, setShowChart] = useState(false)
  const [showBenchmark, setShowBenchmark] = useState(false)
  const [benchmarkSignals, setBenchmarkSignals] = useState<BenchmarkSignal[]>([])

  useEffect(() => {
    if (!activeSample || !showBenchmark) return

    let cancelled = false

    const fetchBenchmark = async () => {
      try {
        const candidates = await window.electronAPI?.listCandidates?.({
          code: activeSample.code,
          period: activeSample.period,
          limit: 200
        })
        if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
          if (!cancelled) setBenchmarkSignals([])
          return
        }

        const timestamps = activeSample.klines.map((k) => k.timestamp)
        const mapped: BenchmarkSignal[] = []
        for (const cand of candidates) {
          const candTs = Number(cand.bar_timestamp || 0)
          if (!candTs) continue
          let bestIdx = -1
          let bestDiff = Infinity
          for (let i = 0; i < timestamps.length; i++) {
            const diff = Math.abs(timestamps[i]! - candTs)
            if (diff < bestDiff) {
              bestDiff = diff
              bestIdx = i
            }
          }
          if (bestIdx >= 0 && bestDiff < 86400000) {
            mapped.push({
              barIndex: bestIdx,
              signalType: String(cand.signal_type || cand.label_type || 'buy') === 'sell' ? 'sell' : 'buy',
              score: Number(cand.score || 0),
              factorType: String(cand.factor_type || 'unknown'),
            })
          }
        }
        if (!cancelled) setBenchmarkSignals(mapped)
      } catch {
        if (!cancelled) setBenchmarkSignals([])
      }
    }

    void fetchBenchmark()
    return () => {
      cancelled = true
    }
  }, [activeSample, showBenchmark])

  const fullMarkers: BaseMarker[] = actions
    .filter((a) => a.actionType === 'buy' || a.actionType === 'sell')
    .map((a) => ({
      barIndex: a.barIndex,
      actionType: a.actionType as 'buy' | 'sell',
      price: a.price
    }))

  const benchmarkMarkers: BaseMarker[] = useMemo(() => {
    if (!showBenchmark || benchmarkSignals.length === 0 || !activeSample) return []
    return benchmarkSignals
      .map((sig) => {
        const bar = activeSample.klines[sig.barIndex]
        if (!bar) return null
        return {
          barIndex: sig.barIndex,
          actionType: sig.signalType,
          price: bar.close
        }
      })
      .filter((m): m is BaseMarker => m !== null)
  }, [showBenchmark, benchmarkSignals, activeSample])

  const benchmarkComparison = useMemo(() => {
    if (!showBenchmark || benchmarkSignals.length === 0) return null
    const userBuys = new Set(actions.filter((a) => a.actionType === 'buy').map((a) => a.barIndex))
    const userSells = new Set(actions.filter((a) => a.actionType === 'sell').map((a) => a.barIndex))

    let matches = 0
    let conflicts = 0
    for (const sig of benchmarkSignals) {
      const nearbyRange = 3
      let userMatch = false
      if (sig.signalType === 'buy') {
        for (let i = sig.barIndex - nearbyRange; i <= sig.barIndex + nearbyRange; i++) {
          if (userBuys.has(i)) { userMatch = true; break }
        }
      } else {
        for (let i = sig.barIndex - nearbyRange; i <= sig.barIndex + nearbyRange; i++) {
          if (userSells.has(i)) { userMatch = true; break }
        }
      }
      if (userMatch) matches++
      else conflicts++
    }
    return { matches, conflicts, total: benchmarkSignals.length }
  }, [showBenchmark, benchmarkSignals, actions])

  const completedTrades = useMemo(() => {
    const trades: { buyIndex: number; sellIndex: number; pnl: number; holdingBars: number }[] = []
    let lastBuy: { index: number; price: number } | null = null
    for (const action of actions) {
      if (action.actionType === 'buy') {
        lastBuy = { index: action.barIndex, price: action.price }
      } else if (action.actionType === 'sell' && lastBuy) {
        trades.push({
          buyIndex: lastBuy.index,
          sellIndex: action.barIndex,
          pnl: action.realizedPnl || 0,
          holdingBars: action.barIndex - lastBuy.index
        })
        lastBuy = null
      }
    }
    return trades
  }, [actions])

  const winRate = completedTrades.length > 0
    ? (completedTrades.filter((t) => t.pnl > 0).length / completedTrades.length) * 100
    : 0

  const avgHoldingBars = completedTrades.length > 0
    ? completedTrades.reduce((sum, t) => sum + t.holdingBars, 0) / completedTrades.length
    : 0

  const avgDailyReturn = sessionReview?.avg_daily_return_pct ?? 0
  const winHoldEfficiency = sessionReview?.win_hold_efficiency ?? 0

  return (
    <section className="wt-result">
      <div className="wt-result-header">
        <h3>训练结束</h3>
        <div className="wt-result-actions">
          <button className="wt-btn wt-btn-primary" onClick={onContinueTraining}>
            下一题
          </button>
          {continuousMode ? (
            <button className="wt-btn wt-btn-secondary" onClick={onExitContinuous}>
              结束连续训练
            </button>
          ) : (
            <button className="wt-btn wt-btn-secondary" onClick={onSwitchSample}>
              换一个样本
            </button>
          )}
        </div>
      </div>

      <div className="wt-result-grid">
        <div className="wt-result-card wt-result-card-main">
          <div className="wt-result-label">总收益</div>
          <div className={`wt-result-value ${totalPnl >= 0 ? 'up' : 'down'}`}>{toSignedMoney(totalPnl)}</div>
          <div className={`wt-result-sub ${totalPnlPct >= 0 ? 'up' : 'down'}`}>
            收益率 {toSignedPct(totalPnlPct)}
          </div>
        </div>
        <div className="wt-result-card">
          <div className="wt-result-label">操作次数</div>
          <div className="wt-result-value">{actions.length}</div>
        </div>
        <div className="wt-result-card">
          <div className="wt-result-label">交易胜率</div>
          <div className="wt-result-value">
            {sessionReview ? `${(sessionReview.trade_win_rate * 100).toFixed(1)}%` : `${winRate.toFixed(1)}%`}
          </div>
        </div>
        <div className="wt-result-card">
          <div className="wt-result-label">最大回撤</div>
          <div className="wt-result-value down">
            {sessionReview ? `${sessionReview.max_drawdown_pct.toFixed(2)}%` : '-'}
          </div>
        </div>
        {activeSample && (
          <div className="wt-result-card">
            <div className="wt-result-label">揭晓标的</div>
            <div className="wt-result-value" style={{ fontSize: '0.9rem' }}>
              {activeSample.name}（{activeSample.code}）· {activeSample.actualDate || '-'} · {activeSample.period}
            </div>
          </div>
        )}
      </div>

      <div className="wt-result-efficiency">
        <h4>📊 本轮赚钱效率</h4>
        <div className="wt-efficiency-grid">
          <div className="wt-eff-item">
            <div className="wt-eff-label">平均持仓Bar</div>
            <div className="wt-eff-value">{avgHoldingBars.toFixed(1)}</div>
            <div className="wt-eff-hint">买入到卖出的平均K线数</div>
          </div>
          <div className="wt-eff-item">
            <div className="wt-eff-label">日均收益率</div>
            <div className={`wt-eff-value ${avgDailyReturn >= 0 ? 'up' : 'down'}`}>
              {avgDailyReturn >= 0 ? '+' : ''}{avgDailyReturn.toFixed(3)}%
            </div>
            <div className="wt-eff-hint">每持仓一天的平均收益率</div>
          </div>
          <div className="wt-eff-item">
            <div className="wt-eff-label">胜率持仓效率</div>
            <div className="wt-eff-value">{winHoldEfficiency.toFixed(2)}</div>
            <div className="wt-eff-hint">胜率(%) / 平均持仓天数，越高赚钱越快</div>
          </div>
          <div className="wt-eff-item">
            <div className="wt-eff-label">完成交易</div>
            <div className="wt-eff-value">{completedTrades.length}笔</div>
            <div className="wt-eff-hint">完整买入卖出闭环次数</div>
          </div>
        </div>
      </div>

      {activeSample && activeSample.klines.length > 0 && (
        <div className="wt-result-chart-section">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="wt-btn wt-btn-secondary" onClick={() => setShowChart((v) => !v)}>
              {showChart ? '收起K线全景' : '查看K线全景（含买卖标记）'}
            </button>
            {showChart && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: '#7b8cab', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showBenchmark}
                  onChange={(e) => setShowBenchmark(e.target.checked)}
                />
                显示模型信号基准
              </label>
            )}
          </div>
          {showChart && (
            <div className="wt-result-chart" style={{ height: 360, marginTop: 12 }}>
              <BaseKlineChart
                data={activeSample.klines}
                markers={fullMarkers}
                benchmarkMarkers={showBenchmark ? benchmarkMarkers : undefined}
                ticker={activeSample.code}
              />
              {showBenchmark && (
                <div className="wt-benchmark-legend" style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.8rem', color: '#7b8cab' }}>
                  <span>◆ 你的交易 (红买/绿卖)</span>
                  <span>△ 模型信号 (橙买/蓝卖)</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {benchmarkComparison && (
        <div className="wt-benchmark-compare" style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(77,122,178,0.06)', borderRadius: 8, fontSize: '0.85rem' }}>
          <strong>模型基准对比:</strong>{' '}
          匹配 {benchmarkComparison.matches}/{benchmarkComparison.total} 个信号，{' '}
          漏判 {benchmarkComparison.conflicts} 个。{' '}
          {benchmarkComparison.total > 0 && (
            <span>重合率 {(benchmarkComparison.matches / benchmarkComparison.total * 100).toFixed(0)}%。</span>
          )}
        </div>
      )}

      {actions.some((action) => action.reason) && (
        <div className="wt-reason-dist">
          <span className="wt-reason-dist-label">交易理由分布:</span>
          {Object.entries(
            actions
              .filter((action) => action.reason)
              .reduce<Record<string, number>>((accumulator, action) => {
                accumulator[action.reason!] = (accumulator[action.reason!] || 0) + 1
                return accumulator
              }, {})
          )
            .sort(([, left], [, right]) => right - left)
            .map(([reasonKey, count]) => {
              const option = TRADE_REASON_OPTIONS.find((item) => item.value === reasonKey)
              return (
                <span key={reasonKey} className="wt-reason-dist-tag">
                  {option?.label || reasonKey} ×{count}
                </span>
              )
            })}
        </div>
      )}
    </section>
  )
}

export default ResultSummary
