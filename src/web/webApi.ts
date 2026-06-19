import { initDb } from './dbLoader'
import { initBlindDb, saveSession as blindSaveSession } from './blindDb'
import { getRandomSamples as samplerGetRandomSamples } from './sampler'
import { adaptSampleForWorkbench } from './sampleAdapter'

export interface WebApiInitOptions {
  packData?: Uint8Array
  packUrl?: string
  locateFile?: (file: string) => string
}

const prefsStore = new Map<string, unknown>()

const DEFAULT_PROFILE = {
  id: 'default',
  name: '默认账户',
  current_capital: 100000,
  initial_capital: 100000,
  total_pnl: 0,
  total_sessions: 0,
  total_wins: 0,
  status: 'active',
  created_at: Date.now(),
}

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
      getStatistics: async () => ({ totalSessions: 0, totalLabels: 0, winRate: 0 }),

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
        _sessionId: string,
        finalCapital: number,
        realizedPnl: number,
        _context?: unknown
      ) => {
        return {
          success: true,
          data: { sessionId: _sessionId, finishedAt: Date.now(), finalCapital, realizedPnl },
          error: null,
          code: null,
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
        return { id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ...action }
      },

      saveLabel: async (label: unknown) => {
        return { id: `lbl_${Date.now()}`, ...(label as Record<string, unknown>), createdAt: Date.now() }
      },

      updateLabelStatus: async (labelId: string, status: string) => {
        return { success: true, data: { labelId, status }, error: null, code: null }
      },

      getSessionLabels: async (_sessionId: string) => [],
      getSessionActions: async (_sessionId: string) => [],
      getSessionReview: async (_sessionId: string) => null,
      exportLabelsCSV: async (_sessionId: string) => '',
      listSessions: async () => [],

      getPreference: async (key: string) => (prefsStore.has(key) ? prefsStore.get(key) : null),
      savePreference: async (key: string, value: unknown) => {
        prefsStore.set(key, value)
        return true
      },
    },

    profile: {
      list: async () => [DEFAULT_PROFILE],
      getActive: async () => DEFAULT_PROFILE,
      create: async (name: string, initialCapital: number) => ({
        ...DEFAULT_PROFILE,
        name,
        current_capital: initialCapital,
        initial_capital: initialCapital,
      }),
      load: async (_profileId: string) => DEFAULT_PROFILE,
      delete: async (profileId: string) => ({ success: true, data: { profileId }, error: null, code: null }),
      resetCapital: async (profileId: string, newCapital: number) => ({
        ...DEFAULT_PROFILE,
        id: profileId,
        current_capital: newCapital,
      }),
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
      getCandles: async (_code: string, _interval: string) => [],
      getStats: async () => ({ stockCount: 0, dailyCount: 0, m15Count: 0, m5Count: 0 }),
      init: async () => ({ success: true, data: { stockList: null, dailySynced: 0, dailyFailed: 0 }, error: null, code: null }),
      sync: async () => ({ success: true, data: null, error: null, code: null }),
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
