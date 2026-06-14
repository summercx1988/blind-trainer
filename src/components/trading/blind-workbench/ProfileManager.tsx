import { useState, useEffect, useCallback, useMemo } from 'react'
import type { PlatformResult, ProfileDeleteData } from '../../../types/ipc'
import { getPlatformErrorMessage } from '../../../types/ipc'
import { UserIcon, ChartBarIcon, CalendarIcon, TrendUpIcon, WalletIcon, TargetIcon, ClockIcon, CloseIcon } from '../../common/Icons'
import '../BlindTrainingWorkbench.css'

export interface TrainingProfile {
  id: string
  name: string
  initial_capital: number
  current_capital: number
  total_sessions: number
  total_pnl: number
  total_wins: number
  total_losses: number
  total_duration_seconds: number
  total_holding_days?: number
  total_trades_count?: number
  total_winning_trades?: number
  avg_session_return_pct?: number
  best_session_return_pct?: number
  worst_session_return_pct?: number
  max_drawdown_pct?: number
}

interface DailyStat {
  day: string
  count: number
  avgPnlPct: number
  totalPnl: number
  avgWinRatePct: number
  avgDailyReturnPct: number
}

interface SessionTrendPoint {
  date: number
  pnlPct: number
}

interface ProfileStats {
  profile: Record<string, unknown>
  sessionTrend: SessionTrendPoint[]
  dailyStats: DailyStat[]
}

