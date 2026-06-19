import { contextBridge, ipcRenderer } from 'electron'
import type {
  DataStats,
  DataBackfillData,
  DataInitData,
  DataSyncData,
  DbStatistics,
  FinishSessionContext,
  SaveLabelInput,
  SaveLabelResult,
  SaveSessionInput,
  SaveSessionResult,
  SaveTradeActionInput,
  SaveTradeActionResult,
  ProfileDeleteData,
  SessionActionRecord,
  SessionFinishData,
  SessionReview,
  SessionSummary,
  LabelStatusUpdateData,
  PlatformResult,
  UnknownRecord
} from '../types/ipc'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

const electronAPI = {
  quit: (): Promise<{ success: boolean }> => invoke('app:quit'),

  db: {
    getStatistics: (): Promise<DbStatistics> => invoke('db:getStatistics'),
    saveSession: (session: SaveSessionInput): Promise<SaveSessionResult> => invoke('db:saveSession', session),
    finishSession: (
      sessionId: string,
      finalCapital: number,
      realizedPnl: number,
      context?: FinishSessionContext
    ): Promise<PlatformResult<SessionFinishData>> => {
      return invoke('db:finishSession', sessionId, finalCapital, realizedPnl, context)
    },
    saveTradeAction: (action: SaveTradeActionInput): Promise<SaveTradeActionResult> => invoke('db:saveTradeAction', action),
    saveLabel: (label: SaveLabelInput): Promise<SaveLabelResult> => invoke('db:saveLabel', label),
    updateLabelStatus: (labelId: string, status: string, userConfidence?: number): Promise<PlatformResult<LabelStatusUpdateData>> => {
      return invoke('db:updateLabelStatus', labelId, status, userConfidence)
    },
    getSessionLabels: (sessionId: string): Promise<UnknownRecord[]> => invoke('db:getSessionLabels', sessionId),
    getSessionActions: (sessionId: string): Promise<SessionActionRecord[]> => invoke('db:getSessionActions', sessionId),
    getSessionReview: (sessionId: string): Promise<SessionReview | null> => invoke('db:getSessionReview', sessionId),
    exportLabelsCSV: (sessionId: string): Promise<string> => invoke('db:exportLabelsCSV', sessionId),
    listSessions: (): Promise<SessionSummary[]> => invoke('db:listSessions'),
    getPreference: (key: string): Promise<unknown> => invoke('db:getPreference', key),
    savePreference: (key: string, value: unknown): Promise<boolean> => invoke('db:savePreference', key, value)
  },

  profile: {
    list: (): Promise<UnknownRecord[]> => invoke('profile:list'),
    getActive: (): Promise<UnknownRecord> => invoke('profile:getActive'),
    create: (name: string, initialCapital: number): Promise<UnknownRecord> => invoke('profile:create', name, initialCapital),
    load: (profileId: string): Promise<UnknownRecord> => invoke('profile:load', profileId),
    delete: (profileId: string): Promise<PlatformResult<ProfileDeleteData>> => invoke('profile:delete', profileId),
    resetCapital: (profileId: string, newCapital: number): Promise<UnknownRecord> => invoke('profile:resetCapital', profileId, newCapital)
  },

  data: {
    init: (): Promise<PlatformResult<DataInitData>> => invoke('data:init'),
    sync: (count: number, periods: string[]): Promise<PlatformResult<DataSyncData>> => invoke('data:sync', count, periods),
    getRandomSamples: (
      regime: string,
      period: string,
      count: number,
      options?: { maxBarsPerSymbol?: number; excludeRecent?: number; profileId?: string; candidateCount?: number; minPrice?: number }
    ): Promise<UnknownRecord[]> => {
      return invoke('data:getRandomSamples', regime, period, count, options)
    },
    getStockList: (limit: number): Promise<UnknownRecord[]> => invoke('data:getStockList', limit),
    getStats: (): Promise<DataStats> => invoke('data:getStats'),
    syncKline5m: (code: string, startDate: string, endDate: string): Promise<UnknownRecord> => {
      return invoke('data:syncKline5m', code, startDate, endDate)
    },
    syncStockList: (): Promise<UnknownRecord> => invoke('data:syncStockList'),
    syncKline: (code: string, interval: string, limit: number): Promise<UnknownRecord> => invoke('data:syncKline', code, interval, limit),
    batchSync: (codes: string[], interval: string, limit: number): Promise<UnknownRecord[]> => invoke('data:batchSync', codes, interval, limit),
    getCandles: (code: string, interval: string, startDate?: string, endDate?: string): Promise<UnknownRecord[]> => invoke('data:getCandles', code, interval, startDate, endDate),
    checkSufficiency: (codes: string[]): Promise<{ results: Record<string, { barCount: number; needsBackfill: boolean }>; needsBackfill: string[]; sufficientCount: number }> => invoke('data:checkSufficiency', codes),
    getKline: (code: string, period: string, limit: number): Promise<UnknownRecord[]> => invoke('data:getKline', code, period, limit),
    backfill15m: (codes: string[]): Promise<PlatformResult<DataBackfillData>> => invoke('data:backfill15m', codes),
    inspectMissingCoverage: (): Promise<UnknownRecord> => invoke('data:inspectMissingCoverage'),
    executeBackfillPlan: (plan: { dailyCodes?: string[]; m15Codes?: string[]; m5Codes?: string[] }): Promise<UnknownRecord> => {
      return invoke('data:executeBackfillPlan', plan)
    },
    triggerIncrementalSync: (): Promise<UnknownRecord> => invoke('data:triggerIncrementalSync'),
    rebuildStats: (): Promise<UnknownRecord> => invoke('data:rebuildStats'),
    getAutoSyncStatus: (): Promise<{ lastSyncAt: string | null; nextSyncAt: string; syncing: boolean }> => invoke('data:getAutoSyncStatus'),
    getIndexKline: (code: string, startDate?: string, endDate?: string): Promise<UnknownRecord> => invoke('data:getIndexKline', code, startDate, endDate),
    getIndexMeta: (): Promise<UnknownRecord> => invoke('data:getIndexMeta'),
    getMarketDbConfig: (): Promise<UnknownRecord> => invoke('data:getMarketDbConfig'),
    setMarketDbConfig: (dbPath: string): Promise<UnknownRecord> => invoke('data:setMarketDbConfig', dbPath)
  },

  agent: {
    getConfig: (): Promise<{ baseUrl: string; model: string; ready: boolean; apiKeyMasked: string }> =>
      invoke('agent:getConfig'),
    saveConfig: (config: { baseUrl?: string; endpoint?: string; apiKey?: string; model?: string }): Promise<{ success: boolean; error?: string }> =>
      invoke('agent:saveConfig', config),
    testConnection: (): Promise<{ ok: boolean; latencyMs: number; error: string | null }> =>
      invoke('agent:testConnection'),
    analyzeHabits: (profileId: string): Promise<unknown> =>
      invoke('agent:analyzeHabits', { profileId }),
    generateReport: (req: { profileId: string; habitProfileId?: string; force?: boolean }): Promise<unknown> =>
      invoke('agent:generateReport', req),
    listReports: (profileId: string, limit?: number): Promise<unknown> =>
      invoke('agent:listReports', { profileId, limit }),
    getHabitHistory: (profileId: string, limit?: number): Promise<unknown> =>
      invoke('agent:getHabitHistory', { profileId, limit }),
    openReportsFolder: (): Promise<{ success: boolean; error?: string }> =>
      invoke('agent:openReportsFolder'),
  },

  onTrainingLog: (callback: (event: unknown, data: { stream: string; text: string }) => void) => {
    ipcRenderer.on('training:log', callback)
  },
  removeTrainingLogListener: (callback: (event: unknown, data: { stream: string; text: string }) => void) => {
    ipcRenderer.removeListener('training:log', callback)
  },

  log: (level: string, message: string, data?: unknown) => {
    ipcRenderer.invoke('app:log', level, message, data)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
