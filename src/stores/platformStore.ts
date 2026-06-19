import { create } from 'zustand'
import type { DataStats, SessionSummary, UnknownRecord } from '../types/ipc'
import type { TrainingProfile } from '../components/trading/blind-workbench/ProfileManager'

export interface StockOption {
  code: string
  name: string
}

const toStockOption = (raw: UnknownRecord): StockOption | null => {
  const code = raw.code
  if (typeof code !== 'string' || !code) return null
  return {
    code,
    name: typeof raw.name === 'string' && raw.name ? raw.name : code
  }
}

function toTrainingProfile(raw: UnknownRecord): TrainingProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id
  const name = raw.name
  if (typeof id !== 'string' || typeof name !== 'string') return null
  return {
    id,
    name,
    initial_capital: typeof raw.initial_capital === 'number' ? raw.initial_capital : 100000,
    current_capital: typeof raw.current_capital === 'number' ? raw.current_capital : 100000,
    total_sessions: typeof raw.total_sessions === 'number' ? raw.total_sessions : 0,
    total_pnl: typeof raw.total_pnl === 'number' ? raw.total_pnl : 0,
    total_wins: typeof raw.total_wins === 'number' ? raw.total_wins : 0,
    total_losses: typeof raw.total_losses === 'number' ? raw.total_losses : 0,
    total_duration_seconds: typeof raw.total_duration_seconds === 'number' ? raw.total_duration_seconds : 0,
    total_holding_days: typeof raw.total_holding_days === 'number' ? raw.total_holding_days : undefined,
    total_trades_count: typeof raw.total_trades_count === 'number' ? raw.total_trades_count : undefined,
    total_winning_trades: typeof raw.total_winning_trades === 'number' ? raw.total_winning_trades : undefined,
    avg_session_return_pct: typeof raw.avg_session_return_pct === 'number' ? raw.avg_session_return_pct : undefined,
    best_session_return_pct: typeof raw.best_session_return_pct === 'number' ? raw.best_session_return_pct : undefined,
    worst_session_return_pct: typeof raw.worst_session_return_pct === 'number' ? raw.worst_session_return_pct : undefined,
    max_drawdown_pct: typeof raw.max_drawdown_pct === 'number' ? raw.max_drawdown_pct : undefined,
  }
}

interface PlatformState {
  dataStats: DataStats | null
  dataStatsLoaded: boolean
  sessionList: SessionSummary[]
  sessionListLoaded: boolean
  stockList: StockOption[]
  stockListLoaded: boolean
  activeProfile: TrainingProfile | null
  activeProfileLoaded: boolean
  profileList: TrainingProfile[]
  profileListLoaded: boolean
}

interface PlatformActions {
  fetchDataStats: () => Promise<void>
  fetchSessionList: () => Promise<void>
  fetchStockList: (limit?: number) => Promise<void>
  fetchActiveProfile: () => Promise<void>
  fetchProfileList: () => Promise<void>
  invalidateDataStats: () => Promise<void>
  invalidateSessionList: () => Promise<void>
  invalidateStockList: () => Promise<void>
  invalidateActiveProfile: () => Promise<void>
  invalidateProfileList: () => Promise<void>
  switchProfile: (profileId: string) => Promise<boolean>
  createProfile: (name: string, capital: number) => Promise<boolean>
  deleteProfile: (profileId: string) => Promise<boolean>
}

export const usePlatformStore = create<PlatformState & PlatformActions>((set, get) => ({
  dataStats: null,
  dataStatsLoaded: false,
  sessionList: [],
  sessionListLoaded: false,
  stockList: [],
  stockListLoaded: false,
  activeProfile: null,
  activeProfileLoaded: false,
  profileList: [],
  profileListLoaded: false,

  fetchDataStats: async () => {
    try {
      const stats = await window.mobileAPI?.data?.getStats() as DataStats | null | undefined
      set({ dataStats: stats ?? null, dataStatsLoaded: true })
    } catch {
      set({ dataStats: null, dataStatsLoaded: true })
    }
  },

  fetchSessionList: async () => {
    try {
      const sessions = await window.mobileAPI?.db?.listSessions() as SessionSummary[] | null | undefined
      set({ sessionList: sessions || [], sessionListLoaded: true })
    } catch (error) {
      console.error('[platformStore] fetchSessionList failed:', error)
      set({ sessionListLoaded: true })
    }
  },

  fetchStockList: async (limit = 200) => {
    try {
      const rows = await window.mobileAPI?.data?.getStockList(limit) as UnknownRecord[] | null | undefined
      const stocks = (rows || [])
        .map((row) => toStockOption(row as UnknownRecord))
        .filter((row): row is StockOption => row !== null)
      set({ stockList: stocks, stockListLoaded: true })
    } catch {
      set({ stockList: [], stockListLoaded: true })
    }
  },

  invalidateDataStats: async () => {
    set({ dataStatsLoaded: false })
    await get().fetchDataStats()
  },

  invalidateSessionList: async () => {
    set({ sessionListLoaded: false })
    await get().fetchSessionList()
  },

  invalidateStockList: async () => {
    set({ stockListLoaded: false })
    await get().fetchStockList()
  },

  fetchActiveProfile: async () => {
    try {
      const raw = await window.mobileAPI?.profile?.getActive()
      const profile = raw ? toTrainingProfile(raw as UnknownRecord) : null
      set({ activeProfile: profile, activeProfileLoaded: true })
    } catch (error) {
      console.error('[platformStore] fetchActiveProfile failed:', error)
      set({ activeProfileLoaded: true })
    }
  },

  fetchProfileList: async () => {
    try {
      const rows = await window.mobileAPI?.profile?.list() as UnknownRecord[] | null | undefined
      const profiles = (rows || [])
        .map((row) => toTrainingProfile(row as UnknownRecord))
        .filter((p): p is TrainingProfile => p !== null)
      set({ profileList: profiles, profileListLoaded: true })
    } catch (error) {
      console.error('[platformStore] fetchProfileList failed:', error)
      set({ profileListLoaded: true })
    }
  },

  invalidateActiveProfile: async () => {
    set({ activeProfileLoaded: false })
    await get().fetchActiveProfile()
  },

  invalidateProfileList: async () => {
    set({ profileListLoaded: false })
    await get().fetchProfileList()
  },

  switchProfile: async (profileId: string) => {
    try {
      await window.mobileAPI?.profile?.load(profileId)
      await Promise.all([
        get().fetchActiveProfile(),
        get().fetchProfileList(),
        get().invalidateSessionList(),
      ])
      return true
    } catch {
      return false
    }
  },

  createProfile: async (name: string, capital: number) => {
    try {
      await window.mobileAPI?.profile?.create(name, capital)
      await Promise.all([
        get().fetchActiveProfile(),
        get().fetchProfileList(),
        get().invalidateSessionList(),
      ])
      return true
    } catch {
      return false
    }
  },

  deleteProfile: async (profileId: string) => {
    try {
      const result = await window.mobileAPI?.profile?.delete(profileId)
      if (result && typeof result === 'object' && 'success' in result && result.success) {
        const state = get()
        await Promise.all([
          state.fetchProfileList(),
          state.activeProfile?.id === profileId
            ? state.fetchActiveProfile()
            : Promise.resolve(),
          state.invalidateSessionList(),
        ])
        return true
      }
      return false
    } catch {
      return false
    }
  }
}))
