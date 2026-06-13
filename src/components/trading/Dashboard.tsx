import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DataStats, SessionSummary } from '../../types/ipc'
import './Dashboard.css'
import '../../types/global.d'

interface DashboardProps {
  onStartTraining: () => void
}

interface DayActivity {
  date: string
  count: number
  totalPnl: number
  avgPnlPct: number
  winRate: number
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

const CELL_SIZE = 13
const CELL_GAP = 3
const CELL_STEP = CELL_SIZE + CELL_GAP

const PNL_LEVELS = [
  { max: -2, color: '#ef5350', label: '亏损 ≥2%' },
  { max: -0.5, color: '#ef9a9a', label: '亏损 0.5%-2%' },
  { max: 0, color: '#e0e0e0', label: '持平' },
  { max: 0.5, color: '#a5d6a7', label: '盈利 0-0.5%' },
  { max: 2, color: '#66bb6a', label: '盈利 0.5%-2%' },
  { max: Infinity, color: '#2e7d32', label: '盈利 ≥2%' }
]

const getColor = (avgPnlPct: number): string => {
  for (const level of PNL_LEVELS) {
    if (avgPnlPct < level.max) return level.color
  }
  return '#e0e0e0'
}

const getWeeks = (): string[] => {
  const weeks: string[] = []
  const today = new Date()
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - 364)
  const day = startDate.getDay()
  startDate.setDate(startDate.getDate() - day)
  const current = new Date(startDate)
  while (current <= today) {
    weeks.push(current.toISOString().slice(0, 10))
    current.setDate(current.getDate() + 7)
  }
  return weeks
}

const formatDuration = (ms: number): string => {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const remainMin = minutes % 60
  return remainMin > 0 ? `${hours}小时${remainMin}分` : `${hours}小时`
}

const toMillis = (value: number | null | undefined): number => {
  if (!value || !Number.isFinite(value)) return 0
  return value < 1_000_000_000_000 ? value * 1000 : value
}

