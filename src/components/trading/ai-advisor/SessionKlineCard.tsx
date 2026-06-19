import { useState } from 'react'
import BaseKlineChart, { type BaseKlineBar, type BaseMarker } from '../blind/BaseKlineChart'
import type { RepresentativeSession, SessionKlineResult } from '../../../types/agent'

interface SessionKlineCardProps {
  session: RepresentativeSession
  defaultExpanded?: boolean
}

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

export default function SessionKlineCard({ session, defaultExpanded = false }: SessionKlineCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SessionKlineResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExpand = async () => {
    if (!expanded && !result) {
      setLoading(true)
      setError(null)
      try {
        const r = await window.electronAPI?.session?.getKlineForSession(session.sessionId)
        const data = r && typeof r === 'object' && (r as { success?: boolean }).success === true
          ? (r as { data: SessionKlineResult }).data
          : null
        if (data) {
          setResult(data)
        } else {
          setError((r as { error?: { message?: string } })?.error?.message ?? '加载失败')
        }
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    setExpanded(!expanded)
  }

  const bars: BaseKlineBar[] = (result?.bars ?? []).map(b => ({
    timestamp: b.timestamp,
    open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  }))
  const markers: BaseMarker[] = (result?.markers ?? []).map(m => ({
    barIndex: m.barIndex, actionType: m.actionType, price: m.price,
  }))

  return (
    <div className="session-kline-card">
      <div className="session-kline-card-header" onClick={handleExpand}>
        <span className="session-kline-card-title">
          {session.stock_name} {session.stock_code}
        </span>
        <span className="session-kline-card-meta">
          盈亏 {fmtPct(session.realized_pnl_pct)} · {session.total_trades} 笔
        </span>
        <span className="session-kline-card-toggle">{expanded ? '▲ 收起' : '▼ 展开 K 线'}</span>
      </div>
      {expanded && (
        <div className="session-kline-card-body">
          {loading && <div className="session-kline-card-loading">加载 K 线中...</div>}
          {error && <div className="session-kline-card-error">{error}</div>}
          {result && result.bars.length > 0 && (
            <>
              <div style={{ height: 320 }}>
                <BaseKlineChart data={bars} markers={markers} minHeight={300} />
              </div>
              {result.note && <div className="session-kline-card-note">{result.note}</div>}
            </>
          )}
          {result && result.bars.length === 0 && (
            <div className="session-kline-card-note">{result.note ?? '无 K 线数据'}</div>
          )}
        </div>
      )}
    </div>
  )
}
