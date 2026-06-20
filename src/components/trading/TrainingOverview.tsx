import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlatformStore } from '../../stores/platformStore'
import type { SessionActionRecord, SessionReview, SessionSummary } from '../../types/ipc'
import ReplayChart from './history/ReplayChart'
import type { ReplayAction } from './history/ReplayChart'
import type { TrainingProfile } from './blind-workbench/ProfileManager'
import { CloseIcon } from '../common/Icons'
import { SkeletonStatCard, SkeletonAccountCard } from '../common/Skeleton'
import './TrainingOverview.css'
import '../../types/global.d'

interface TrainingOverviewProps {
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
const CELL_SIZE = 15
const CELL_GAP = 4
const CELL_STEP = CELL_SIZE + CELL_GAP

const PNL_LEVELS = [
  { max: -2, color: 'var(--color-pnl-loss-3)', label: '亏损 ≥2%' },
  { max: -0.5, color: 'var(--color-pnl-loss-2)', label: '亏损 0.5%-2%' },
  { max: 0, color: 'var(--color-pnl-loss-1)', label: '亏损 0-0.5%' },
  { max: 0.5, color: 'var(--color-pnl-gain-1)', label: '盈利 0-0.5%' },
  { max: 2, color: 'var(--color-pnl-gain-2)', label: '盈利 0.5%-2%' },
  { max: Infinity, color: 'var(--color-pnl-gain-3)', label: '盈利 ≥2%' }
]

const toMillis = (value: number | null | undefined): number => {
  if (!value || !Number.isFinite(value)) return 0
  return value < 1_000_000_000_000 ? value * 1000 : value
}

const formatDuration = (ms: number): string => {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes}分钟`
  const hours = Math.floor(minutes / 60)
  const remainMin = minutes % 60
  return remainMin > 0 ? `${hours}小时${remainMin}分` : `${hours}小时`
}

const toMoney = (value: number): string => {
  const safe = Number.isFinite(value) ? value : 0
  return safe.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

const toDateKey = (date: Date): string => {
  const local = new Date(date)
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset())
  return local.toISOString().slice(0, 10)
}

const fromDateKey = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year || 1970, (month || 1) - 1, day || 1)
}

const toSessionCapitalPnl = (session: SessionSummary): number => {
  const initial = Number(session.initial_capital || 0)
  if (typeof session.final_capital === 'number' && Number.isFinite(session.final_capital)) {
    return Number(session.final_capital) - initial
  }
  return Number(session.realized_pnl || 0)
}

const toSessionPnlPct = (session: SessionSummary): number => {
  const initial = Number(session.initial_capital || 0)
  if (initial <= 0) return 0
  if (typeof session.final_capital === 'number' && Number.isFinite(session.final_capital)) {
    return (toSessionCapitalPnl(session) / initial) * 100
  }
  return Number(session.realized_pnl_pct || 0)
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

const getColor = (avgPnlPct: number): string => {
  for (const level of PNL_LEVELS) {
    if (avgPnlPct < level.max) return level.color
  }
  return 'var(--bg-subtle)'
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
    weeks.push(toDateKey(current))
    current.setDate(current.getDate() + 7)
  }
  return weeks.reverse()
}

const TrainingOverview = ({ onStartTraining }: TrainingOverviewProps) => {
  const activeProfile = usePlatformStore((s) => s.activeProfile)
  const profileList = usePlatformStore((s) => s.profileList)
  const sessionList = usePlatformStore((s) => s.sessionList)
  const dataStats = usePlatformStore((s) => s.dataStats)
  const fetchActiveProfile = usePlatformStore((s) => s.fetchActiveProfile)
  const fetchProfileList = usePlatformStore((s) => s.fetchProfileList)
  const switchProfile = usePlatformStore((s) => s.switchProfile)
  const createProfile = usePlatformStore((s) => s.createProfile)
  const deleteProfile = usePlatformStore((s) => s.deleteProfile)
  const invalidateSessionList = usePlatformStore((s) => s.invalidateSessionList)
  const invalidateDataStats = usePlatformStore((s) => s.invalidateDataStats)

  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCapital] = useState(100000)
  const [showAccountManager, setShowAccountManager] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Session detail state (from TrainingHistory)
  const [periodFilter, setPeriodFilter] = useState<'all' | '1d'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '30d' | '90d'>('30d')
  const [keyword, setKeyword] = useState('')
  const [sortMode, setSortMode] = useState<'time' | 'pnl'>('time')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string>('')
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailActions, setDetailActions] = useState<SessionActionRecord[]>([])
  const [detailReview, setDetailReview] = useState<SessionReview | null>(null)
  const [detailKlineData, setDetailKlineData] = useState<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]>([])
  const [showReplayChart, setShowReplayChart] = useState(false)

  // Calendar tooltip state
  const [hoveredDay, setHoveredDay] = useState<DayActivity | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([
        fetchActiveProfile(),
        fetchProfileList(),
        invalidateSessionList(),
        invalidateDataStats()
      ])
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }, [fetchActiveProfile, fetchProfileList, invalidateSessionList, invalidateDataStats])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Filter sessions by active profile
  const profileSessions = useMemo(() => {
    if (!activeProfile) return []
    return sessionList.filter((s) => {
      const sProfileId = (s as unknown as Record<string, unknown>).profile_id
      if (sProfileId && sProfileId !== activeProfile.id) return false
      if (!sProfileId && activeProfile.id !== 'default') return false
      return true
    })
  }, [sessionList, activeProfile])

  const finishedSessions = useMemo(
    () => profileSessions.filter((s) => s.finished_at != null && s.finished_at > 0),
    [profileSessions]
  )

  const accountPnl = activeProfile
    ? Number(activeProfile.current_capital || 0) - Number(activeProfile.initial_capital || 0)
    : 0

  // Apply filters + sort
  const filteredSessions = useMemo(() => {
    const now = Date.now()
    const keywordLower = keyword.trim().toLowerCase()

    const filtered = profileSessions.filter((session) => {
      if (periodFilter !== 'all' && session.interval_type !== periodFilter) return false
      if (dateFilter !== 'all') {
        const startedAt = toMillis(session.started_at)
        if (!startedAt) return false
        const diff = now - startedAt
        const maxAge = dateFilter === '7d' ? 7 * 24 * 60 * 60 * 1000
          : dateFilter === '30d' ? 30 * 24 * 60 * 60 * 1000
          : 90 * 24 * 60 * 60 * 1000
        if (diff > maxAge) return false
      }
      if (calendarSelectedDate) {
        const startedAt = toMillis(session.started_at)
        if (!startedAt) return false
        const sessionDate = toDateKey(new Date(startedAt))
        if (sessionDate !== calendarSelectedDate) return false
      }
      if (keywordLower) {
        const text = `${session.stock_code} ${session.stock_name || ''}`.toLowerCase()
        if (!text.includes(keywordLower)) return false
      }
      return true
    })

    return filtered.sort((a, b) => {
      if (sortMode === 'pnl') {
        const aPct = toSessionPnlPct(a)
        const bPct = toSessionPnlPct(b)
        return sortOrder === 'desc' ? bPct - aPct : aPct - bPct
      }
      const aTime = toMillis(a.started_at) || 0
      const bTime = toMillis(b.started_at) || 0
      return sortOrder === 'desc' ? bTime - aTime : aTime - bTime
    })
  }, [profileSessions, periodFilter, dateFilter, keyword, sortOrder, sortMode, calendarSelectedDate])

  // Top 3 best/worst from finished sessions
  const topBest = useMemo(() => {
    return [...finishedSessions]
      .sort((a, b) => toSessionPnlPct(b) - toSessionPnlPct(a))
      .slice(0, 3)
  }, [finishedSessions])

  const topWorst = useMemo(() => {
    return [...finishedSessions]
      .sort((a, b) => toSessionPnlPct(a) - toSessionPnlPct(b))
      .slice(0, 3)
  }, [finishedSessions])

  // Calendar data
  const dayMap = useMemo(() => {
    const map = new Map<string, DayActivity>()
    for (const s of finishedSessions) {
      const startedAt = toMillis(s.started_at)
      if (!startedAt) continue
      const date = toDateKey(new Date(startedAt))
      const existing = map.get(date) || { date, count: 0, totalPnl: 0, avgPnlPct: 0, winRate: 0 }
      existing.count += 1
      const pnl = toSessionCapitalPnl(s)
      existing.totalPnl += pnl
      const pnlPct = toSessionPnlPct(s)
      existing.avgPnlPct = (existing.avgPnlPct * (existing.count - 1) + pnlPct) / existing.count
      map.set(date, existing)
    }
    return map
  }, [finishedSessions])

  // Stats (from Dashboard)
  const stats = useMemo(() => {
    const totalSessions = finishedSessions.length
    if (totalSessions === 0) {
      return { totalSessions, totalPnl: 0, avgPnlPct: 0, winRate: 0, totalDuration: 0, bestStreak: 0 }
    }
    let wins = 0
    let totalDuration = 0
    let currentStreak = 0
    let bestStreak = 0
    let prevWin: boolean | null = null

    const sorted = [...finishedSessions].sort((a, b) => a.started_at - b.started_at)
    for (const s of sorted) {
      const pnl = toSessionCapitalPnl(s)
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
      totalPnl: accountPnl,
      avgPnlPct: totalSessions > 0
        ? sorted.reduce((sum, s) => sum + toSessionPnlPct(s), 0) / totalSessions
        : 0,
      winRate: wins / totalSessions,
      totalDuration,
      bestStreak
    }
  }, [finishedSessions, accountPnl])

  // Calendar rendering
  const weeks = useMemo(() => getWeeks(), [])
  const totalWeeks = weeks.length
  const svgWidth = totalWeeks * CELL_STEP + 30
  const svgHeight = 7 * CELL_STEP + 20

  const monthMarkers = useMemo(() => {
    const markers: { label: string; x: number }[] = []
    let prevMonth = -1
    weeks.forEach((weekStart, i) => {
      const month = fromDateKey(weekStart).getMonth()
      if (month !== prevMonth) {
        markers.push({ label: MONTH_LABELS[month], x: i * CELL_STEP + 30 })
        prevMonth = month
      }
    })
    return markers
  }, [weeks])

  const today = toDateKey(new Date())

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
        const cellDate = fromDateKey(weekStart)
        cellDate.setDate(cellDate.getDate() + dayOfWeek)
        if (cellDate > todayDate) continue
        const dateStr = toDateKey(cellDate)
        const activity = dayMap.get(dateStr)
        const isToday = dateStr === today
        const color = activity ? getColor(activity.avgPnlPct) : 'var(--bg-subtle)'
        const isSelected = calendarSelectedDate === dateStr
        cells.push(
          <rect
            key={dateStr}
            x={weekIdx * CELL_STEP + 30}
            y={dayOfWeek * CELL_STEP + 18}
            width={CELL_SIZE}
            height={CELL_SIZE}
            rx={3}
            fill={color}
            stroke={isSelected ? 'var(--text-primary)' : isToday ? 'var(--text-primary)' : activity ? 'var(--border)' : 'var(--border-light)'}
            strokeWidth={isSelected || isToday ? 2.5 : 1}
            onMouseEnter={(e) => handleCellHover(dateStr, e)}
            onMouseLeave={handleCellLeave}
            onClick={() => activity && setCalendarSelectedDate(isSelected ? '' : dateStr)}
            style={{ cursor: activity ? 'pointer' : 'default' }}
          />
        )
      }
    })
    return cells
  }, [weeks, dayMap, today, calendarSelectedDate, handleCellHover, handleCellLeave])

  // Session detail handlers
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
    } finally {
      setDetailLoading(false)
    }
  }, [selectedSessionId])

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

  // Account handlers
  const handleCreateAccount = useCallback(async () => {
    const name = newName.trim()
    if (!name) return
    const ok = await createProfile(name, newCapital)
    if (ok) {
      setNewName('')
      setShowCreateForm(false)
    }
  }, [newName, newCapital, createProfile])

  const handleSwitchAccount = useCallback(async (profileId: string) => {
    await switchProfile(profileId)
  }, [switchProfile])

  const handleDeleteAccount = useCallback(async (profileId: string) => {
    setDeleteError('')
    const ok = await deleteProfile(profileId)
    if (!ok) {
      setDeleteError('无法删除正在使用的账户，请先切换到其他账户')
    }
  }, [deleteProfile])

  // Profile return %
  const profileReturnPct = activeProfile
    ? activeProfile.initial_capital > 0
      ? (accountPnl / activeProfile.initial_capital) * 100
      : 0
    : 0

  const hasData = dataStats && dataStats.stockCount > 0

  if (loading) {
    return (
      <div className="overview-page">
        <div className="overview-skeleton-grid">
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
        </div>
        <div style={{ marginTop: 24 }}>
          <SkeletonAccountCard />
        </div>
      </div>
    )
  }

  return (
    <div className="overview-page">
      {/* === Top Bar: data status + start training === */}
      <div className="ov-topbar">
        <div className="ov-topbar-left">
          {!hasData ? (
            <div className="ov-data-banner">
              <span>正在拉取A股行情数据，首次初始化需1-2分钟</span>
              <button className="ov-data-banner-btn" onClick={() => void loadData()}>刷新</button>
            </div>
          ) : (
            <div className="ov-data-info">
              已入库 {dataStats.stockCount} 只 · 日线 {dataStats.dailyCount.toLocaleString()} 条
            </div>
          )}
        </div>
        {activeProfile && (
          <button className="ov-btn ov-btn-primary" onClick={onStartTraining}>
            开始训练
          </button>
        )}
      </div>

      {/* === Create Account (no profile yet) === */}
      {!activeProfile && (
        <div className="ov-create-card">
          <div className="ov-create-copy">
            <h2>创建训练账户</h2>
            <p>每个账户拥有独立的资金曲线和训练记录。创建后初始资金不可修改，但可以随时创建新账户尝试不同策略。</p>
          </div>
          {showCreateForm ? (
            <div className="ov-create-form">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="账户名称（如：保守型、激进型）"
                autoFocus
              />
              <span className="ov-create-capital">初始资金: ¥{toMoney(newCapital)}</span>
              <div className="ov-create-actions">
                <button className="ov-btn ov-btn-primary" onClick={() => void handleCreateAccount()} disabled={!newName.trim()}>
                  创建账户
                </button>
                <button className="ov-btn ov-btn-ghost" onClick={() => setShowCreateForm(false)}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button className="ov-btn ov-btn-primary ov-btn-lg" onClick={() => setShowCreateForm(true)} aria-label="创建训练账户">
              创建第一个账户
            </button>
          )}
        </div>
      )}

      {/* === Account Card (always visible when profile exists) === */}
      {activeProfile && (
        <div className="ov-account-card">
          <div className="ov-account-left">
            <div className="ov-account-identity">
              <span className="ov-account-name">{activeProfile.name}</span>
              {profileList.length > 1 && (
                <select
                  className="ov-account-switch"
                  value={activeProfile.id}
                  onChange={(e) => void handleSwitchAccount(e.target.value)}
                >
                  {profileList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              <button className="ov-btn ov-btn-ghost ov-btn-sm" onClick={() => setShowAccountManager(!showAccountManager)}>
                {showAccountManager ? '收起' : '管理'}
              </button>
            </div>
            <div className="ov-account-funds">
              <div className="ov-fund-item">
                <span className="ov-fund-label">初始</span>
                <span className="ov-fund-value">¥{toMoney(activeProfile.initial_capital)}</span>
              </div>
              <div className="ov-fund-arrow">→</div>
              <div className="ov-fund-item">
                <span className="ov-fund-label">当前</span>
                <span className={`ov-fund-value ${activeProfile.current_capital >= activeProfile.initial_capital ? 'up' : 'down'}`}>
                  ¥{toMoney(activeProfile.current_capital)}
                </span>
              </div>
              <div className="ov-fund-divider" />
              <div className="ov-fund-item ov-fund-highlight">
                <span className="ov-fund-label">总收益率</span>
                <span className={`ov-fund-value ov-fund-lg ${profileReturnPct >= 0 ? 'up' : 'down'}`}>
                  {profileReturnPct >= 0 ? '+' : ''}{profileReturnPct.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
          <div className="ov-account-right">
            <div className="ov-qs-chip">
              <span className="ov-qs-val">{activeProfile.total_sessions}</span>
              <span className="ov-qs-lbl">训练</span>
            </div>
            <div className="ov-qs-chip">
              <span className="ov-qs-val">{activeProfile.total_sessions > 0 ? ((activeProfile.total_wins / activeProfile.total_sessions) * 100).toFixed(1) : '0.0'}%</span>
              <span className="ov-qs-lbl">胜率</span>
            </div>
            <div className="ov-qs-chip">
              <span className={`ov-qs-val ${accountPnl >= 0 ? 'up' : 'down'}`}>
                {accountPnl >= 0 ? '+' : ''}¥{toMoney(accountPnl)}
              </span>
              <span className="ov-qs-lbl">盈亏</span>
            </div>
          </div>
          {showAccountManager && (
            <div className="ov-account-manager">
              {deleteError && (
                <div className="ov-manager-error">{deleteError}</div>
              )}
              {profileList.map((p: TrainingProfile) => (
                <div key={p.id} className={`ov-manager-item ${p.id === activeProfile.id ? 'active' : ''}`}>
                  <div className="ov-manager-info">
                    <strong>{p.name}</strong>
                    <span>¥{toMoney(p.current_capital)} · {p.total_sessions}次</span>
                  </div>
                  {p.id !== activeProfile.id && (
                    <div className="ov-manager-actions">
                      <button className="ov-btn ov-btn-ghost ov-btn-sm" onClick={() => void handleSwitchAccount(p.id)}>切换</button>
                      <button className="ov-btn ov-btn-danger ov-btn-sm" onClick={() => void handleDeleteAccount(p.id)}>删除</button>
                    </div>
                  )}
                </div>
              ))}
              <div className="ov-manager-create">
                {showCreateForm ? (
                  <div className="ov-create-form-inline">
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="账户名称"
                      autoFocus
                    />
                    <button className="ov-btn ov-btn-primary ov-btn-sm" onClick={() => void handleCreateAccount()} disabled={!newName.trim()}>
                      创建
                    </button>
                    <button className="ov-btn ov-btn-ghost ov-btn-sm" onClick={() => { setShowCreateForm(false); setNewName('') }}>
                      取消
                    </button>
                  </div>
                ) : (
                  <button className="ov-btn ov-btn-ghost ov-btn-sm" onClick={() => setShowCreateForm(true)}>
                    新建账户
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* === Dashboard: Stats + Calendar (always visible when profile exists) === */}
      {activeProfile && (
        <div className="ov-dashboard-grid">
          <div className="ov-stats-panel">
            <div className="ov-panel-title">训练成果</div>
            {finishedSessions.length === 0 ? (
              <div className="ov-stats-empty">暂无训练数据，点击右上角「开始训练」发起第一次盲训</div>
            ) : (
              <>
                <div className="ov-stats-grid">
                  <div className="ov-stat-card">
                    <div className="ov-stat-num">{stats.totalSessions}</div>
                    <div className="ov-stat-label">累计训练</div>
                  </div>
                  <div className="ov-stat-card">
                    <div className="ov-stat-num">{(stats.winRate * 100).toFixed(1)}%</div>
                    <div className="ov-stat-label">胜率</div>
                  </div>
                  <div className="ov-stat-card">
                    <div className={`ov-stat-num ${stats.totalPnl >= 0 ? 'up' : 'down'}`}>
                      {stats.totalPnl >= 0 ? '+' : ''}¥{toMoney(stats.totalPnl)}
                    </div>
                    <div className="ov-stat-label">累计盈亏</div>
                  </div>
                  <div className="ov-stat-card">
                    <div className={`ov-stat-num ${stats.avgPnlPct >= 0 ? 'up' : 'down'}`}>
                      {stats.avgPnlPct >= 0 ? '+' : ''}{stats.avgPnlPct.toFixed(2)}%
                    </div>
                    <div className="ov-stat-label">平均收益率</div>
                  </div>
                  <div className="ov-stat-card">
                    <div className="ov-stat-num">{formatDuration(stats.totalDuration)}</div>
                    <div className="ov-stat-label">总训练时长</div>
                  </div>
                  <div className="ov-stat-card">
                    <div className="ov-stat-num up">{stats.bestStreak}</div>
                    <div className="ov-stat-label">最长连胜</div>
                  </div>
                </div>

                {(topBest.length > 0 || topWorst.length > 0) && (
                  <div className="ov-highlights">
                    {topBest.length > 0 && (
                      <div className="ov-highlight-col">
                        <div className="ov-highlight-title up">最佳交易</div>
                        {topBest.map((s) => {
                          const pnlPct = toSessionPnlPct(s)
                          return (
                            <div key={s.id} className="ov-highlight-row" onClick={() => void handleOpenSession(s.id)}>
                              <span className="ov-highlight-name">{s.stock_name || s.stock_code}</span>
                              <span className="ov-highlight-pnl up">{formatSignedPercent(pnlPct)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {topWorst.length > 0 && (
                      <div className="ov-highlight-col">
                        <div className="ov-highlight-title down">最差交易</div>
                        {topWorst.map((s) => {
                          const pnlPct = toSessionPnlPct(s)
                          return (
                            <div key={s.id} className="ov-highlight-row" onClick={() => void handleOpenSession(s.id)}>
                              <span className="ov-highlight-name">{s.stock_name || s.stock_code}</span>
                              <span className="ov-highlight-pnl down">{formatSignedPercent(pnlPct)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="ov-calendar-panel">
            <div className="ov-panel-title">
              训练日历
              <div className="ov-calendar-legend">
                {PNL_LEVELS.map((level) => (
                  <span key={level.label} className="legend-item">
                    <span className="legend-color" style={{ backgroundColor: level.color }} />
                    <span className="legend-text">{level.label}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="ov-calendar-wrap">
              <svg width={svgWidth} height={svgHeight} className="ov-calendar-svg">
                {WEEKDAY_LABELS.map((label, i) => (
                  <text key={label} x={24} y={i * CELL_STEP + 18 + CELL_SIZE / 2} textAnchor="end" dominantBaseline="middle" fill="var(--text-tertiary)" fontSize={10}>
                    {i % 2 === 1 ? label : ''}
                  </text>
                ))}
                {monthMarkers.map((m) => (
                  <text key={`${m.label}-${m.x}`} x={m.x} y={12} fill="var(--text-tertiary)" fontSize={10}>{m.label}</text>
                ))}
                {calendarCells}
              </svg>
              {hoveredDay && tooltipPos && (
                <div className="ov-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
                  <div className="ov-tooltip-date">{hoveredDay.date}</div>
                  <div className="ov-tooltip-row">
                    <span>训练 {hoveredDay.count} 次</span>
                    <span className={hoveredDay.avgPnlPct >= 0 ? 'up' : 'down'}>
                      {hoveredDay.avgPnlPct >= 0 ? '+' : ''}{hoveredDay.avgPnlPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="ov-tooltip-row">
                    <span>累计盈亏</span>
                    <span className={hoveredDay.totalPnl >= 0 ? 'up' : 'down'}>
                      {hoveredDay.totalPnl >= 0 ? '+' : ''}¥{toMoney(hoveredDay.totalPnl)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === Session History (always visible when profile exists) === */}
      {activeProfile && (
        <div className="ov-sessions-section">
          <div className="ov-sessions-header">
            <div className="ov-panel-title">
              训练记录
              {filteredSessions.length > 0 && <span className="ov-count-badge">{filteredSessions.length}</span>}
            </div>
            <div className="ov-sessions-controls">
              <div className="ov-filters-inline">
                <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value as typeof periodFilter)}>
                  <option value="all">全部周期</option>
                  <option value="1d">日线</option>
                </select>
                <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}>
                  <option value="all">全部时间</option>
                  <option value="7d">近7天</option>
                  <option value="30d">近30天</option>
                  <option value="90d">近90天</option>
                </select>
                <input className="ov-search-input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索股票..." />
                <button
                  className="ov-btn ov-btn-ghost ov-btn-sm"
                  onClick={() => {
                    if (sortMode === 'time') {
                      if (sortOrder === 'desc') setSortOrder('asc')
                      else { setSortMode('pnl'); setSortOrder('desc') }
                    } else {
                      if (sortOrder === 'desc') setSortOrder('asc')
                      else { setSortMode('time'); setSortOrder('desc') }
                    }
                  }}
                  aria-label="切换排序方式"
                >
                  {sortMode === 'time' ? '时间' : '收益率'}{sortOrder === 'desc' ? '↓' : '↑'}
                </button>
                {calendarSelectedDate && (
                  <button
                    className="ov-btn ov-btn-ghost ov-btn-sm ov-calendar-clear"
                    onClick={() => setCalendarSelectedDate('')}
                  >
                    清除日期筛选
                  </button>
                )}
              </div>
            </div>
          </div>

          {filteredSessions.length === 0 ? (
            <div className="ov-sessions-empty">暂无训练记录</div>
          ) : (
            <div className="ov-history-content">
              <section className="ov-session-list-panel">
                <div className="ov-session-list">
                  {filteredSessions.map((session) => {
                    const pnlPct = toSessionPnlPct(session)
                    const winRate = toSessionWinRate(session)
                    const tradeCount = Number(session.sell_count ?? session.total_trades ?? 0)
                    return (
                      <button
                        key={session.id}
                        className={`ov-session-item ${selectedSessionId === session.id ? 'active' : ''}`}
                        onClick={() => void handleOpenSession(session.id)}
                      >
                        <div className="ov-session-main">
                          <strong>{session.stock_name || session.stock_code}</strong>
                          <span>{session.stock_code} · {session.interval_type}</span>
                        </div>
                        <div className="ov-session-meta">
                          <span>{formatDateTime(session.started_at)}</span>
                          <span>{tradeCount}笔</span>
                          <span>胜率{(winRate * 100).toFixed(0)}%</span>
                        </div>
                        <div className={`ov-session-pnl ${pnlPct >= 0 ? 'up' : 'down'}`}>
                          {formatSignedPercent(pnlPct)}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="ov-detail-panel">
                {!selectedSession ? (
                  <div className="ov-detail-empty">点击左侧记录查看复盘分析</div>
                ) : detailLoading ? (
                  <div className="ov-detail-empty">加载中...</div>
                ) : (
                  <div className="ov-detail-wrap">
                    <div className="ov-detail-head">
                      <div className="ov-detail-title">
                        <h3>{selectedSession.stock_name || selectedSession.stock_code}</h3>
                        <button className="ov-detail-close" onClick={() => { setSelectedSessionId(''); setDetailActions([]); setDetailReview(null); setDetailKlineData([]); setShowReplayChart(false) }} aria-label="关闭详情"><CloseIcon size={14} /></button>
                      </div>
                      <p>{selectedSession.stock_code} · {selectedSession.interval_type} · {formatDateTime(selectedSession.started_at)}</p>
                    </div>
                    <div className="ov-detail-metrics">
                      <div className="ov-metric">
                        <span>总收益率</span>
                        <strong className={toSessionPnlPct(selectedSession) >= 0 ? 'up' : 'down'}>
                          {formatSignedPercent(toSessionPnlPct(selectedSession))}
                        </strong>
                      </div>
                      <div className="ov-metric">
                        <span>已实现盈亏</span>
                        <strong className={Number(detailReview?.realized_pnl || selectedSession.realized_pnl || 0) >= 0 ? 'up' : 'down'}>
                          {formatSignedNumber(Number(detailReview?.realized_pnl || selectedSession.realized_pnl || 0), 0)}
                        </strong>
                      </div>
                      <div className="ov-metric">
                        <span>交易胜率</span>
                        <strong>{(toSessionWinRate(selectedSession) * 100).toFixed(1)}%</strong>
                      </div>
                      <div className="ov-metric">
                        <span>最大回撤</span>
                        <strong>{Number(detailReview?.max_drawdown_pct || 0).toFixed(2)}%</strong>
                      </div>
                      <div className="ov-metric">
                        <span>动作</span>
                        <strong>B{Number(detailReview?.buy_count || 0)} / S{Number(detailReview?.sell_count || 0)} / H{Number(detailReview?.hold_count || 0)}</strong>
                      </div>
                      <div className="ov-metric">
                        <span>持仓Bar</span>
                        <strong>{Number(detailReview?.avg_holding_bars || 0).toFixed(1)}</strong>
                      </div>
                      <div className="ov-metric">
                        <span>持仓天数</span>
                        <strong>{Number(detailReview?.avg_holding_days || 0).toFixed(2)}天</strong>
                      </div>
                      <div className="ov-metric">
                        <span>日均收益</span>
                        <strong className={Number(detailReview?.avg_daily_return_pct || 0) >= 0 ? 'up' : 'down'}>
                          {Number(detailReview?.avg_daily_return_pct || 0) >= 0 ? '+' : ''}{Number(detailReview?.avg_daily_return_pct || 0).toFixed(3)}%
                        </strong>
                      </div>
                    </div>
                    <div className="ov-detail-replay">
                      <div className="ov-detail-replay-head">
                        <h4>K线回放</h4>
                        <button className="ov-btn ov-btn-ghost ov-btn-sm" onClick={() => void loadKlineForSession(selectedSession)}>
                          {showReplayChart ? '刷新' : '加载K线'}
                        </button>
                      </div>
                      {showReplayChart && detailKlineData.length > 0 ? (
                        <div className="ov-replay-chart">
                          <ReplayChart data={detailKlineData} actions={replayActions} />
                        </div>
                      ) : showReplayChart ? (
                        <div className="ov-detail-empty ov-detail-sm">K线数据不足</div>
                      ) : (
                        <div className="ov-detail-empty ov-detail-sm">点击「加载K线」查看买卖点回放</div>
                      )}
                    </div>
                    <div className="ov-detail-actions">
                      <h4>动作明细（{detailActions.length}）</h4>
                      {detailActions.length === 0 ? (
                        <div className="ov-detail-empty ov-detail-sm">暂无动作记录</div>
                      ) : (
                        <div className="ov-action-table-wrap">
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
          )}
        </div>
      )}
    </div>
  )
}

export default TrainingOverview