interface ProfileManagerProps {
  activeProfile: TrainingProfile | null
  onProfileChange: (profile: TrainingProfile) => void
  onClose?: () => void
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const CELL_SIZE = 12
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

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds < 60) return `${seconds || 0}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  return `${hours}小时${minutes % 60}分`
}

const toMoney = (value: number): string => {
  const safe = Number.isFinite(value) ? value : 0
  return safe.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const ProfileManager = ({ activeProfile, onProfileChange, onClose }: ProfileManagerProps) => {
  const [profileList, setProfileList] = useState<TrainingProfile[]>([])
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileCapital, setNewProfileCapital] = useState(100000)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [profileStats, setProfileStats] = useState<ProfileStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'calendar' | 'trend'>('overview')
  const [hoveredDay, setHoveredDay] = useState<DailyStat | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [actionMessage, setActionMessage] = useState('')

  const refreshProfileList = useCallback(async () => {
    try {
      const list = await window.electronAPI?.profile?.list()
      setProfileList((list || []) as unknown as TrainingProfile[])
    } catch { /* ignore */ }
  }, [])

  const loadProfileStats = useCallback(async () => {
    if (!activeProfile) return
    setStatsLoading(true)
    try {
      const stats = await window.electronAPI?.profile?.getStats(activeProfile.id)
      if (stats) {
        setProfileStats(stats as unknown as ProfileStats)
      }
    } catch (err) {
      console.error('[ProfileManager] load stats error:', err)
    } finally {
      setStatsLoading(false)
    }
  }, [activeProfile])

  useEffect(() => {
    let cancelled = false
    const loadProfileList = async () => {
      try {
        const list = await window.electronAPI?.profile?.list()
        if (!cancelled) {
          setProfileList((list || []) as unknown as TrainingProfile[])
        }
      } catch { /* ignore */ }
    }
    void loadProfileList()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    void loadProfileStats()
  }, [loadProfileStats])

  const handleCreate = async () => {
    setActionMessage('')
    if (!newProfileName.trim()) return
    const profile = await window.electronAPI?.profile?.create(newProfileName.trim(), newProfileCapital)
    if (profile) {
      onProfileChange(profile as unknown as TrainingProfile)
    }
    setNewProfileName('')
    setNewProfileCapital(100000)
    await refreshProfileList()
  }

  const handleLoad = async (profileId: string) => {
    setActionMessage('')
    const profile = await window.electronAPI?.profile?.load(profileId)
    if (profile) {
      onProfileChange(profile as unknown as TrainingProfile)
    }
    await refreshProfileList()
  }

  const handleDelete = async (profileId: string) => {
    setActionMessage('')
    try {
      const result = await window.electronAPI?.profile?.delete(profileId) as PlatformResult<ProfileDeleteData> | undefined
      if (!result?.success) {
        setActionMessage(getPlatformErrorMessage(result, '删除存档失败'))
        return
      }
      setActionMessage('存档已删除。')
      setConfirmDeleteId(null)
      await refreshProfileList()
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '删除存档失败')
    }
  }

  const dayMap = useMemo(() => {
    const map = new Map<string, DailyStat>()
    if (!profileStats?.dailyStats) return map
    for (const d of profileStats.dailyStats) {
      map.set(d.day, d)
    }
    return map
  }, [profileStats])

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

  const trendData = useMemo(() => {
    if (!profileStats?.sessionTrend || profileStats.sessionTrend.length === 0) return null
    const data = profileStats.sessionTrend
    const maxPnl = Math.max(...data.map((d) => d.pnlPct), 0)
    const minPnl = Math.min(...data.map((d) => d.pnlPct), 0)
    const range = maxPnl - minPnl || 1
    const width = Math.max(600, data.length * 12)
    const height = 200
    const padding = { top: 20, right: 40, bottom: 30, left: 50 }
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom

    const points = data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1 || 1)) * chartW
      const y = padding.top + chartH - ((d.pnlPct - minPnl) / range) * chartH
      return `${x},${y}`
    }).join(' ')

    const zeroY = padding.top + chartH - ((0 - minPnl) / range) * chartH

    return { width, height, padding, points, zeroY, maxPnl, minPnl, data }
  }, [profileStats])

  const winRateTrendData = useMemo(() => {
    const data = profileStats?.dailyStats || []
    if (data.length === 0) return null
    const width = Math.max(600, data.length * 16)
    const height = 160
    const padding = { top: 16, right: 24, bottom: 26, left: 42 }
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom

    const points = data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1 || 1)) * chartW
      const winRate = Math.max(0, Math.min(100, Number(d.avgWinRatePct || 0)))
      const y = padding.top + chartH - (winRate / 100) * chartH
      return `${x},${y}`
    }).join(' ')

    return { width, height, padding, points, data }
  }, [profileStats])

  const dailyReturnTrendData = useMemo(() => {
    const data = profileStats?.dailyStats || []
    if (data.length === 0) return null
    const width = Math.max(600, data.length * 16)
    const height = 160
    const padding = { top: 16, right: 24, bottom: 26, left: 42 }
    const chartW = width - padding.left - padding.right
    const chartH = height - padding.top - padding.bottom

    const maxReturn = Math.max(...data.map((d) => Number(d.avgDailyReturnPct || 0)), 0)
    const minReturn = Math.min(...data.map((d) => Number(d.avgDailyReturnPct || 0)), 0)
    const range = maxReturn - minReturn || 1
    const zeroY = padding.top + chartH - ((0 - minReturn) / range) * chartH

    const points = data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1 || 1)) * chartW
      const value = Number(d.avgDailyReturnPct || 0)
      const y = padding.top + chartH - ((value - minReturn) / range) * chartH
      return `${x},${y}`
    }).join(' ')

    return { width, height, padding, points, data, zeroY, maxReturn, minReturn }
  }, [profileStats])

  const winRate = activeProfile && activeProfile.total_sessions > 0
    ? (activeProfile.total_wins / activeProfile.total_sessions) * 100
    : 0

  const avgHoldingDays = activeProfile && activeProfile.total_sessions > 0 && activeProfile.total_holding_days
    ? activeProfile.total_holding_days / activeProfile.total_sessions
    : 0

  const tradeWinRate = activeProfile && activeProfile.total_trades_count && activeProfile.total_trades_count > 0
    ? ((activeProfile.total_winning_trades || 0) / activeProfile.total_trades_count) * 100
    : 0

  const totalReturnPct = activeProfile && activeProfile.initial_capital > 0
    ? ((activeProfile.current_capital - activeProfile.initial_capital) / activeProfile.initial_capital) * 100
    : 0

  return (
    <div className="pm-container">
      <div className="pm-header">
        <div className="pm-header-left">
          <h3><UserIcon size={18} className="pm-h-icon" /> 存档管理与收益复盘</h3>
          <span className="pm-header-sub">
            独立跟踪每个存档的训练表现、资金变化和赚钱效率
          </span>
        </div>
        {onClose && (
          <button className="pm-close-btn" onClick={onClose} aria-label="关闭"><CloseIcon size={16} /></button>
        )}
      </div>

      {activeProfile && (
        <div className="pm-tabs">
          <button
            className={`pm-tab ${activeTab === 'overview' ? 'pm-tab-active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            总览
          </button>
          <button
            className={`pm-tab ${activeTab === 'calendar' ? 'pm-tab-active' : ''}`}
            onClick={() => setActiveTab('calendar')}
          >
            训练日历
          </button>
          <button
            className={`pm-tab ${activeTab === 'trend' ? 'pm-tab-active' : ''}`}
            onClick={() => setActiveTab('trend')}
          >
            收益趋势
          </button>
        </div>
      )}

      {activeProfile && activeTab === 'overview' && (
        <>
          <div className="pm-active-card">
            <div className="pm-active-name"><UserIcon size={16} /> {activeProfile.name}</div>
            <div className="pm-active-stats">
              <span className="pm-stat">
                <span className="pm-stat-label">当前资金</span>
                <span className="pm-stat-value">{toMoney(activeProfile.current_capital)}元</span>
              </span>
              <span className="pm-stat">
                <span className="pm-stat-label">累计盈亏</span>
                <span className={`pm-stat-value ${activeProfile.total_pnl >= 0 ? 'up' : 'down'}`}>
                  {activeProfile.total_pnl >= 0 ? '+' : ''}{toMoney(activeProfile.total_pnl)}元
                </span>
              </span>
              <span className="pm-stat">
                <span className="pm-stat-label">总收益率</span>
                <span className={`pm-stat-value ${totalReturnPct >= 0 ? 'up' : 'down'}`}>
                  {totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(2)}%
                </span>
              </span>
              <span className="pm-stat">
                <span className="pm-stat-label">训练轮次</span>
                <span className="pm-stat-value">{activeProfile.total_sessions}轮</span>
              </span>
              <span className="pm-stat">
                <span className="pm-stat-label">胜率</span>
                <span className="pm-stat-value">{winRate.toFixed(1)}%</span>
              </span>
              <span className="pm-stat">
                <span className="pm-stat-label">训练时长</span>
                <span className="pm-stat-value">{formatDuration(activeProfile.total_duration_seconds)}</span>
              </span>
            </div>
          </div>

          <div className="pm-efficiency-card">
            <h4><ChartBarIcon size={16} className="pm-h-icon" /> 赚钱效率指标</h4>
            <div className="pm-efficiency-grid">
              <div className="pm-eff-item">
                <div className="pm-eff-label">平均持仓天数</div>
                <div className="pm-eff-value">{avgHoldingDays.toFixed(1)}天</div>
                <div className="pm-eff-hint">每次买入到卖出的平均持仓时间</div>
              </div>
              <div className="pm-eff-item">
                <div className="pm-eff-label">交易胜率</div>
                <div className="pm-eff-value">{tradeWinRate.toFixed(1)}%</div>
                <div className="pm-eff-hint">盈利交易次数 / 总交易次数</div>
              </div>
              <div className="pm-eff-item">
                <div className="pm-eff-label">最佳单轮收益</div>
                <div className={`pm-eff-value ${(activeProfile.best_session_return_pct || 0) >= 0 ? 'up' : 'down'}`}>
                  {Number.isFinite(activeProfile.best_session_return_pct)
                    ? `+${Number(activeProfile.best_session_return_pct).toFixed(2)}%`
                    : '-'}
                </div>
                <div className="pm-eff-hint">单轮训练最高收益率</div>
              </div>
              <div className="pm-eff-item">
                <div className="pm-eff-label">最差单轮收益</div>
                <div className={`pm-eff-value ${(activeProfile.worst_session_return_pct || 0) >= 0 ? 'up' : 'down'}`}>
                  {Number.isFinite(activeProfile.worst_session_return_pct)
                    ? `${Number(activeProfile.worst_session_return_pct).toFixed(2)}%`
                    : '-'}
                </div>
                <div className="pm-eff-hint">单轮训练最低收益率</div>
              </div>
              <div className="pm-eff-item">
                <div className="pm-eff-label">平均轮收益率</div>
                <div className={`pm-eff-value ${(activeProfile.avg_session_return_pct || 0) >= 0 ? 'up' : 'down'}`}>
                  {Number.isFinite(activeProfile.avg_session_return_pct)
                    ? `${Number(activeProfile.avg_session_return_pct) >= 0 ? '+' : ''}${Number(activeProfile.avg_session_return_pct).toFixed(2)}%`
                    : '-'}
                </div>
                <div className="pm-eff-hint">每轮训练的平均收益率</div>
              </div>
              <div className="pm-eff-item">
                <div className="pm-eff-label">最大回撤</div>
                <div className="pm-eff-value down">
                  {Number.isFinite(activeProfile.max_drawdown_pct)
                    ? `${Number(activeProfile.max_drawdown_pct).toFixed(2)}%`
                    : '-'}
                </div>
                <div className="pm-eff-hint">历史最大资金回撤幅度</div>
              </div>
            </div>
          </div>
        </>
      )}

      {activeProfile && activeTab === 'calendar' && (
        <div className="pm-calendar-section">
          <div className="pm-section-header">
            <h4><CalendarIcon size={16} className="pm-h-icon" /> 训练日历</h4>
            <div className="pm-calendar-legend">
              {PNL_LEVELS.map((level) => (
                <span key={level.label} className="legend-item">
                  <span className="legend-color" style={{ backgroundColor: level.color }} />
                  <span className="legend-text">{level.label}</span>
                </span>
              ))}
            </div>
          </div>

          {statsLoading ? (
            <div className="pm-calendar-loading">加载中...</div>
          ) : (
            <div className="pm-calendar-wrap">
              <svg width={svgWidth} height={svgHeight} className="pm-calendar-svg">
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

              {hoveredDay && tooltipPos && (
                <div
                  className="pm-tooltip"
                  style={{ left: tooltipPos.x, top: tooltipPos.y }}
                >
                  <div className="pm-tooltip-date">{hoveredDay.day}</div>
                  <div className="pm-tooltip-row">
                    <span>训练 {hoveredDay.count} 次</span>
                    <span className={hoveredDay.avgPnlPct >= 0 ? 'up' : 'down'}>
                      平均 {hoveredDay.avgPnlPct >= 0 ? '+' : ''}{hoveredDay.avgPnlPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="pm-tooltip-row">
                    <span>累计盈亏</span>
                    <span className={hoveredDay.totalPnl >= 0 ? 'up' : 'down'}>
                      {hoveredDay.totalPnl >= 0 ? '+' : ''}{toMoney(hoveredDay.totalPnl)}元
                    </span>
                  </div>
                  <div className="pm-tooltip-row">
                    <span>日胜率</span>
                    <span>{hoveredDay.avgWinRatePct.toFixed(1)}%</span>
                  </div>
                  <div className="pm-tooltip-row">
                    <span>日均收益率</span>
                    <span className={hoveredDay.avgDailyReturnPct >= 0 ? 'up' : 'down'}>
                      {hoveredDay.avgDailyReturnPct >= 0 ? '+' : ''}{hoveredDay.avgDailyReturnPct.toFixed(3)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeProfile && activeTab === 'trend' && (
        <div className="pm-trend-section">
          <h4><TrendUpIcon size={16} className="pm-h-icon" /> 收益趋势</h4>
          {statsLoading ? (
            <div className="pm-calendar-loading">加载中...</div>
          ) : trendData ? (
            <div className="pm-trend-chart-wrap">
              <svg width={trendData.width} height={trendData.height} className="pm-trend-svg">
                <line
                  x1={trendData.padding.left}
                  y1={trendData.zeroY}
                  x2={trendData.width - trendData.padding.right}
                  y2={trendData.zeroY}
                  stroke="#ccc"
                  strokeDasharray="4,2"
                />
                <text x={trendData.padding.left - 10} y={trendData.zeroY} textAnchor="end" dominantBaseline="middle" fill="#999" fontSize={10}>0%</text>
                <text x={trendData.padding.left - 10} y={trendData.padding.top} textAnchor="end" dominantBaseline="middle" fill="#27ae60" fontSize={10}>{trendData.maxPnl.toFixed(1)}%</text>
                <text x={trendData.padding.left - 10} y={trendData.height - trendData.padding.bottom} textAnchor="end" dominantBaseline="middle" fill="#e74c3c" fontSize={10}>{trendData.minPnl.toFixed(1)}%</text>
                <polyline
                  fill="none"
                  stroke="#3498db"
                  strokeWidth={2}
                  points={trendData.points}
                />
                {trendData.data.map((d, i) => {
                  const x = trendData.padding.left + (i / (trendData.data.length - 1 || 1)) * (trendData.width - trendData.padding.left - trendData.padding.right)
                  const y = trendData.padding.top + (trendData.height - trendData.padding.top - trendData.padding.bottom) - ((d.pnlPct - trendData.minPnl) / (trendData.maxPnl - trendData.minPnl || 1)) * (trendData.height - trendData.padding.top - trendData.padding.bottom)
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={3}
                      fill={d.pnlPct >= 0 ? '#27ae60' : '#e74c3c'}
                    />
                  )
                })}
              </svg>

              <div style={{ marginTop: 14, color: '#7f8c8d', fontSize: '0.8rem' }}>
                指标变化：胜率（按天聚合）与日均收益率（按天聚合）
              </div>

              {winRateTrendData && (
                <svg width={winRateTrendData.width} height={winRateTrendData.height} className="pm-trend-svg" style={{ marginTop: 10 }}>
                  <line
                    x1={winRateTrendData.padding.left}
                    y1={winRateTrendData.padding.top}
                    x2={winRateTrendData.padding.left}
                    y2={winRateTrendData.height - winRateTrendData.padding.bottom}
                    stroke="#d9dee7"
                  />
                  <line
                    x1={winRateTrendData.padding.left}
                    y1={winRateTrendData.height - winRateTrendData.padding.bottom}
                    x2={winRateTrendData.width - winRateTrendData.padding.right}
                    y2={winRateTrendData.height - winRateTrendData.padding.bottom}
                    stroke="#d9dee7"
                  />
                  <text x={winRateTrendData.padding.left - 6} y={winRateTrendData.padding.top} textAnchor="end" dominantBaseline="middle" fill="#8a95a8" fontSize={10}>100%</text>
                  <text x={winRateTrendData.padding.left - 6} y={winRateTrendData.height - winRateTrendData.padding.bottom} textAnchor="end" dominantBaseline="middle" fill="#8a95a8" fontSize={10}>0%</text>
                  <polyline
                    fill="none"
                    stroke="#2d7ef7"
                    strokeWidth={2}
                    points={winRateTrendData.points}
                  />
                  {winRateTrendData.data.map((d, i) => {
                    const x = winRateTrendData.padding.left + (i / (winRateTrendData.data.length - 1 || 1)) * (winRateTrendData.width - winRateTrendData.padding.left - winRateTrendData.padding.right)
                    const y = winRateTrendData.padding.top + (winRateTrendData.height - winRateTrendData.padding.top - winRateTrendData.padding.bottom) - (Math.max(0, Math.min(100, d.avgWinRatePct || 0)) / 100) * (winRateTrendData.height - winRateTrendData.padding.top - winRateTrendData.padding.bottom)
                    return <circle key={`wr-${d.day}`} cx={x} cy={y} r={2.5} fill="#2d7ef7" />
                  })}
                </svg>
              )}

              {dailyReturnTrendData && (
                <svg width={dailyReturnTrendData.width} height={dailyReturnTrendData.height} className="pm-trend-svg" style={{ marginTop: 8 }}>
                  <line
                    x1={dailyReturnTrendData.padding.left}
                    y1={dailyReturnTrendData.zeroY}
                    x2={dailyReturnTrendData.width - dailyReturnTrendData.padding.right}
                    y2={dailyReturnTrendData.zeroY}
                    stroke="#d9dee7"
                    strokeDasharray="4,2"
                  />
                  <text x={dailyReturnTrendData.padding.left - 6} y={dailyReturnTrendData.padding.top} textAnchor="end" dominantBaseline="middle" fill="#27ae60" fontSize={10}>{dailyReturnTrendData.maxReturn.toFixed(2)}%</text>
                  <text x={dailyReturnTrendData.padding.left - 6} y={dailyReturnTrendData.height - dailyReturnTrendData.padding.bottom} textAnchor="end" dominantBaseline="middle" fill="#e74c3c" fontSize={10}>{dailyReturnTrendData.minReturn.toFixed(2)}%</text>
                  <polyline
                    fill="none"
                    stroke="#16a085"
                    strokeWidth={2}
                    points={dailyReturnTrendData.points}
                  />
                  {dailyReturnTrendData.data.map((d, i) => {
                    const x = dailyReturnTrendData.padding.left + (i / (dailyReturnTrendData.data.length - 1 || 1)) * (dailyReturnTrendData.width - dailyReturnTrendData.padding.left - dailyReturnTrendData.padding.right)
                    const y = dailyReturnTrendData.padding.top + (dailyReturnTrendData.height - dailyReturnTrendData.padding.top - dailyReturnTrendData.padding.bottom) - ((Number(d.avgDailyReturnPct || 0) - dailyReturnTrendData.minReturn) / (dailyReturnTrendData.maxReturn - dailyReturnTrendData.minReturn || 1)) * (dailyReturnTrendData.height - dailyReturnTrendData.padding.top - dailyReturnTrendData.padding.bottom)
                    return <circle key={`dr-${d.day}`} cx={x} cy={y} r={2.5} fill="#16a085" />
                  })}
                </svg>
              )}
            </div>
          ) : (
            <div className="pm-empty">暂无足够数据展示趋势图，完成更多训练后查看</div>
          )}
        </div>
      )}

      <div className="pm-section">
        <h4>新建存档</h4>
        {actionMessage && (
          <div className="pm-action-message">{actionMessage}</div>
        )}
        <div className="pm-create-row">
          <input
            className="pm-input"
            placeholder="存档名称（如：趋势跟踪策略）"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }}
          />
          <input
            className="pm-input pm-input-sm"
            type="number"
            placeholder="初始资金"
            value={newProfileCapital}
            onChange={(e) => setNewProfileCapital(Number(e.target.value))}
          />
          <button
            className="pm-btn pm-btn-primary"
            onClick={() => void handleCreate()}
            disabled={!newProfileName.trim() || newProfileCapital <= 0}
          >
            创建
          </button>
        </div>
      </div>

      <div className="pm-section">
        <h4>所有存档 ({profileList.length})</h4>
        <div className="pm-list">
          {profileList.length === 0 && (
            <div className="pm-empty">暂无存档</div>
          )}
          {profileList.map((p) => (
            <div
              key={p.id}
              className={`pm-item ${p.id === activeProfile?.id ? 'pm-item-active' : ''}`}
            >
              <div className="pm-item-main">
                <div className="pm-item-top">
                  <span className="pm-item-name">
                    {p.name}
                    {p.id === activeProfile?.id && <span className="pm-item-badge">当前</span>}
                  </span>
                  <span className={`pm-item-pnl ${p.total_pnl >= 0 ? 'up' : 'down'}`}>
                    {p.total_pnl >= 0 ? '+' : ''}{toMoney(p.total_pnl)}元
                  </span>
                </div>
                <div className="pm-item-detail">
                  <span className="pm-item-detail-item"><WalletIcon size={12} /> {toMoney(p.current_capital)}元</span>
                  <span className="pm-item-detail-sep">·</span>
                  <span className="pm-item-detail-item"><TargetIcon size={12} /> {p.total_sessions}轮</span>
                  <span className="pm-item-detail-sep">·</span>
                  <span className="pm-item-detail-item">胜率 {p.total_sessions > 0 ? ((p.total_wins / p.total_sessions) * 100).toFixed(1) : '0'}%</span>
                  <span className="pm-item-detail-sep">·</span>
                  <span className="pm-item-detail-item"><ClockIcon size={12} /> {formatDuration(p.total_duration_seconds)}</span>
                </div>
              </div>
              <div className="pm-item-actions">
                {p.id !== activeProfile?.id && (
                  <button className="pm-btn pm-btn-load" onClick={() => void handleLoad(p.id)}>
                    加载
                  </button>
                )}
                {p.id !== activeProfile?.id && confirmDeleteId !== p.id && (
                  <button className="pm-btn pm-btn-delete" onClick={() => setConfirmDeleteId(p.id)}>
                    删除
                  </button>
                )}
                {p.id !== activeProfile?.id && confirmDeleteId === p.id && (
                  <div className="pm-confirm-delete">
                    <span>确认删除？</span>
                    <button className="pm-btn pm-btn-delete" onClick={() => void handleDelete(p.id)}>确认</button>
                    <button className="pm-btn" onClick={() => setConfirmDeleteId(null)}>取消</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ProfileManager
