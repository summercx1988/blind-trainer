import { initDb } from './dbLoader'
import {
  initBlindDb,
  saveSession as blindSaveSession,
  finishSession as blindFinishSession,
  saveTradeAction as blindSaveTradeAction,
  getSessionActions as blindGetSessionActions,
  getSessionReview as blindGetSessionReview,
  listSessions as blindListSessions,
  listProfiles as blindListProfiles,
  getActiveProfile as blindGetActiveProfile,
  createProfile as blindCreateProfile,
  loadProfile as blindLoadProfile,
  deleteProfile as blindDeleteProfile,
  resetProfileCapital as blindResetProfileCapital,
  getProfileStats as blindGetProfileStats,
} from './blindDb'
import { getRandomSamples as samplerGetRandomSamples } from './sampler'
import { adaptSampleForWorkbench } from './sampleAdapter'
import type {
  PlatformResult,
  SessionFinishData,
  ProfileDeleteData,
} from '../types/ipc'

export interface WebApiInitOptions {
  packData?: Uint8Array
  packUrl?: string
  locateFile?: (file: string) => string
}

function notSupportedResult<T>(empty: T): PlatformResult<T> {
  return {
    success: false,
    data: null,
    error: { message: 'Web 版已预置数据，无需同步/补录' },
    code: 'NOT_SUPPORTED',
    meta: { empty } as never,
  }
}

const prefsStore = new Map<string, unknown>()

