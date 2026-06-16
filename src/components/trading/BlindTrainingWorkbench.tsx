import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SaveSessionResult, SessionFinishData, SessionReview, PlatformResult } from '../../types/ipc'
import { getPlatformErrorMessage } from '../../types/ipc'
import { usePlatformStore } from '../../stores/platformStore'
import type {
  ContinuousStats,
  ExecutionMode,
  LocalActionLog,
  ManualActionType,
  PeriodType,
  SessionStatus,
  TrainingSample,
  TradingState
} from './blind/types'
import { normalizeBar, normalizeSample } from './blind/sampleFactory'
import {
  DEFAULT_TRADING_CONFIG,
  type ExecutedTrade,
  computeEquity,
  computeUnrealizedPnl,
  createInitialTradingState,
  evaluateManualAction,
  settleAtSessionEnd
} from './blind/tradingEngine'
import ContinuousBar from './blind-workbench/ContinuousBar'
import SessionToolbar, { DEFAULT_WORKBENCH_SETTINGS } from './blind-workbench/SessionToolbar'
import AccountOverview from './blind-workbench/AccountOverview'
import ActionSection from './blind-workbench/ActionSection'
import ActionLog from './blind-workbench/ActionLog'
import ResultSummary from './blind-workbench/ResultSummary'
import InfoHover from '../common/InfoHover'
import { UserIcon, ChartBarIcon } from '../common/Icons'
import './BlindTrainingWorkbench.css'
import '../../types/global.d'

const INITIAL_CAPITAL = DEFAULT_TRADING_CONFIG.initialCapital

interface SampleExtensionResult {
  loaded: boolean
  currentIndex: number
  newLength: number
  sample?: TrainingSample
}

interface BlindTrainingWorkbenchProps {
  onNavigate?: (module: string) => void
  autoStart?: boolean
  registerNavigationGuard?: (guard: (() => Promise<void>) | null) => void
}

