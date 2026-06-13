import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionActionRecord, SessionReview, SessionSummary } from '../../types/ipc'
import ReplayChart from './history/ReplayChart'
import type { ReplayAction } from './history/ReplayChart'
import './TrainingHistory.css'
import '../../types/global.d.ts'

const toMillis = (value: number | null | undefined): number => {
  if (!value || !Number.isFinite(value)) return 0
  return value < 1_000_000_000_000 ? value * 1000 : value
}

const formatDateTime = (value: number | null | undefined): string => {
  const ms = toMillis(value)
  if (!ms) return '-'
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

const formatSignedNumber = (value: number, digits = 0): string => {
  const safe = Number.isFinite(value) ? value : 0
  return `${safe >= 0 ? '+' : ''}${safe.toFixed(digits)}`
}

const formatSignedPercent = (value: number): string => `${formatSignedNumber(value, 2)}%`

const toSessionPnlPct = (session: SessionSummary): number => {
  if (typeof session.realized_pnl_pct === 'number') return session.realized_pnl_pct
  const initial = Number(session.initial_capital || 0)
  const final = Number(session.final_capital ?? initial)
  if (initial <= 0) return 0
  return ((final - initial) / initial) * 100
}

const toSessionWinRate = (session: SessionSummary): number => {
  if (typeof session.trade_win_rate === 'number') return session.trade_win_rate
  const sellCount = Number(session.sell_count ?? 0)
  if (sellCount <= 0) return 0
  return Number(session.winning_trades || 0) / sellCount
}

const actionTypeLabel = (type: SessionActionRecord['action_type']): string => {
  if (type === 'buy') return '买入'
  if (type === 'sell') return '卖出'
  if (type === 'hold') return '持有'
  return '跳过'
}

const TrainingHistory = () => {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>('')
  const [periodFilter, setPeriodFilter] = useState<'all' | '5m' | '15m' | '1d'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '30d' | '90d'>('30d')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'finished'>('all')
  const [keyword, setKeyword] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailActions, setDetailActions] = useState<SessionActionRecord[]>([])
  const [detailReview, setDetailReview] = useState<SessionReview | null>(null)
  const [detailKlineData, setDetailKlineData] = useState<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]>([])
  const [showReplayChart, setShowReplayChart] = useState(false)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const rows = await window.electronAPI?.db?.listSessions()
      setSessions(rows || [])
    } catch (error) {
      console.error('加载训练会话失败:', error)
      setLoadError('训练会话加载失败，请稍后重试')
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleOpenSession = useCallback(async (sessionId: string) => {
    if (selectedSessionId === sessionId) {
      setSelectedSessionId('')
      setDetailActions([])
      setDetailReview(null)
      setDetailKlineData([])
      setShowReplayChart(false)
      return
    }

    setSelectedSessionId(sessionId)
    setDetailLoading(true)
    setShowReplayChart(false)
    try {
      const [actions, review] = await Promise.all([
        window.electronAPI?.db?.getSessionActions(sessionId),
        window.electronAPI?.db?.getSessionReview(sessionId)
      ])
      setDetailActions(actions || [])
      setDetailReview(review || null)
      setDetailKlineData([])
    } catch (error) {
      console.error('加载会话详情失败:', error)
      setDetailActions([])
      setDetailReview(null)
      setDetailKlineData([])
    } finally {
      setDetailLoading(false)
    }
  }, [selectedSessionId])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const filteredSessions = useMemo(() => {
    const now = Date.now()
    const keywordLower = keyword.trim().toLowerCase()

    return sessions.filter((session) => {
      if (periodFilter !== 'all' && session.interval_type !== periodFilter) {
        return false
      }

      if (statusFilter !== 'all' && session.status !== statusFilter) {
        return false
      }

      if (dateFilter !== 'all') {
        const startedAt = toMillis(session.started_at)
        if (!startedAt) return false
        const diff = now - startedAt
        const maxAge = dateFilter === '7d'
          ? 7 * 24 * 60 * 60 * 1000
          : dateFilter === '30d'
            ? 30 * 24 * 60 * 60 * 1000
            : 90 * 24 * 60 * 60 * 1000
        if (diff > maxAge) return false
      }

      if (keywordLower) {
        const text = `${session.stock_code} ${session.stock_name || ''}`.toLowerCase()
        if (!text.includes(keywordLower)) return false
      }

      return true
    })
  }, [sessions, periodFilter, dateFilter, statusFilter, keyword])

  useEffect(() => {
    if (!selectedSessionId) return
    const stillExists = filteredSessions.some((item) => item.id === selectedSessionId)
    if (stillExists) return
    setSelectedSessionId('')
    setDetailActions([])
    setDetailReview(null)
    setDetailKlineData([])
    setShowReplayChart(false)
  }, [filteredSessions, selectedSessionId])

  const loadKlineForSession = useCallback(async (session: SessionSummary) => {
    try {
      const raw = await window.electronAPI?.data?.getKline(session.stock_code, session.interval_type, 500)
      if (raw && Array.isArray(raw)) {
        const bars = raw
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map((item) => {
            const rawTs = item.timestamp || item.date || item.time || ''
            const ts = typeof rawTs === 'string' ? new Date(rawTs).getTime() : Number(rawTs || 0)
            return {
              timestamp: Number.isFinite(ts) && ts > 0 ? ts : 0,
              open: Number(item.open || 0),
              high: Number(item.high || 0),
              low: Number(item.low || 0),
              close: Number(item.close || 0),
              volume: Number(item.volume || 0)
            }
          })
          .filter((b) => b.timestamp > 0 && b.close > 0)
          .sort((a, b) => a.timestamp - b.timestamp)
        setDetailKlineData(bars)
        setShowReplayChart(bars.length > 0)
      }
    } catch (error) {
      console.error('加载K线数据失败:', error)
    }
  }, [])

  const selectedSession = useMemo(
    () => filteredSessions.find((item) => item.id === selectedSessionId) || null,
    [filteredSessions, selectedSessionId]
  )

  const replayActions = useMemo<ReplayAction[]>(() => {
    return detailActions
      .filter((a) => a.action_type === 'buy' || a.action_type === 'sell')
      .map((a) => ({
        barIndex: Number(a.bar_index || 0),
        actionType: a.action_type as 'buy' | 'sell',
        price: Number(a.price || 0)
      }))
  }, [detailActions])

  return (
    <div className="history-page">
      <div className="history-header">
        <div>
          <h1>训练记录</h1>
          <p>真实会话与动作复盘（来源：training_sessions / trade_actions）</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => void loadSessions()} disabled={loading}>
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {loadError && <div className="history-error">{loadError}</div>}

      <div className="history-filters">
        <label>
          周期
          <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as 'all' | '5m' | '15m' | '1d')}>
            <option value="all">全部</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1d">1d</option>
          </select>
        </label>
        <label>
          时间范围
          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as 'all' | '7d' | '30d' | '90d')}>
            <option value="all">全部</option>
            <option value="7d">近7天</option>
            <option value="30d">近30天</option>
            <option value="90d">近90天</option>
          </select>
        </label>
        <label>
          状态
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'finished')}>
            <option value="all">全部</option>
            <option value="finished">已结束</option>
            <option value="active">进行中</option>
          </select>
        </label>
        <label className="keyword">
          搜索
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="股票代码/名称"
          />
        </label>
      </div>

      <div className="history-content">
        <section className="session-list-panel">
          {loading ? (
            <div className="history-empty">正在加载会话...</div>
          ) : sessions.length === 0 ? (
            <div className="history-empty">暂无训练记录，先去盲训工作台跑一局。</div>
          ) : filteredSessions.length === 0 ? (
            <div className="history-empty">当前筛选条件下暂无会话。</div>
          ) : (
            <div className="session-list">
              {filteredSessions.map((session) => {
                const pnlPct = toSessionPnlPct(session)
                const winRate = toSessionWinRate(session)
                const tradeCount = Number(session.sell_count ?? session.total_trades ?? 0)
                return (
                  <button
                    key={session.id}
                    className={`session-item ${selectedSessionId === session.id ? 'active' : ''}`}
                    onClick={() => void handleOpenSession(session.id)}
                  >
                    <div className="session-item-main">
                      <strong>{session.stock_name || session.stock_code}</strong>
                      <span>{session.stock_code} · {session.interval_type}</span>
                    </div>
                    <div className="session-item-meta">
                      <span>{formatDateTime(session.started_at)}</span>
                      <span>{tradeCount}笔卖出</span>
                      <span>胜率 {(winRate * 100).toFixed(0)}%</span>
                    </div>
                    <div className={`session-item-pnl ${pnlPct >= 0 ? 'up' : 'down'}`}>
                      {formatSignedPercent(pnlPct)}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="session-detail-panel">
          {!selectedSession ? (
            <div className="history-empty">选择左侧会话查看明细</div>
          ) : detailLoading ? (
            <div className="history-empty">正在加载会话详情...</div>
          ) : (
            <div className="detail-wrap">
              <div className="detail-head">
                <h3>{selectedSession.stock_name || selectedSession.stock_code}</h3>
                <p>{selectedSession.stock_code} · {selectedSession.interval_type} · {formatDateTime(selectedSession.started_at)}</p>
              </div>

              <div className="detail-metrics">
                <div className="metric-card">
                  <span>总收益率</span>
                  <strong className={toSessionPnlPct(selectedSession) >= 0 ? 'up' : 'down'}>
                    {formatSignedPercent(toSessionPnlPct(selectedSession))}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>已实现盈亏</span>
                  <strong className={Number(detailReview?.realized_pnl || selectedSession.realized_pnl || 0) >= 0 ? 'up' : 'down'}>
                    {formatSignedNumber(Number(detailReview?.realized_pnl || selectedSession.realized_pnl || 0), 0)}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>交易胜率</span>
                  <strong>{(toSessionWinRate(selectedSession) * 100).toFixed(1)}%</strong>
                </div>
                <div className="metric-card">
                  <span>最大回撤</span>
                  <strong>{Number(detailReview?.max_drawdown_pct || 0).toFixed(2)}%</strong>
                </div>
                <div className="metric-card">
                  <span>动作统计</span>
                  <strong>
                    B{Number(detailReview?.buy_count || 0)} / S{Number(detailReview?.sell_count || 0)} / H{Number(detailReview?.hold_count || 0)}
                  </strong>
                </div>
                <div className="metric-card">
                  <span>平均持仓Bar</span>
                  <strong>{Number(detailReview?.avg_holding_bars || 0).toFixed(1)}</strong>
                </div>
                <div className="metric-card">
                  <span>平均持仓天数</span>
                  <strong>{Number(detailReview?.avg_holding_days || 0).toFixed(2)}天</strong>
                </div>
                <div className="metric-card">
                  <span>日均收益率</span>
                  <strong className={Number(detailReview?.avg_daily_return_pct || 0) >= 0 ? 'up' : 'down'}>
                    {Number(detailReview?.avg_daily_return_pct || 0) >= 0 ? '+' : ''}{Number(detailReview?.avg_daily_return_pct || 0).toFixed(3)}%
                  </strong>
                </div>
                <div className="metric-card">
                  <span>胜率持仓效率</span>
                  <strong>{Number(detailReview?.win_hold_efficiency || 0).toFixed(2)}</strong>
                </div>
              </div>

              <div className="detail-replay">
                <div className="detail-replay-header">
                  <h4>K线回放</h4>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => void loadKlineForSession(selectedSession)}
                  >
                    {showReplayChart ? '刷新K线' : '加载K线图表'}
                  </button>
                </div>
                {showReplayChart && detailKlineData.length > 0 ? (
                  <div className="replay-chart-container">
                    <ReplayChart data={detailKlineData} actions={replayActions} />
                  </div>
                ) : showReplayChart ? (
                  <div className="history-empty">K线数据不足，无法展示</div>
                ) : (
                  <div className="history-empty">点击「加载K线图表」查看买卖点标注回放</div>
                )}
              </div>

              <div className="detail-actions">
                <h4>动作明细（{detailActions.length}）</h4>
                {detailActions.length === 0 ? (
                  <div className="history-empty">该会话暂无动作记录</div>
                ) : (
                  <div className="action-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>Bar</th>
                          <th>动作</th>
                          <th>价格</th>
                          <th>数量</th>
                          <th>金额</th>
                          <th>已实现</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailActions.map((action) => {
                          const realized = Number(action.realized_pnl || 0)
                          return (
                            <tr key={action.id}>
                              <td>{formatDateTime(action.created_at)}</td>
                              <td>{action.bar_index}</td>
                              <td className={`type-${action.action_type}`}>{actionTypeLabel(action.action_type)}</td>
                              <td>{action.price !== null && action.price !== undefined ? Number(action.price).toFixed(2) : '-'}</td>
                              <td>{action.shares ?? '-'}</td>
                              <td>{action.amount !== null && action.amount !== undefined ? Number(action.amount).toFixed(0) : '-'}</td>
                              <td className={realized >= 0 ? 'up' : 'down'}>
                                {action.action_type === 'sell' ? formatSignedNumber(realized, 0) : '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default TrainingHistory