export function createWebApi(initOptions: WebApiInitOptions = {}) {
  let initialized = false

  async function init(): Promise<void> {
    await initDb(initOptions)
    await initBlindDb({ locateFile: initOptions.locateFile })
    initialized = true
  }

  return {
    init,
    isReady: () => initialized,

    db: {
      getStatistics: async () => {
        const sessions = await blindListSessions()
        const totalSessions = sessions.length
        return { totalSessions, totalLabels: 0, winRate: 0 }
      },

      saveSession: async (session: {
        sampleId: string
        stockCode: string
        stockName: string
        intervalType: string
        startedAt: number
        initialCapital: number
        profileId?: string
      }) => {
        const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await blindSaveSession({
          id,
          sample_id: session.sampleId,
          stock_code: session.stockCode,
          stock_name: session.stockName,
          interval_type: session.intervalType,
          started_at: session.startedAt,
          initial_capital: session.initialCapital,
          created_at: Date.now(),
          profile_id: session.profileId || 'default',
        })
        return { id, ...session }
      },

      finishSession: async (
        sessionId: string,
        finalCapital: number,
        realizedPnl: number,
        context?: Record<string, unknown>
      ): Promise<PlatformResult<SessionFinishData>> => {
        try {
          const result = await blindFinishSession(sessionId, finalCapital, realizedPnl, context as never)
          if (!result.success) {
            return {
              success: false,
              data: null,
              error: { message: '训练会话不存在', details: { sessionId } },
              code: 'SESSION_NOT_FOUND',
            }
          }
          return {
            success: true,
            data: { sessionId, finishedAt: Date.now(), finalCapital, realizedPnl },
            error: null,
            code: null,
          }
        } catch (err) {
          return {
            success: false,
            data: null,
            error: { message: String(err) },
            code: 'FINISH_SESSION_ERROR',
          }
        }
      },

      saveTradeAction: async (action: {
        sessionId: string
        barIndex: number
        actionType: string
        price?: number
        shares?: number
        amount?: number
        commission?: number
        realizedPnl?: number
        source?: string
      }) => {
        return blindSaveTradeAction({
          sessionId: action.sessionId,
          barIndex: action.barIndex,
          actionType: action.actionType as 'buy' | 'sell' | 'hold' | 'skip',
          price: action.price,
          shares: action.shares,
          amount: action.amount,
          commission: action.commission,
          realizedPnl: action.realizedPnl,
          source: action.source,
        })
      },

      saveLabel: async (label: unknown) => {
        return { id: `lbl_${Date.now()}`, ...(label as Record<string, unknown>), createdAt: Date.now() }
      },

      updateLabelStatus: async (labelId: string, status: string) => {
        return { success: true, data: { labelId, status }, error: null, code: null }
      },

      getSessionLabels: async (_sessionId: string) => [],
      getSessionActions: async (sessionId: string) => blindGetSessionActions(sessionId),
      getSessionReview: async (sessionId: string) => blindGetSessionReview(sessionId),
      exportLabelsCSV: async (_sessionId: string) => '',
      listSessions: async (profileId?: string) => blindListSessions(profileId),

      getPreference: async (key: string) => (prefsStore.has(key) ? prefsStore.get(key) : null),
      savePreference: async (key: string, value: unknown) => {
        prefsStore.set(key, value)
        return true
      },
    },

    profile: {
      list: async () => blindListProfiles(),
      getActive: async () => blindGetActiveProfile(),
      create: async (name: string, initialCapital: number) => blindCreateProfile(name, initialCapital),
      load: async (profileId: string) => blindLoadProfile(profileId),
      delete: async (profileId: string): Promise<PlatformResult<ProfileDeleteData>> => {
        const result = await blindDeleteProfile(profileId)
        if (result.success) {
          return { success: true, data: { profileId }, error: null, code: null }
        }
        return {
          success: false,
          data: null,
          error: { message: result.error || '删除失败' },
          code: 'PROFILE_DELETE_ERROR',
        }
      },
      resetCapital: async (profileId: string, newCapital: number) =>
        blindResetProfileCapital(profileId, newCapital),
      getStats: async (profileId?: string) => blindGetProfileStats(profileId),
    },

    data: {
      getRandomSamples: async (
        regime: string,
        _period: string,
        count: number,
        options?: {
          maxBarsPerSymbol?: number
          excludeRecent?: number
          profileId?: string
          candidateCount?: number
          minPrice?: number
        }
      ) => {
        const samples = await samplerGetRandomSamples(regime, count, {
          maxBarsPerSymbol: options?.maxBarsPerSymbol,
          profileId: options?.profileId,
          candidateCount: options?.candidateCount,
          minPrice: options?.minPrice,
        })
        return samples.map(adaptSampleForWorkbench)
      },
      getStockList: async (limit: number) => {
        const { queryStockList } = await import('./dbLoader')
        return queryStockList(limit)
      },
      getKline: async (code: string, _period: string, limit: number) => {
        const { queryKline } = await import('./dbLoader')
        return queryKline(code, 'daily', limit)
      },
      getCandles: async (code: string, _interval: string) => {
        const { queryKline } = await import('./dbLoader')
        return queryKline(code, 'daily', 99999)
      },
      getStats: async () => ({ stockCount: 0, dailyCount: 0, m15Count: 0, m5Count: 0 }),
      init: async () => ({ success: true, data: { stockList: null, dailySynced: 0, dailyFailed: 0 }, error: null, code: null }),

      getAutoSyncStatus: async () => ({
        lastSyncAt: null,
        nextSyncAt: '',
        syncing: false,
        syncType: 'disabled',
        syncError: null,
      }),

      sync: async (_count?: number, _periods?: string[]) => notSupportedResult<unknown>({
        syncedFromApi: 0,
        syncedFromCache: 0,
        syncedEmpty: 0,
        totalResults: 0,
        autoSignalScan: null,
        coverage: null,
        syncAdvice: [],
      }),
      triggerIncrementalSync: async () => notSupportedResult<{ started: false }>({ started: false }),
      rebuildStats: async () => notSupportedResult<{
        stockCount: number
        dailyCount: number
        m15Count: number
        m5Count: number
        statsRows?: number
      }>({ stockCount: 0, dailyCount: 0, m15Count: 0, m5Count: 0 }),
      inspectMissingCoverage: async () => notSupportedResult<{
        scannedAt: string
        stockCount: number
        latestTradingDate: string | null
        latestMinuteCutoff: string | null
        intervals: { '1d': unknown; '15m': unknown; '5m': unknown }
      }>({
        scannedAt: '',
        stockCount: 0,
        latestTradingDate: null,
        latestMinuteCutoff: null,
        intervals: { '1d': null, '15m': null, '5m': null },
      }),
      executeBackfillPlan: async (_plan: { dailyCodes: string[]; m15Codes: string[]; m5Codes: string[] }) => notSupportedResult<{
        execution: { daily: unknown; m15: unknown; m5: unknown }
        stats: { stockCount: number; dailyCount: number; m15Count: number; m5Count: number }
        coverage: unknown
      }>({
        execution: { daily: null, m15: null, m5: null },
        stats: { stockCount: 0, dailyCount: 0, m15Count: 0, m5Count: 0 },
        coverage: null,
      }),

      checkSufficiency: async (_codes: string[]) => ({ results: {}, needsBackfill: [], sufficientCount: 0 }),
    },

    agent: {
      getConfig: async () => ({ baseUrl: '', model: '', ready: false, apiKeyMasked: '' }),
      saveConfig: async () => ({ success: false, error: 'Web 版暂不支持 AI 配置' }),
      testConnection: async () => ({ ok: false, latencyMs: 0, error: 'Web 版暂不支持 AI' }),
      analyzeHabits: async () => null,
      generateReport: async () => null,
      listReports: async () => [],
      getHabitHistory: async () => [],
    },

    onTrainingLog: () => {},
    removeTrainingLogListener: () => {},
    log: (_level: string, _message: string, _data?: unknown) => {},
  }
}

export type WebApi = ReturnType<typeof createWebApi>