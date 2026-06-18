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
  SessionActionRecord,
  SessionFinishData,
  SessionReview,
  SessionSummary,
  LabelStatusUpdateData,
  ProfileDeleteData,
  PlatformResult,
  UnknownRecord
} from './ipc'

declare global {
  interface Window {
    electronAPI?: {
      quit?: () => void
      db?: {
        getStatistics: () => Promise<DbStatistics>
        saveSession: (session: SaveSessionInput) => Promise<SaveSessionResult>
        finishSession: (
          sessionId: string,
          finalCapital: number,
          realizedPnl: number,
          context?: FinishSessionContext
        ) => Promise<PlatformResult<SessionFinishData>>
        saveTradeAction: (action: SaveTradeActionInput) => Promise<SaveTradeActionResult>
        saveLabel: (label: SaveLabelInput) => Promise<SaveLabelResult>
        updateLabelStatus: (labelId: string, status: string, userConfidence?: number) => Promise<PlatformResult<LabelStatusUpdateData>>
        getSessionLabels: (sessionId: string) => Promise<UnknownRecord[]>
        getSessionActions: (sessionId: string) => Promise<SessionActionRecord[]>
        getSessionReview: (sessionId: string) => Promise<SessionReview | null>
        exportLabelsCSV: (sessionId: string) => Promise<string>
        listSessions: () => Promise<SessionSummary[]>
        getPreference: (key: string) => Promise<unknown>
        savePreference: (key: string, value: unknown) => Promise<boolean>
      }
      profile?: {
        list: () => Promise<UnknownRecord[]>
        getActive: () => Promise<UnknownRecord>
        create: (name: string, initialCapital: number) => Promise<UnknownRecord>
        load: (profileId: string) => Promise<UnknownRecord>
        delete: (profileId: string) => Promise<PlatformResult<ProfileDeleteData>>
        resetCapital: (profileId: string, newCapital: number) => Promise<UnknownRecord>
        getStats: (profileId?: string) => Promise<UnknownRecord | null>
      }
      data?: {
        init: () => Promise<PlatformResult<DataInitData>>
        sync: (count: number, periods: string[]) => Promise<PlatformResult<DataSyncData>>
        getRandomSamples: (
          regime: string,
          period: string,
          count: number,
          options?: { maxBarsPerSymbol?: number; excludeRecent?: number; profileId?: string; candidateCount?: number; minPrice?: number }
        ) => Promise<UnknownRecord[]>
        getStockList: (limit: number) => Promise<UnknownRecord[]>
        getStats: () => Promise<DataStats>
        syncKline5m: (code: string, startDate: string, endDate: string) => Promise<UnknownRecord>
        syncStockList: () => Promise<UnknownRecord>
        syncKline: (code: string, interval: string, limit: number) => Promise<UnknownRecord>
        batchSync: (codes: string[], interval: string, limit: number) => Promise<UnknownRecord[]>
        getCandles: (code: string, interval: string, startDate?: string, endDate?: string) => Promise<UnknownRecord[]>
        getKline: (code: string, period: string, limit: number) => Promise<UnknownRecord[]>
        checkSufficiency: (codes: string[]) => Promise<{ results: Record<string, { barCount: number; needsBackfill: boolean }>; needsBackfill: string[]; sufficientCount: number }>
        backfill15m: (codes: string[]) => Promise<PlatformResult<DataBackfillData>>
        inspectMissingCoverage: () => Promise<UnknownRecord>
        executeBackfillPlan: (plan: { dailyCodes?: string[]; m15Codes?: string[]; m5Codes?: string[] }) => Promise<UnknownRecord>
        triggerIncrementalSync: () => Promise<UnknownRecord>
        rebuildStats: () => Promise<UnknownRecord>
        getAutoSyncStatus: () => Promise<{ lastSyncAt: string | null; nextSyncAt: string; syncing: boolean }>
        getIndexKline?: (code: string, startDate?: string, endDate?: string) => Promise<UnknownRecord>
        getIndexMeta?: () => Promise<UnknownRecord>
        getMarketDbConfig: () => Promise<UnknownRecord>
        setMarketDbConfig: (dbPath: string) => Promise<UnknownRecord>
      }

      agent?: {
        getConfig: () => Promise<{ endpoint: string; model: string; ready: boolean; apiKeyMasked: string }>
        saveConfig: (config: { endpoint?: string; apiKey?: string; model?: string }) => Promise<{ success: boolean; error?: string }>
        testConnection: () => Promise<{ ok: boolean; latencyMs: number; error: string | null }>
        analyzeHabits: (profileId: string) => Promise<unknown>
        generateReport: (req: { profileId: string; habitProfileId?: string; force?: boolean }) => Promise<unknown>
        listReports: (profileId: string, limit?: number) => Promise<unknown[]>
        getHabitHistory: (profileId: string, limit?: number) => Promise<unknown[]>
      }

      onTrainingLog?: (callback: (event: unknown, data: { stream: string; text: string }) => void) => void
      removeTrainingLogListener?: (callback: (event: unknown, data: { stream: string; text: string }) => void) => void

      log?: (level: string, message: string, data?: unknown) => void
    }
  }
}

export {}