const Dashboard = ({ onStartTraining }: DashboardProps) => {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [dataStats, setDataStats] = useState<DataStats | null>(null)
  const [hoveredDay, setHoveredDay] = useState<DayActivity | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [sessionResult, statsResult] = await Promise.all([
        window.electronAPI?.db?.listSessions(),
        window.electronAPI?.data?.getStats()
      ])
      if (sessionResult) setSessions(sessionResult)
      if (statsResult) setDataStats(statsResult)
    } catch (error) {
      console.error('加载训练记录失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const finishedSessions = useMemo(
    () => sessions.filter((s) => s.finished_at != null && s.finished_at > 0),
    [sessions]
  )

  const dayMap = useMemo(() => {
    const map = new Map<string, DayActivity>()
    for (const s of finishedSessions) {
      const startedAt = toMillis(s.started_at)
      if (!startedAt) continue
      const date = new Date(startedAt).toISOString().slice(0, 10)
      const existing = map.get(date) || { date, count: 0, totalPnl: 0, avgPnlPct: 0, winRate: 0 }
      existing.count += 1
      const pnl = Number(s.realized_pnl || 0)
      existing.totalPnl += pnl
      const pnlPct = Number(s.realized_pnl_pct || 0)
      existing.avgPnlPct = (existing.avgPnlPct * (existing.count - 1) + pnlPct) / existing.count
      map.set(date, existing)
    }
    return map
  }, [finishedSessions])

  const stats = useMemo(() => {
    const totalSessions = finishedSessions.length
    if (totalSessions === 0) {
      return { totalSessions, totalPnl: 0, avgPnlPct: 0, winRate: 0, totalDuration: 0, bestStreak: 0 }
    }
    let totalPnl = 0
    let wins = 0
    let totalDuration = 0
    let currentStreak = 0
    let bestStreak = 0
    let prevWin: boolean | null = null

    const sorted = [...finishedSessions].sort((a, b) => a.started_at - b.started_at)
    for (const s of sorted) {
      const pnl = Number(s.realized_pnl || 0)
      totalPnl += pnl
      const isWin = pnl >= 0
      if (isWin) wins += 1
      if (s.started_at && s.finished_at) {
        totalDuration += Math.max(0, toMillis(s.finished_at) - toMillis(s.started_at))
      }
      if (prevWin === isWin) {
        currentStreak += 1
      } else {
        currentStreak = 1
      }
      if (isWin && currentStreak > bestStreak) bestStreak = currentStreak
      prevWin = isWin
    }

    return {
      totalSessions,
      totalPnl,
      avgPnlPct: totalSessions > 0
        ? sorted.reduce((sum, s) => sum + Number(s.realized_pnl_pct || 0), 0) / totalSessions
        : 0,
      winRate: wins / totalSessions,
      totalDuration,
      bestStreak
    }
  }, [finishedSessions])

  const weeks = useMemo(() => getWeeks(), [])
  const totalWeeks = weeks.length
  const svgWidth = totalWeeks * CELL_STEP + 30
  const svgHeight = 7 * CELL_STEP + 20

  const monthMarkers = useMemo(() => {
    const markers: { label: string; x: number }[] = []
    let prevMonth = -1
    weeks.forEach((weekStart, i) => {
      const month = new Date(weekStart).getMonth()
      if (month !== prevMonth) {
        markers.push({ label: MONTH_LABELS[month], x: i * CELL_STEP + 30 })
        prevMonth = month
      }
    })
    return markers
  }, [weeks])

  const today = new Date().toISOString().slice(0, 10)

  const handleCellHover = useCallback((date: string, e: React.MouseEvent) => {
    const activity = dayMap.get(date)
    if (activity) {
      setHoveredDay(activity)
      const rect = (e.target as SVGRectElement).getBoundingClientRect()
      setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top - 8 })
    } else {
      setHoveredDay(null)
      setTooltipPos(null)
    }
  }, [dayMap])

  const handleCellLeave = useCallback(() => {
    setHoveredDay(null)
    setTooltipPos(null)
  }, [])

  const calendarCells = useMemo(() => {
    const cells: React.ReactNode[] = []
    const todayDate = new Date()

    weeks.forEach((weekStart, weekIdx) => {
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const cellDate = new Date(weekStart)
        cellDate.setDate(cellDate.getDate() + dayOfWeek)

        if (cellDate > todayDate) continue

        const dateStr = cellDate.toISOString().slice(0, 10)
        const activity = dayMap.get(dateStr)
        const isToday = dateStr === today
        const color = activity ? getColor(activity.avgPnlPct) : '#ebedf0'

        cells.push(
          <rect
            key={dateStr}
            x={weekIdx * CELL_STEP + 30}
            y={dayOfWeek * CELL_STEP + 18}
            width={CELL_SIZE}
            height={CELL_SIZE}
            rx={2}
            fill={color}
            stroke={isToday ? '#3498db' : 'none'}
            strokeWidth={isToday ? 2 : 0}
            onMouseEnter={(e) => handleCellHover(dateStr, e)}
            onMouseLeave={handleCellLeave}
            style={{ cursor: activity ? 'pointer' : 'default' }}
          />
        )
      }
    })

    return cells
  }, [weeks, dayMap, today, handleCellHover, handleCellLeave])

  const toMoney = (value: number): string => {
    const safe = Number.isFinite(value) ? value : 0
    return safe.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const hasData = dataStats && dataStats.stockCount > 0
  const hasSessions = finishedSessions.length > 0

  return (
    <div className="dashboard-page">
      {!hasData && (
        <div className="dash-data-banner">
          <div className="dash-banner-text">
            正在从akshare拉取A股真实行情数据，首次初始化可能需要1-2分钟...
          </div>
          <button className="dash-banner-btn" onClick={() => void loadData()}>
            刷新状态
          </button>
        </div>
      )}

      {hasData && (
        <div className="dash-data-info">
          已入库 {dataStats.stockCount} 只股票 · 日线 {dataStats.dailyCount.toLocaleString()} 条 · 15分钟 {dataStats.m15Count.toLocaleString()} 条 · 5分钟 {dataStats.m5Count.toLocaleString()} 条
        </div>
      )}

      {hasSessions ? (
        <>
          <div className="dash-stats-row">
            <div className="dash-stat-card">
              <div className="dash-stat-num">{stats.totalSessions}</div>
              <div className="dash-stat-label">累计训练</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num">{(stats.winRate * 100).toFixed(1)}%</div>
              <div className="dash-stat-label">胜率</div>
            </div>
            <div className="dash-stat-card">
              <div className={`dash-stat-num ${stats.totalPnl >= 0 ? 'up' : 'down'}`}>
                {stats.totalPnl >= 0 ? '+' : ''}{toMoney(stats.totalPnl)}
              </div>
              <div className="dash-stat-label">累计盈亏</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num">{stats.avgPnlPct >= 0 ? '+' : ''}{stats.avgPnlPct.toFixed(2)}%</div>
              <div className="dash-stat-label">平均收益率</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num">{formatDuration(stats.totalDuration)}</div>
              <div className="dash-stat-label">总训练时长</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num up">{stats.bestStreak}</div>
              <div className="dash-stat-label">最长连胜</div>
            </div>
          </div>

          <div className="dash-main">
            <div className="dash-calendar-section">
              <div className="dash-section-header">
                <h3>训练日历</h3>
                <div className="dash-calendar-legend">
                  {PNL_LEVELS.map((level) => (
                    <span key={level.label} className="legend-item">
                      <span className="legend-color" style={{ backgroundColor: level.color }} />
                      <span className="legend-text">{level.label}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="dash-calendar-wrap">
                {loading ? (
                  <div className="dash-calendar-loading">加载中...</div>
                ) : (
                  <svg width={svgWidth} height={svgHeight} className="dash-calendar-svg">
                    {WEEKDAY_LABELS.map((label, i) => (
                      <text
                        key={label}
                        x={24}
                        y={i * CELL_STEP + 18 + CELL_SIZE / 2}
                        textAnchor="end"
                        dominantBaseline="middle"
                        fill="#999"
                        fontSize={10}
                      >
                        {i % 2 === 1 ? label : ''}
                      </text>
                    ))}
                    {monthMarkers.map((m) => (
                      <text
                        key={`${m.label}-${m.x}`}
                        x={m.x}
                        y={12}
                        fill="#999"
                        fontSize={10}
                      >
                        {m.label}
                      </text>
                    ))}
                    {calendarCells}
                  </svg>
                )}

                {hoveredDay && tooltipPos && (
                  <div
                    className="dash-tooltip"
                    style={{ left: tooltipPos.x, top: tooltipPos.y }}
                  >
                    <div className="dash-tooltip-date">{hoveredDay.date}</div>
                    <div className="dash-tooltip-row">
                      <span>训练 {hoveredDay.count} 次</span>
                      <span className={hoveredDay.avgPnlPct >= 0 ? 'up' : 'down'}>
                        平均 {hoveredDay.avgPnlPct >= 0 ? '+' : ''}{hoveredDay.avgPnlPct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="dash-tooltip-row">
                      <span>累计盈亏</span>
                      <span className={hoveredDay.totalPnl >= 0 ? 'up' : 'down'}>
                        {hoveredDay.totalPnl >= 0 ? '+' : ''}{toMoney(hoveredDay.totalPnl)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="dash-recent-section">
            <h4>最近训练</h4>
            <div className="dash-recent-list">
              {finishedSessions.slice(0, 5).map((s) => {
                const pnl = Number(s.realized_pnl || 0)
                const pnlPct = Number(s.realized_pnl_pct || 0)
                const isUp = pnl >= 0
                const startedAt = toMillis(s.started_at)
                const date = startedAt ? new Date(startedAt) : null
                const dateStr = date
                  ? `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
                  : '-'
                return (
                  <div key={s.id} className="dash-recent-item">
                    <div className="dash-recent-left">
                      <span className="dash-recent-name">{s.stock_name || s.stock_code}</span>
                      <span className="dash-recent-meta">{s.interval_type} · {dateStr}</span>
                    </div>
                    <div className={`dash-recent-pnl ${isUp ? 'up' : 'down'}`}>
                      {isUp ? '+' : ''}{pnlPct.toFixed(2)}%
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="dash-empty-guide">
          <div className="dash-empty-icon">📈</div>
          <h3>开始你的第一次训练</h3>
          <p>随机抽取真实A股历史行情，盲训你的盘感直觉。不看未来，只凭当下决策。</p>
          <button className="dash-start-btn" onClick={onStartTraining}>
            进入训练工作台 →
          </button>
        </div>
      )}
    </div>
  )
}

export default Dashboard
