import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fakeIndexedDB from 'fake-indexeddb'
import { createWebApi } from './webApi'
import * as blindDbModule from './blindDb'

;(globalThis as unknown as { indexedDB: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB

const PACK_PATH = resolve(process.cwd(), 'public/data/builtin-100.sqlite')
const WASM_PATH = resolve(process.cwd(), 'public/sql-wasm.wasm')
const packBuffer = new Uint8Array(readFileSync(PACK_PATH))
const locateFile = () => `file://${WASM_PATH}`

let api: ReturnType<typeof createWebApi>

beforeAll(async () => {
  api = createWebApi({ packData: packBuffer, locateFile })
  await api.init()
}, 30000)

describe('webApi 抽象层', () => {
  it('data.getRandomSamples 返回适配工作台的样本（含 timestamp）', async () => {
    const samples = await api.data.getRandomSamples('mixed', '1d', 3, {
      maxBarsPerSymbol: 260,
      profileId: 'webapi-test',
    })
    expect(samples.length).toBeGreaterThan(0)
    const first = samples[0] as { klines: Array<{ timestamp: number; close: number }> }
    expect(first.klines[0]).toHaveProperty('timestamp')
    expect(typeof first.klines[0].timestamp).toBe('number')
  })

  it('profile.getActive 返回默认账户', async () => {
    const profile = await api.profile.getActive() as { id: string; name: string; current_capital: number }
    expect(profile).toBeTruthy()
    expect(typeof profile.id).toBe('string')
    expect(typeof profile.name).toBe('string')
    expect(typeof profile.current_capital).toBe('number')
  })

  it('db.saveSession 返回带 id 的结果', async () => {
    const result = await api.db.saveSession({
      sampleId: 'smp-test',
      stockCode: '600001',
      stockName: '测试科技',
      intervalType: '1d',
      startedAt: Date.now(),
      initialCapital: 100000,
      profileId: 'webapi-save',
    }) as { id: string }
    expect(result).toBeTruthy()
    expect(typeof result.id).toBe('string')
  })

  it('db.saveSession 异常时返回带 error 字段的结果（不抛）', async () => {
    const spy = vi.spyOn(blindDbModule, 'saveSession').mockRejectedValueOnce(new Error('mocked IDB quota exceeded'))
    try {
      const result = await api.db.saveSession({
        sampleId: 'smp-err',
        stockCode: '600001',
        stockName: '测试',
        intervalType: '1d',
        startedAt: Date.now(),
        initialCapital: 100000,
        profileId: 'webapi-save-err',
      }) as { id: string; error?: string }
      expect(result.id).toBe('')
      expect(typeof result.error).toBe('string')
      expect(result.error).toMatch(/IDB|quota/)
    } finally {
      spy.mockRestore()
    }
  })

  it('db.finishSession 对不存在的 session 返回 success:false', async () => {
    const result = await api.db.finishSession('sess-nonexistent', 100000, 0, {}) as { success: boolean }
    expect(result.success).toBe(false)
  })

  it('db.getPreference 未设置时返回 null', async () => {
    const result = await api.db.getPreference('nonexistent_key_xyz')
    expect(result).toBeNull()
  })

  it('db.savePreference 后 getPreference 能取回', async () => {
    await api.db.savePreference('test_key_abc', { foo: 123 })
    const result = await api.db.getPreference('test_key_abc') as { foo: number } | null
    expect(result).toEqual({ foo: 123 })
  })

  it('log 是 no-op（不抛错）', () => {
    expect(() => api.log('info', 'test message', { a: 1 })).not.toThrow()
  })
})

describe('webApi 端到端集成（训练→结算→复盘）', () => {
  it('完整训练流程：saveSession → saveTradeAction → finishSession → getSessionReview', async () => {
    const created = await api.profile.create('E2E测试账户', 100000)
    const profileId = created.id
    expect(profileId).toBeTruthy()
    expect(created.current_capital).toBe(100000)

    const session = await api.db.saveSession({
      sampleId: 'smp-e2e-1',
      stockCode: '600001',
      stockName: '测试科技',
      intervalType: '1d',
      startedAt: Date.now(),
      initialCapital: 100000,
      profileId,
    }) as { id: string }

    await api.db.saveTradeAction({ sessionId: session.id, barIndex: 0, actionType: 'buy', price: 10, shares: 100, amount: 1000 })
    await api.db.saveTradeAction({ sessionId: session.id, barIndex: 5, actionType: 'sell', price: 15, shares: 100, amount: 1500, realizedPnl: 500 })

    const finishResult = await api.db.finishSession(session.id, 100500, 500, { profileId }) as { success: boolean }
    expect(finishResult.success).toBe(true)

    const review = await api.db.getSessionReview(session.id) as {
      realized_pnl: number
      total_trades: number
      trade_win_rate: number
      avg_holding_bars: number
      buy_count: number
      sell_count: number
    } | null
    expect(review).not.toBeNull()
    expect(review!.realized_pnl).toBe(500)
    expect(review!.total_trades).toBe(2)
    expect(review!.trade_win_rate).toBe(1)
    expect(review!.avg_holding_bars).toBe(5)
    expect(review!.buy_count).toBe(1)
    expect(review!.sell_count).toBe(1)

    const actions = await api.db.getSessionActions(session.id) as Array<{ action_type: string }>
    expect(actions).toHaveLength(2)
    expect(actions[0].action_type).toBe('buy')
    expect(actions[1].action_type).toBe('sell')

    const sessions = await api.db.listSessions(profileId) as Array<{ id: string; realized_pnl: number; status: string }>
    const me = sessions.find((s) => s.id === session.id)
    expect(me).toBeTruthy()
    expect(me!.realized_pnl).toBe(500)
    expect(me!.status).toBe('finished')
  })

  it('finishSession 后 profile 资金反映结果', async () => {
    const created = await api.profile.create('E2E资金测试', 50000)
    const profileId = created.id

    const session = await api.db.saveSession({
      sampleId: 'smp-e2e-2',
      stockCode: '000002',
      stockName: '测试B',
      intervalType: '1d',
      startedAt: Date.now(),
      initialCapital: 50000,
      profileId,
    }) as { id: string }

    await api.db.saveTradeAction({ sessionId: session.id, barIndex: 0, actionType: 'buy', price: 20, shares: 100, amount: 2000 })
    await api.db.saveTradeAction({ sessionId: session.id, barIndex: 4, actionType: 'sell', price: 25, shares: 100, amount: 2500, realizedPnl: 500 })

    await api.db.finishSession(session.id, 50500, 500, { profileId })

    const profile = await api.profile.getActive() as { id: string; current_capital: number; total_pnl: number; total_sessions: number }
    expect(profile.id).toBe(profileId)
    expect(profile.current_capital).toBe(50500)
    expect(profile.total_pnl).toBe(500)
    expect(profile.total_sessions).toBe(1)
  })

  it('profile.list 包含新建账户，profile.delete 拒绝 default', async () => {
    const before = await api.profile.list() as Array<{ id: string; name: string }>
    expect(before.some((p) => p.id === 'default')).toBe(true)

    const deleteDefault = await api.profile.delete('default') as { success: boolean }
    expect(deleteDefault.success).toBe(false)

    const after = await api.profile.list() as Array<{ id: string }>
    expect(after.some((p) => p.id === 'default')).toBe(true)
  })

  it('profile.resetCapital 重置后 total_sessions 归零', async () => {
    const created = await api.profile.create('重置测试', 80000)
    const profileId = created.id

    const session = await api.db.saveSession({
      sampleId: 'smp-reset',
      stockCode: '000003',
      stockName: '测试C',
      intervalType: '1d',
      startedAt: Date.now(),
      initialCapital: 80000,
      profileId,
    }) as { id: string }
    await api.db.saveTradeAction({ sessionId: session.id, barIndex: 0, actionType: 'buy', price: 10, shares: 100 })
    await api.db.saveTradeAction({ sessionId: session.id, barIndex: 2, actionType: 'sell', price: 11, shares: 100, realizedPnl: 100 })
    await api.db.finishSession(session.id, 80100, 100, { profileId })

    await api.profile.resetCapital(profileId, 200000)
    const profiles = await api.profile.list() as Array<{ id: string; current_capital: number; total_sessions: number }>
    const me = profiles.find((p) => p.id === profileId)!
    expect(me.current_capital).toBe(200000)
    expect(me.total_sessions).toBe(0)
  })

  it('data.getCandles 返回该股 K 线', async () => {
    const candles = await api.data.getCandles('000021', '1d') as Array<{ close: number }>
    expect(Array.isArray(candles)).toBe(true)
    expect(candles.length).toBeGreaterThan(0)
    expect(typeof candles[0].close).toBe('number')
  })

  it('data.getStats 返回非零 stockCount/dailyCount（基于 builtin seed 真实聚合）', async () => {
    const stats = await api.data.getStats() as {
      stockCount: number
      dailyCount: number
      m15Count: number
      m5Count: number
    }
    expect(stats.stockCount).toBeGreaterThan(0)
    expect(stats.dailyCount).toBeGreaterThan(0)
  })
})

describe('webApi data 同步/补录/重建（Web 版不支持）', () => {
  it('data.getAutoSyncStatus 返回 disabled 状态', async () => {
    const status = await api.data.getAutoSyncStatus() as {
      lastSyncAt: string | null
      nextSyncAt: string
      syncing: boolean
      syncType: string
      syncError: string | null
    }
    expect(status.syncing).toBe(false)
    expect(status.syncType).toBe('disabled')
    expect(status.lastSyncAt).toBeNull()
    expect(status.syncError).toBeNull()
  })

  it('data.sync 返回 success:false + 预置数据提示', async () => {
    const result = await api.data.sync(10, ['1d']) as { success: boolean; error: { message: string } | null; code: string | null }
    expect(result.success).toBe(false)
    expect(result.code).toBe('NOT_SUPPORTED')
    expect(result.error?.message).toMatch(/预置|不支持|Web/)
  })

  it('data.triggerIncrementalSync 返回 success:false', async () => {
    const result = await api.data.triggerIncrementalSync() as { success: boolean; error: { message: string } | null; code: string | null }
    expect(result.success).toBe(false)
    expect(result.code).toBe('NOT_SUPPORTED')
  })

  it('data.rebuildStats 返回 success:false + 中文 error', async () => {
    const result = await api.data.rebuildStats() as { success: boolean; error: { message: string } | null; code: string | null }
    expect(result.success).toBe(false)
    expect(result.code).toBe('NOT_SUPPORTED')
    expect(result.error?.message).toBeTruthy()
  })

  it('data.inspectMissingCoverage 返回 success:false', async () => {
    const result = await api.data.inspectMissingCoverage() as { success: boolean; code: string | null }
    expect(result.success).toBe(false)
    expect(result.code).toBe('NOT_SUPPORTED')
  })

  it('data.executeBackfillPlan 返回 success:false + 中文 error', async () => {
    const result = await api.data.executeBackfillPlan({
      dailyCodes: [],
      m15Codes: [],
      m5Codes: [],
    }) as { success: boolean; error: { message: string } | null; code: string | null }
    expect(result.success).toBe(false)
    expect(result.code).toBe('NOT_SUPPORTED')
    expect(result.error?.message).toBeTruthy()
  })
})