const BlindTrainingWorkbench = ({ onNavigate, autoStart, registerNavigationGuard }: BlindTrainingWorkbenchProps) => {
  const [period, setPeriod] = useState<PeriodType>('1d')
  const [regime, setRegime] = useState<string>('mixed')
  const [samples, setSamples] = useState<TrainingSample[]>([])
  const [sampleLoading, setSampleLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [sessionId, setSessionId] = useState('')
  const [activeSample, setActiveSample] = useState<TrainingSample | null>(null)
  const [currentBarIndex, setCurrentBarIndex] = useState(0)
  const [account, setAccount] = useState<TradingState>(() => createInitialTradingState())
  const [actions, setActions] = useState<LocalActionLog[]>([])
  const [sessionReview, setSessionReview] = useState<SessionReview | null>(null)
  const [actionPending, setActionPending] = useState(false)

  const [continuousMode, setContinuousMode] = useState(false)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('next_open')
  const [continuousStats, setContinuousStats] = useState<ContinuousStats>({
    sessionsCompleted: 0,
    totalPnl: 0,
    wins: 0,
    losses: 0,
    currentStreak: 0,
    streakType: 'none',
    bestStreak: 0
  })

  const [dataReady, setDataReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [visibleCount, setVisibleCount] = useState(120)
  const [candidateCount, setCandidateCount] = useState(500)
  const [samplePoolBars, setSamplePoolBars] = useState(520)
  const [, setPrefsLoaded] = useState(false)
  const prefsLoadedRef = useRef(false)
  const samplePoolBarsRef = useRef(520)

  // 加载持久化的训练配置
  useEffect(() => {
    let cancelled = false
    const loadPrefs = async () => {
      try {
        const prefs = (await window.electronAPI?.db?.getPreference('workbench_settings_v1')) as Record<string, unknown> | null
        if (cancelled || !prefs) return
        if (typeof prefs.candidateCount === 'number' && [200, 500, 1000, 2000].includes(prefs.candidateCount)) {
          setCandidateCount(prefs.candidateCount)
        }
        if (typeof prefs.samplePoolBars === 'number' && [520, 1040, 1560].includes(prefs.samplePoolBars)) {
          setSamplePoolBars(prefs.samplePoolBars)
          samplePoolBarsRef.current = prefs.samplePoolBars
        }
        if (typeof prefs.minPrice === 'number' && prefs.minPrice >= 0) {
          setMinPrice(prefs.minPrice)
        }
        if (typeof prefs.visibleCount === 'number' && prefs.visibleCount >= 20 && prefs.visibleCount <= 200) {
          setVisibleCount(prefs.visibleCount)
        }
      } catch (error) {
        console.error('加载训练配置失败:', error)
      } finally {
        if (!cancelled) {
          setPrefsLoaded(true)
          prefsLoadedRef.current = true
        }
      }
    }
    void loadPrefs()
    return () => { cancelled = true }
  }, [])
  const [minPrice, setMinPrice] = useState(0)
  const [extendingSample, setExtendingSample] = useState(false)
  const [settingsFeedback, setSettingsFeedback] = useState('')

  const activeProfile = usePlatformStore((s) => s.activeProfile)
  const fetchActiveProfile = usePlatformStore((s) => s.fetchActiveProfile)
  const [sessionInitialCapital, setSessionInitialCapital] = useState(INITIAL_CAPITAL)
  const [sessionStartedAt, setSessionStartedAt] = useState(0)

  const parseSamples = useCallback((raw: unknown, targetPeriod: PeriodType) => {
    return (Array.isArray(raw) ? raw : [])
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item, index) => normalizeSample(item, index, targetPeriod))
      .filter((item) => item.klines.length > item.warmupBars + 10)
  }, [])

  const requestRandomSamples = useCallback(async (
    targetRegime: string,
    targetPeriod: PeriodType,
    barsPerSymbol: number = samplePoolBarsRef.current
  ) => {
    const raw = await window.electronAPI?.data?.getRandomSamples(targetRegime, targetPeriod, candidateCount, {
      maxBarsPerSymbol: barsPerSymbol,
      excludeRecent: 20,
      profileId: activeProfile?.id,
      candidateCount,
      minPrice
    })
    return parseSamples(raw, targetPeriod)
  }, [activeProfile?.id, candidateCount, minPrice, parseSamples])

  const loadSamples = useCallback(async () => {
    setSampleLoading(true)
    setNotice('')
    if (!window.electronAPI?.data?.getRandomSamples) {
      setSamples([])
      setDataReady(false)
      setNotice('数据桥接未加载成功，请重启应用后重试。')
      setSampleLoading(false)
      return
    }
    try {
      const normalized = await requestRandomSamples(regime, period)

      if (normalized.length > 0) {
        setSamples(normalized)
        setDataReady(true)
        setNotice('')
      } else {
        setSamples([])
        setDataReady(false)
        setNotice('暂无真实行情数据。请先在"数据管理"中同步行情数据，或等待数据初始化完成。')
      }
    } catch (error) {
      console.error('加载盲训样本失败:', error)
      setSamples([])
      setDataReady(false)
      setNotice('加载样本失败，请检查数据是否已同步。')
    } finally {
      setSampleLoading(false)
    }
  }, [period, regime, requestRandomSamples])

  useEffect(() => {
    if (!initialized && prefsLoadedRef.current) {
      void loadSamples()
      setInitialized(true)
    }
  }, [initialized, loadSamples])

  // 持久化热生效设置（visibleCount 等）
  useEffect(() => {
    if (!prefsLoadedRef.current) return
    void window.electronAPI?.db?.savePreference('workbench_settings_v1', { visibleCount })
  }, [visibleCount])

  useEffect(() => {
    void fetchActiveProfile()
  }, [fetchActiveProfile])

  const currentBar = useMemo(() => {
    if (!activeSample) return null
    return activeSample.klines[currentBarIndex] || null
  }, [activeSample, currentBarIndex])

  const sessionStatusRef = useRef(sessionStatus)
  const sessionIdRef = useRef(sessionId)
  const accountRef = useRef(account)
  const currentBarIndexRef = useRef(currentBarIndex)
  const currentBarRef = useRef(currentBar)
  const sessionInitialCapitalRef = useRef(sessionInitialCapital)
  const activeSampleRef = useRef(activeSample)
  const activeProfileRef = useRef(activeProfile)
  const sessionStartedAtRef = useRef(sessionStartedAt)

  sessionStatusRef.current = sessionStatus
  sessionIdRef.current = sessionId
  accountRef.current = account
  currentBarIndexRef.current = currentBarIndex
  currentBarRef.current = currentBar
  sessionInitialCapitalRef.current = sessionInitialCapital
  activeSampleRef.current = activeSample
  activeProfileRef.current = activeProfile
  sessionStartedAtRef.current = sessionStartedAt

  const refreshProfileCaches = useCallback(async () => {
    const store = usePlatformStore.getState()
    await Promise.allSettled([
      fetchActiveProfile(),
      store.fetchProfileList(),
      store.invalidateSessionList()
    ])
  }, [fetchActiveProfile])

  const getCurrentSessionFinalCapital = useCallback(() => {
    const curStatus = sessionStatusRef.current
    const curBar = currentBarRef.current
    if (!curBar) return null

    if (curStatus === 'finished') {
      return computeEquity(accountRef.current, curBar.close)
    }

    if (curStatus === 'running') {
      const settlement = settleAtSessionEnd(accountRef.current, curBar.close, DEFAULT_TRADING_CONFIG)
      return computeEquity(settlement.nextState, curBar.close)
    }

    return null
  }, [])

  const persistFinishedSessionSnapshot = useCallback(async () => {
    const curSessionId = sessionIdRef.current
    const curSample = activeSampleRef.current
    const curBar = currentBarRef.current
    const curProfile = activeProfileRef.current
    const curStartedAt = sessionStartedAtRef.current
    const curInitCap = sessionInitialCapitalRef.current

    if (!curSessionId || !curSample || !curBar) return

    const curAccount = accountRef.current
    const finalCapital = computeEquity(curAccount, curBar.close)

    try {
      await window.electronAPI?.db?.finishSession(curSessionId, finalCapital, curAccount.realizedPnl, {
        profileId: curProfile?.id,
        sampleId: curSample.id,
        stockCode: curSample.code,
        stockName: curSample.name,
        intervalType: curSample.period,
        startedAt: curStartedAt || Date.now(),
        initialCapital: curInitCap
      })
    } catch (error) {
      window.electronAPI?.log?.('error', '[WT] persistFinishedSessionSnapshot error', String(error))
    }

    await refreshProfileCaches()
  }, [refreshProfileCaches])

  const visibleBars = useMemo(() => {
    if (!activeSample) return []
    const start = Math.max(0, currentBarIndex - visibleCount)
    return activeSample.klines.slice(start, currentBarIndex + 1)
  }, [activeSample, currentBarIndex, visibleCount])

  const visibleStartIndex = useMemo(() => {
    return Math.max(0, currentBarIndex - visibleCount)
  }, [currentBarIndex, visibleCount])

  const visibleTradeMarkers = useMemo(() => {
    return actions
      .filter((action) => action.actionType === 'buy' || action.actionType === 'sell')
      .filter((action) => action.barIndex >= visibleStartIndex && action.barIndex <= currentBarIndex)
      .map((action) => ({
        barIndex: action.barIndex - visibleStartIndex,
        actionType: action.actionType as 'buy' | 'sell',
        price: action.price
      }))
  }, [actions, currentBarIndex, visibleStartIndex])

  const accountEquity = useMemo(() => {
    const markPrice = currentBar?.close || account.avgPrice || 0
    return computeEquity(account, markPrice)
  }, [account, currentBar])

  const unrealizedPnl = useMemo(() => {
    if (!currentBar) return 0
    return computeUnrealizedPnl(account, currentBar.close)
  }, [account, currentBar])

  const totalPnl = accountEquity - sessionInitialCapital
  const totalPnlPct = sessionInitialCapital > 0 ? (totalPnl / sessionInitialCapital) * 100 : 0

  useEffect(() => {
    if (sessionStatus === 'finished') {
      window.electronAPI?.log?.('debug', '[WT] Render finished', {
        accountEquity, sessionInitialCapital, totalPnl, totalPnlPct,
        accountCash: account.cash, accountShares: account.shares,
        currentBarClose: currentBar?.close, sessionId
      })
    }
  }, [sessionStatus, accountEquity, sessionInitialCapital, totalPnl, totalPnlPct, account, currentBar, sessionId])

  const appendActionLog = useCallback((input: Omit<LocalActionLog, 'id'>) => {
    const row: LocalActionLog = { ...input, id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }
    setActions((prev) => [...prev, row])
  }, [])

  const persistTradeAction = useCallback(async (trade: ExecutedTrade, barIndex: number, source = 'manual') => {
    if (!sessionId) return

    await window.electronAPI?.db?.saveTradeAction({
      sessionId,
      barIndex,
      actionType: trade.actionType,
      price: trade.price,
      shares: trade.shares || undefined,
      amount: trade.amount || undefined,
      commission: trade.commission || undefined,
      realizedPnl: trade.realizedPnl || undefined,
      source
    })

    if (trade.actionType === 'buy' || trade.actionType === 'sell') {
      await window.electronAPI?.db?.saveLabel({
        sessionId,
        barIndex,
        labelType: trade.actionType,
        source: 'manual',
        status: 'accepted',
        confidence: 0.7
      })
    }
  }, [sessionId])

  const finishingRef = useRef(false)

  const finishSession = useCallback(async (
    reason: 'manual' | 'skip' | 'auto_end' | 'latest_end' = 'manual',
    accountSnapshot?: TradingState
  ) => {
    if (finishingRef.current) return
    const curStatus = sessionStatusRef.current
    const curSample = activeSampleRef.current
    const curBar = currentBarRef.current
    if (curStatus !== 'running' || !curSample || !curBar) return

    finishingRef.current = true

    const curAccount = accountSnapshot || accountRef.current
    const curBarIdx = currentBarIndexRef.current
    const curSessionId = sessionIdRef.current
    const curInitCap = sessionInitialCapitalRef.current
    const curProfile = activeProfileRef.current
    const curStartedAt = sessionStartedAtRef.current

    window.electronAPI?.log?.('info', '[WT] finishSession enter', {
      reason, curStatus, sessionId: curSessionId,
      accountCash: curAccount.cash, accountShares: curAccount.shares,
      accountRealizedPnl: curAccount.realizedPnl,
      barClose: curBar.close, initCap: curInitCap
    })

    const settlement = settleAtSessionEnd(curAccount, curBar.close, DEFAULT_TRADING_CONFIG)

    if (settlement.autoCloseTrade) {
      appendActionLog({
        barIndex: curBarIdx,
        actionType: 'finish',
        price: settlement.autoCloseTrade.price,
        shares: settlement.autoCloseTrade.shares,
        amount: settlement.autoCloseTrade.amount,
        realizedPnl: settlement.autoCloseTrade.realizedPnl
      })
      await persistTradeAction(settlement.autoCloseTrade, curBarIdx, 'auto_close')
    }

    accountRef.current = settlement.nextState
    sessionStatusRef.current = 'finished'
    setAccount(settlement.nextState)
    setSessionStatus('finished')

    const finalCapital = computeEquity(settlement.nextState, curBar.close)
    const sessionPnl = finalCapital - curInitCap
    window.electronAPI?.log?.('info', '[WT] finishSession computed', {
      finalCapital, sessionPnl, initCap: curInitCap,
      nextCash: settlement.nextState.cash, nextShares: settlement.nextState.shares,
      nextRealizedPnl: settlement.nextState.realizedPnl
    })

    try {
      const result = await window.electronAPI?.db?.finishSession(curSessionId, finalCapital, settlement.nextState.realizedPnl, {
        profileId: curProfile?.id,
        sampleId: curSample.id,
        stockCode: curSample.code,
        stockName: curSample.name,
        intervalType: curSample.period,
        startedAt: curStartedAt || Date.now(),
        initialCapital: curInitCap
      }) as PlatformResult<SessionFinishData> | undefined
      if (!result?.success) {
        window.electronAPI?.log?.('error', '[WT] finishSession IPC failed', getPlatformErrorMessage(result, '训练会话保存失败'))
      } else {
        window.electronAPI?.log?.('info', '[WT] finishSession IPC success')
      }
    } catch (err) {
      window.electronAPI?.log?.('error', '[WT] finishSession IPC error', String(err))
    }

    const review = await window.electronAPI?.db?.getSessionReview(curSessionId)
    setSessionReview(review || null)

    await refreshProfileCaches()

    if (continuousMode) {
      const isWin = sessionPnl >= 0
      setContinuousStats((prev) => {
        const nextStreakType = isWin ? 'win' : 'loss'
        const nextStreak = prev.streakType === nextStreakType ? prev.currentStreak + 1 : 1
        return {
          sessionsCompleted: prev.sessionsCompleted + 1,
          totalPnl: prev.totalPnl + sessionPnl,
          wins: prev.wins + (isWin ? 1 : 0),
          losses: prev.losses + (isWin ? 0 : 1),
          currentStreak: nextStreak,
          streakType: nextStreakType,
          bestStreak: Math.max(prev.bestStreak, nextStreak)
        }
      })
    }

    finishingRef.current = false

    if (reason === 'skip') setNotice('样本已跳过并结算。')
    if (reason === 'auto_end') setNotice('样本已走到末尾，系统自动结算。')
    if (reason === 'latest_end') setNotice('当前样本已经推进到数据库中的最新 K 线，系统已自动结算。建议换一个更久远的样本继续训练。')
  }, [
    continuousMode, appendActionLog, persistTradeAction, refreshProfileCaches
  ])

  const flushSessionBeforeLeave = useCallback(async () => {
    const curStatus = sessionStatusRef.current
    if (curStatus === 'running') {
      await finishSession('manual')
      return
    }
    if (curStatus === 'finished') {
      await persistFinishedSessionSnapshot()
    }
  }, [finishSession, persistFinishedSessionSnapshot])

  const extendActiveSample = useCallback(async (): Promise<SampleExtensionResult> => {
    if (!activeSample || extendingSample || !window.electronAPI?.data?.getCandles) {
      return { loaded: false, currentIndex: currentBarIndex, newLength: activeSample?.klines.length || 0 }
    }

    setExtendingSample(true)
    try {
      const currentTimestamp = activeSample.klines[currentBarIndex]?.timestamp || 0
      const anchorTimestamp = activeSample.klines[Math.min(activeSample.warmupBars, activeSample.klines.length - 1)]?.timestamp || currentTimestamp

      const rawCandles = await window.electronAPI.data.getCandles(activeSample.code, activeSample.period as PeriodType)
      const allBars = (Array.isArray(rawCandles) ? rawCandles : [])
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => normalizeBar(item))
        .filter((item) => item.timestamp > 0 && item.close > 0)
        .sort((left, right) => left.timestamp - right.timestamp)
        .filter((item, index, array) => index === 0 || item.timestamp !== array[index - 1].timestamp)

      if (allBars.length === 0) {
        return { loaded: false, currentIndex: currentBarIndex, newLength: activeSample.klines.length }
      }

      const anchorIndex = allBars.findIndex((bar) => bar.timestamp === anchorTimestamp)
      if (anchorIndex < 0) {
        return { loaded: false, currentIndex: currentBarIndex, newLength: activeSample.klines.length }
      }

      const windowStart = Math.max(0, anchorIndex - activeSample.warmupBars)
      const nextKlines = allBars.slice(windowStart)
      const nextWarmupBars = anchorIndex - windowStart
      const nextCurrentIndex = nextKlines.findIndex((bar) => bar.timestamp === currentTimestamp)

      if (nextKlines.length <= activeSample.klines.length) {
        return {
          loaded: false,
          currentIndex: nextCurrentIndex >= 0 ? nextCurrentIndex : currentBarIndex,
          newLength: nextKlines.length
        }
      }

      const nextSample: TrainingSample = {
        ...activeSample,
        warmupBars: nextWarmupBars,
        forwardBars: Math.max(0, nextKlines.length - nextWarmupBars),
        totalAvailableBars: allBars.length,
        klines: nextKlines
      }
      setActiveSample(nextSample)
      setNotice(`已为 ${activeSample.name} 补载更多 K 线，当前样本长度 ${activeSample.klines.length} → ${nextKlines.length}。`)

      return {
        loaded: true,
        currentIndex: nextCurrentIndex >= 0 ? nextCurrentIndex : currentBarIndex,
        newLength: nextKlines.length,
        sample: nextSample
      }
    } catch (error) {
      console.error('补载样本失败:', error)
      setNotice('补载更多 K 线失败，将按当前样本结束。')
      return { loaded: false, currentIndex: currentBarIndex, newLength: activeSample.klines.length }
    } finally {
      setExtendingSample(false)
    }
  }, [activeSample, currentBarIndex, extendingSample])

  const stepForward = useCallback(async (nextAccount?: TradingState) => {
    if (!activeSample) return
    const nextIndex = currentBarIndex + 1
    if (nextIndex >= activeSample.klines.length) {
      const extension = await extendActiveSample()
      if (extension.loaded && extension.currentIndex + 1 < extension.newLength) {
        const targetIndex = extension.currentIndex + 1
        const targetSample = extension.sample || activeSampleRef.current
        currentBarIndexRef.current = targetIndex
        currentBarRef.current = targetSample?.klines[targetIndex] || currentBarRef.current
        setCurrentBarIndex(targetIndex)
        return
      }
      const reachedLatest = Boolean(activeSample.totalAvailableBars)
        && activeSample.klines.length >= Number(activeSample.totalAvailableBars || 0)
      await finishSession(reachedLatest ? 'latest_end' : 'auto_end', nextAccount || account)
      return
    }
    currentBarIndexRef.current = nextIndex
    currentBarRef.current = activeSample.klines[nextIndex] || currentBarRef.current
    setCurrentBarIndex(nextIndex)
  }, [activeSample, currentBarIndex, extendActiveSample, finishSession, account])

  const handleStepForward = useCallback(async () => {
    await stepForward()
  }, [stepForward])

  const handleStartSession = useCallback(async (sample: TrainingSample, capitalOverride?: number) => {
    const safeWarmup = Math.max(10, Math.min(sample.warmupBars, sample.klines.length - 2))
    const overrideCapital = typeof capitalOverride === 'number' && capitalOverride > 0 ? capitalOverride : null
    let capital = overrideCapital ?? activeProfileRef.current?.current_capital ?? INITIAL_CAPITAL
    const startedAt = Date.now()
    const currentProfile = activeProfileRef.current
    let resolvedSessionId = `session_local_${Date.now()}`
    if (overrideCapital == null) {
      try {
        const freshProfile = await window.electronAPI?.profile?.getActive()
        if (freshProfile) {
          const freshCapital = Number((freshProfile as Record<string, unknown>).current_capital || 0)
          if (freshCapital > 0) capital = freshCapital
        }
      } catch { /* use existing */ }
    }
    try {
      const saved = await window.electronAPI?.db?.saveSession({
        sampleId: sample.id,
        stockCode: sample.code,
        stockName: sample.name,
        intervalType: sample.period,
        startedAt,
        initialCapital: capital,
        profileId: currentProfile?.id
      })
      if (!saved || ((saved as unknown as Record<string, unknown>)?.error)) {
        window.electronAPI?.log?.('error', '[WT] saveSession failed', String((saved as unknown as Record<string, unknown>)?.error || 'unknown'))
        setNotice(`⚠ 保存会话失败: ${(saved as unknown as Record<string, unknown>)?.error || '未知错误'}`)
      }
      resolvedSessionId = (saved as SaveSessionResult | undefined)?.id || `session_local_${Date.now()}`
    } catch (err) {
      window.electronAPI?.log?.('error', '[WT] saveSession exception', String(err))
      resolvedSessionId = `session_local_${Date.now()}`
      setNotice(`⚠ 保存会话异常: ${String(err)}`)
    }

    const nextAccount = createInitialTradingState(capital)
    sessionIdRef.current = resolvedSessionId
    activeSampleRef.current = sample
    sessionStatusRef.current = 'running'
    currentBarIndexRef.current = safeWarmup
    currentBarRef.current = sample.klines[safeWarmup] || null
    accountRef.current = nextAccount
    sessionInitialCapitalRef.current = capital
    sessionStartedAtRef.current = startedAt
    setSessionId(resolvedSessionId)
    setActiveSample(sample)
    setSessionStatus('running')
    setCurrentBarIndex(safeWarmup)
    setAccount(nextAccount)
    setSessionInitialCapital(capital)
    setSessionStartedAt(startedAt)
    setActions([])
    setSessionReview(null)
    setActionError('')
    setNotice('')
    finishingRef.current = false
  }, [])

  const startRandomSession = useCallback(async () => {
    if (samples.length === 0) {
      setNotice('样本池为空，正在加载...')
      return
    }
    const idx = Math.floor(Math.random() * samples.length)
    await handleStartSession(samples[idx])
  }, [samples, handleStartSession])

  useEffect(() => {
    if (autoStart && dataReady && samples.length > 0 && sessionStatus === 'idle') {
      void startRandomSession()
    }
  }, [autoStart, dataReady, samples, sessionStatus, startRandomSession])

  useEffect(() => {
    registerNavigationGuard?.(flushSessionBeforeLeave)
    return () => registerNavigationGuard?.(null)
  }, [registerNavigationGuard, flushSessionBeforeLeave])

  const runAction = useCallback(async (actionType: ManualActionType) => {
    if (sessionStatus !== 'running' || !activeSample || !currentBar) return
    if (actionPending) return

    setActionPending(true)
    setActionError('')

    try {
      const shouldUseNextOpen = executionMode === 'next_open' && (actionType === 'buy' || actionType === 'sell')
      let executionPrice = currentBar.close
      let executionBarIndex = currentBarIndex
      let targetSample = activeSample

      if (shouldUseNextOpen) {
        let targetIndex = currentBarIndex + 1

        if (targetIndex >= targetSample.klines.length) {
          const extension = await extendActiveSample()
          if (extension.loaded && extension.sample) {
            targetSample = extension.sample
            targetIndex = extension.currentIndex + 1
          } else {
            const reachedLatest = Boolean(activeSample.totalAvailableBars)
              && activeSample.klines.length >= Number(activeSample.totalAvailableBars || 0)
            const message = reachedLatest
              ? '当前已经到达数据库中的最新 K 线，次根开盘模式下没有新的开盘价可供成交。建议换一个更久远的样本，或切换到盘尾收盘模式。'
              : '当前样本末尾暂无下一根 K 线开盘价，请先补载更多数据后再执行。'
            setActionError(message)
            if (reachedLatest) {
              setNotice(message)
            }
            return
          }
        }

        const nextBar = targetSample.klines[targetIndex]
        if (!nextBar || !Number.isFinite(nextBar.open) || nextBar.open <= 0) {
          setActionError('下一根 K 线开盘价异常，无法执行交易。')
          return
        }

        executionPrice = nextBar.open
        executionBarIndex = targetIndex
      }

      const execution = evaluateManualAction(account, actionType, executionPrice, DEFAULT_TRADING_CONFIG)
      if (!execution.ok) {
        setActionError(execution.error)
        return
      }

      accountRef.current = execution.nextState
      setAccount(execution.nextState)
      appendActionLog({
        barIndex: executionBarIndex,
        actionType,
        price: execution.trade.price,
        shares: execution.trade.shares,
        amount: execution.trade.amount,
        realizedPnl: execution.trade.realizedPnl
      })

      // 先推进 UI（K线必须前进），再异步持久化
      if (shouldUseNextOpen) {
        if (targetSample !== activeSampleRef.current) {
          activeSampleRef.current = targetSample
          setActiveSample(targetSample)
        }
        currentBarIndexRef.current = executionBarIndex
        currentBarRef.current = targetSample.klines[executionBarIndex] || currentBarRef.current
        setCurrentBarIndex(executionBarIndex)
      }

      // 持久化失败不影响 UI 推进
      try {
        await persistTradeAction(execution.trade, executionBarIndex)
      } catch (persistError) {
        console.error('持久化交易动作失败:', persistError)
        window.electronAPI?.log?.('error', '[WT] persistTradeAction failed', { error: String(persistError) })
      }

      if (actionType === 'skip') {
        await finishSession('skip', execution.nextState)
        return
      }

      if (!shouldUseNextOpen) {
        await stepForward(execution.nextState)
      }
    } catch (error) {
      console.error('执行动作失败:', error)
      window.electronAPI?.log?.('error', '[WT] runAction failed', { error: String(error) })
      setActionError('动作提交失败，请重试。')
    } finally {
      setActionPending(false)
    }
  }, [
    sessionStatus, activeSample, currentBar, actionPending, account,
    appendActionLog, currentBarIndex, persistTradeAction,
    finishSession, stepForward, executionMode, extendActiveSample
  ])

  const handleActionClick = useCallback((actionType: ManualActionType) => {
    void runAction(actionType)
  }, [runAction])

  const handleReset = useCallback(() => {
    const capital = activeProfile?.current_capital || INITIAL_CAPITAL
    const nextAccount = createInitialTradingState(capital)
    sessionStatusRef.current = 'idle'
    sessionIdRef.current = ''
    activeSampleRef.current = null
    currentBarIndexRef.current = 0
    currentBarRef.current = null
    accountRef.current = nextAccount
    sessionStartedAtRef.current = 0
    setSessionStatus('idle')
    setSessionId('')
    setActiveSample(null)
    setCurrentBarIndex(0)
    setAccount(nextAccount)
    setActions([])
    setSessionReview(null)
    setActionError('')
    setSessionStartedAt(0)
    setNotice('')
    finishingRef.current = false
  }, [activeProfile])

  const handleSwitchSample = useCallback(async () => {
    setActionPending(true)

    let nextCapital = getCurrentSessionFinalCapital() ?? activeProfileRef.current?.current_capital ?? INITIAL_CAPITAL
    const curStatus = sessionStatusRef.current
    const curSample = activeSampleRef.current
    const curBar = currentBarRef.current
    const curAccount = accountRef.current
    const curSessionId = sessionIdRef.current
    const curInitCap = sessionInitialCapitalRef.current
    const curStartedAt = sessionStartedAtRef.current
    const curProfile = activeProfileRef.current

    if (curStatus === 'running' && curSample && curBar) {
      const settlement = settleAtSessionEnd(curAccount, curBar.close, DEFAULT_TRADING_CONFIG)
      const finalCapital = computeEquity(settlement.nextState, curBar.close)

      if (settlement.autoCloseTrade) {
        await persistTradeAction(settlement.autoCloseTrade, currentBarIndexRef.current, 'auto_close')
      }

      try {
        await window.electronAPI?.db?.finishSession(curSessionId, finalCapital, settlement.nextState.realizedPnl, {
          profileId: curProfile?.id,
          sampleId: curSample.id,
          stockCode: curSample.code,
          stockName: curSample.name,
          intervalType: curSample.period,
          startedAt: curStartedAt || Date.now(),
          initialCapital: curInitCap
        })
      } catch (err) {
        window.electronAPI?.log?.('error', '[WT] handleSwitchSample finishSession error', String(err))
      }
      void refreshProfileCaches()
      nextCapital = finalCapital
    }

    finishingRef.current = false
    sessionStatusRef.current = 'idle'
    sessionIdRef.current = ''
    activeSampleRef.current = null
    currentBarIndexRef.current = 0
    currentBarRef.current = null
    setSessionStatus('idle')
    setSessionId('')
    setActiveSample(null)
    setCurrentBarIndex(0)
    accountRef.current = createInitialTradingState(nextCapital)
    setAccount(accountRef.current)
    setActions([])
    setSessionReview(null)
    setActionError('')
    try {
      const normalized = await requestRandomSamples(regime, period)
      if (normalized.length > 0) {
        setSamples(normalized)
        setDataReady(true)
        const idx = Math.floor(Math.random() * normalized.length)
        const sample = normalized[idx]
        const safeWarmup = Math.max(10, Math.min(sample.warmupBars, sample.klines.length - 2))
        const startedAt = Date.now()
        const saved = await window.electronAPI?.db?.saveSession({
          sampleId: sample.id,
          stockCode: sample.code,
          stockName: sample.name,
          intervalType: sample.period,
          startedAt,
          initialCapital: nextCapital,
          profileId: curProfile?.id
        })
        const resolvedSessionId = (saved as SaveSessionResult | undefined)?.id || `session_local_${Date.now()}`
        const nextAccount = createInitialTradingState(nextCapital)
        sessionIdRef.current = resolvedSessionId
        activeSampleRef.current = sample
        sessionStatusRef.current = 'running'
        currentBarIndexRef.current = safeWarmup
        currentBarRef.current = sample.klines[safeWarmup] || null
        accountRef.current = nextAccount
        sessionInitialCapitalRef.current = nextCapital
        sessionStartedAtRef.current = startedAt
        setSessionId(resolvedSessionId)
        setActiveSample(sample)
        setSessionStatus('running')
        setCurrentBarIndex(safeWarmup)
        setAccount(nextAccount)
        setSessionInitialCapital(nextCapital)
        setSessionStartedAt(startedAt)
        setActions([])
        setSessionReview(null)
        setActionError('')
        setNotice('')
      } else {
        setSamples([])
        setDataReady(false)
        setNotice('暂无可用样本，请检查数据。')
      }
    } catch {
      setNotice('换样本失败，请重试。')
    } finally {
      setActionPending(false)
    }
  }, [regime, period, requestRandomSamples, persistTradeAction, currentBarIndex, refreshProfileCaches, getCurrentSessionFinalCapital])

  const handleContinueTraining = useCallback(async () => {
    const carryCapital = getCurrentSessionFinalCapital() ?? undefined
    if (samples.length === 0) {
      setNotice('样本池为空，正在刷新...')
      const normalized = await requestRandomSamples(regime, period)
      if (normalized.length > 0) {
        setSamples(normalized)
        setDataReady(true)
        const idx = Math.floor(Math.random() * normalized.length)
        await handleStartSession(normalized[idx], carryCapital)
        return
      }
      setNotice('暂无可用样本。')
      return
    }
    const idx = Math.floor(Math.random() * samples.length)
    await handleStartSession(samples[idx], carryCapital)
  }, [samples, handleStartSession, regime, period, requestRandomSamples, getCurrentSessionFinalCapital])

  const handleExitContinuous = useCallback(() => {
    setContinuousMode(false)
    setContinuousStats({
      sessionsCompleted: 0, totalPnl: 0, wins: 0, losses: 0,
      currentStreak: 0, streakType: 'none', bestStreak: 0
    })
    handleReset()
  }, [handleReset])

  const handleResetSettings = useCallback(() => {
    setRegime(DEFAULT_WORKBENCH_SETTINGS.regime)
    setContinuousMode(DEFAULT_WORKBENCH_SETTINGS.continuousMode)
    setExecutionMode(DEFAULT_WORKBENCH_SETTINGS.executionMode)
    setCandidateCount(DEFAULT_WORKBENCH_SETTINGS.candidateCount)
    setMinPrice(DEFAULT_WORKBENCH_SETTINGS.minPrice)
    setVisibleCount(DEFAULT_WORKBENCH_SETTINGS.visibleCount)
    setSamplePoolBars(520)
    samplePoolBarsRef.current = 520
    void window.electronAPI?.db?.savePreference('workbench_settings_v1', {
      regime: DEFAULT_WORKBENCH_SETTINGS.regime,
      continuousMode: DEFAULT_WORKBENCH_SETTINGS.continuousMode,
      executionMode: DEFAULT_WORKBENCH_SETTINGS.executionMode,
      candidateCount: DEFAULT_WORKBENCH_SETTINGS.candidateCount,
      minPrice: DEFAULT_WORKBENCH_SETTINGS.minPrice,
      visibleCount: DEFAULT_WORKBENCH_SETTINGS.visibleCount,
      samplePoolBars: 520
    })
    if (sessionStatus === 'idle') {
      setInitialized(false)
    }
    setSettingsFeedback('已恢复默认配置。')
    setTimeout(() => setSettingsFeedback(''), 4000)
  }, [sessionStatus])

  // Auto-save running session on unmount (page switch)
  useEffect(() => {
    return () => {
      const status = sessionStatusRef.current
      const sid = sessionIdRef.current
      const acc = accountRef.current
      const bar = currentBarRef.current
      const sample = activeSampleRef.current
      const profile = activeProfileRef.current
      const initCap = sessionInitialCapitalRef.current
      const startedAt = sessionStartedAtRef.current

      if (status !== 'running' || !sid || !bar || !sample) return

      const settlement = settleAtSessionEnd(acc, bar.close, DEFAULT_TRADING_CONFIG)
      const finalCapital = computeEquity(settlement.nextState, bar.close)

      window.electronAPI?.log?.('info', '[WT] unmount auto-save', { sid, finalCapital, initCap, accountCash: acc.cash })

      void (async () => {
        try {
          await window.electronAPI?.db?.finishSession(sid, finalCapital, settlement.nextState.realizedPnl, {
            profileId: profile?.id,
            sampleId: sample.id,
            stockCode: sample.code,
            stockName: sample.name,
            intervalType: sample.period,
            startedAt: startedAt || Date.now(),
            initialCapital: initCap
          })
        } catch (error) {
          window.electronAPI?.log?.('error', '[WT] unmount finishSession error', String(error))
        } finally {
          const store = usePlatformStore.getState()
          await Promise.allSettled([
            store.fetchActiveProfile(),
            store.fetchProfileList(),
            store.invalidateSessionList()
          ])
        }
      })()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (sessionStatus !== 'running' || actionPending) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      const key = e.key.toLowerCase()
      if (key === 'b') {
        e.preventDefault()
        handleActionClick('buy')
      } else if (key === 's') {
        e.preventDefault()
        handleActionClick('sell')
      } else if (key === 'h' || key === ' ') {
        e.preventDefault()
        handleActionClick('hold')
      } else if (key === 'n') {
        e.preventDefault()
        void handleSwitchSample()
      } else if (key === 'arrowright') {
        e.preventDefault()
        void handleStepForward()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sessionStatus, actionPending, handleActionClick, handleSwitchSample, handleStepForward])

  return (
    <div className="wt-workbench">
      <ContinuousBar continuousMode={continuousMode} stats={continuousStats} />

      <div className="wt-profile-bar">
        <div className="wt-profile-info">
          {activeProfile ? (
            (() => {
              const displayCapital = sessionStatus === 'running' || sessionStatus === 'finished'
                ? accountEquity
                : activeProfile.current_capital
              const displayPnl = sessionStatus === 'running' || sessionStatus === 'finished'
                ? totalPnl
                : activeProfile.total_pnl
              return (
                <>
                  <UserIcon className="wt-profile-icon" size={16} />
                  <span className="wt-profile-name">{activeProfile.name}</span>
                  <span className="wt-profile-capital">{displayCapital.toFixed(0)}元</span>
                  <span className={`wt-profile-pnl ${displayPnl >= 0 ? 'up' : 'down'}`}>
                    {displayPnl >= 0 ? '+' : ''}{displayPnl.toFixed(0)}
                  </span>
                  <span className="wt-profile-sessions">
                    {activeProfile.total_sessions}轮 · 胜率 {activeProfile.total_sessions > 0 ? ((activeProfile.total_wins / activeProfile.total_sessions) * 100).toFixed(1) : '0'}%
                  </span>
                </>
              )
            })()
          ) : (
            <span className="wt-profile-name">
              未创建账户
              {onNavigate && (
                <button className="wt-inline-btn" onClick={() => onNavigate('overview')} style={{ marginLeft: 8 }}>
                  前往创建
                </button>
              )}
            </span>
          )}
        </div>
      </div>

      {notice && <div className="wt-notice">{notice}</div>}

      {sessionStatus === 'idle' && !dataReady && (
        <div className="wt-setup">
          <div className="wt-no-data">
            <div className="wt-no-data-icon"><ChartBarIcon size={40} /></div>
            <div className="wt-no-data-text">
              {sampleLoading ? '正在加载样本...' : '暂无真实行情数据'}
            </div>
            {!sampleLoading && (
              <>
                <div className="wt-no-data-hint">
                  请先同步数据
                  <InfoHover
                    position="bottom"
                    content="在「数据管理」页面同步行情数据后，盲训工作台才能加载真实 K 线样本。支持日线、15 分钟线和 5 分钟线。"
                  />
                </div>
                <button
                  className="wt-refresh-btn"
                  onClick={() => { setInitialized(false) }}
                  disabled={sampleLoading}
                >
                  重新检查
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {sessionStatus === 'idle' && dataReady && sampleLoading && (
        <div className="wt-setup">
          <div className="wt-no-data">
            <div className="wt-no-data-text">正在切换样本...</div>
          </div>
        </div>
      )}

      {(sessionStatus === 'running' || (sessionStatus === 'idle' && dataReady && !sampleLoading)) && (
        <section className="wt-session">
          <SessionToolbar
            activeSample={activeSample}
            period={period}
            regime={regime}
            currentBarIndex={currentBarIndex}
            sampleCount={samples.length}
            sessionStatus={sessionStatus}
            dataReady={dataReady}
            sampleLoading={sampleLoading}
            showSettings={showSettings}
            continuousMode={continuousMode}
            executionMode={executionMode}
            actionPending={actionPending || extendingSample}
            candidateCount={candidateCount}
            minPrice={minPrice}
            samplePoolBars={samplePoolBars}
            activeSampleLoadedBars={activeSample?.klines.length || 0}
            activeSampleTotalBars={activeSample?.totalAvailableBars}
            onToggleSettings={() => setShowSettings((value) => !value)}
            onFinishSession={() => void finishSession('manual')}
            onStartTraining={() => void startRandomSession()}
            onResetSettings={handleResetSettings}
            onApplySettings={(settings) => {
              setPeriod(settings.period)
              setRegime(settings.regime)
              setContinuousMode(settings.continuousMode)
              setExecutionMode(settings.executionMode)
              setCandidateCount(settings.candidateCount)
              setMinPrice(settings.minPrice)
              setSamplePoolBars(settings.samplePoolBars)
              samplePoolBarsRef.current = settings.samplePoolBars
              // 持久化训练配置（退出后下次进入仍生效）
              void window.electronAPI?.db?.savePreference('workbench_settings_v1', {
                candidateCount: settings.candidateCount,
                minPrice: settings.minPrice,
                samplePoolBars: settings.samplePoolBars,
                period: settings.period,
                regime: settings.regime,
                continuousMode: settings.continuousMode,
                executionMode: settings.executionMode
              })
              if (sessionStatus === 'idle') {
                setInitialized(false)
                setSettingsFeedback('配置已应用，正在重新加载样本…')
              } else {
                setSettingsFeedback('配置已保存，将在下次新训练中生效。')
              }
              setTimeout(() => setSettingsFeedback(''), 4000)
            }}
            settingsFeedback={settingsFeedback}
          />

          {activeSample && currentBar && sessionStatus === 'running' && (
            <>
              <AccountOverview
                account={account}
                accountEquity={accountEquity}
                totalPnlPct={totalPnlPct}
                unrealizedPnl={unrealizedPnl}
                currentBar={currentBar}
                visibleBars={visibleBars}
                tradeMarkers={visibleTradeMarkers}
                visibleCount={visibleCount}
                onVisibleCountChange={setVisibleCount}
              />

              <ActionSection
                actionPending={actionPending}
                accountShares={account.shares}
                actionError={actionError}
                onActionClick={handleActionClick}
                onNextBar={() => void handleStepForward()}
                onSwitchSample={() => void handleSwitchSample()}
              />

              <ActionLog actions={actions} />
            </>
          )}

          {!activeSample && dataReady && !sampleLoading && (
            <div className="wt-idle-ready">
              <div className="wt-idle-ready-text">
                {samples.length} 个样本就绪
                <InfoHover
                  position="bottom"
                  content="样本从本地数据库随机抽取，包含真实历史 K 线。点击「开始训练」随机选一个样本进入盲训。"
                />
              </div>
            </div>
          )}
        </section>
      )}

      {sessionStatus === 'finished' && (
        <ResultSummary
          totalPnl={totalPnl}
          totalPnlPct={totalPnlPct}
          actions={actions}
          sessionReview={sessionReview}
          activeSample={activeSample}
          continuousMode={continuousMode}
          onContinueTraining={() => void handleContinueTraining()}
          onExitContinuous={handleExitContinuous}
          onSwitchSample={() => void handleSwitchSample()}
        />
      )}
    </div>
  )
}

export default BlindTrainingWorkbench
