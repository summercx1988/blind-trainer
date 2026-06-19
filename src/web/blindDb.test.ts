import { describe, it, expect, beforeEach } from 'vitest'
import fakeIndexedDB from 'fake-indexeddb'
import { resolve } from 'node:path'
import {
  initBlindDb,
  saveSession,
  markTrained,
  getTrainedCodes,
  isBlindDbReady,
  saveTradeAction,
  finishSession,
  getSessionActions,
  getSessionReview,
  listSessions,
  listProfiles,
  getActiveProfile,
  createProfile,
  loadProfile,
  deleteProfile,
  resetProfileCapital,
  getProfileStats,
} from './blindDb'

;(globalThis as unknown as { indexedDB: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB

// sql.js 的 locateFile 在 jsdom 下需指向真实 wasm 文件
const WASM_PATH = resolve(process.cwd(), 'public/sql-wasm.wasm')
const locateFile = () => `file://${WASM_PATH}`

beforeEach(async () => {
  await initBlindDb({ forceRefresh: true, locateFile })
})

describe('blindDb 盲训库管理', () => {
  it('initBlindDb 后 isBlindDbReady 为 true', async () => {
    await initBlindDb({ forceRefresh: true, locateFile })
    expect(isBlindDbReady()).toBe(true)
  })

  it('saveSession 后能查到该 session 关联的股票', async () => {
    await saveSession({
      id: 'sess-1',
      sample_id: 'smp-1',
      stock_code: '600001',
      stock_name: '测试科技',
      interval_type: '1d',
      started_at: 1718000000,
      initial_capital: 100000,
      created_at: 1718000000,
      profile_id: 'default',
    })
    const trained = await getTrainedCodes('default')
    expect(trained).toContain('600001')
  })

  it('markTrained 独立标记已训练股', async () => {
    await markTrained('600002', 'default')
    const trained = await getTrainedCodes('default')
    expect(trained).toContain('600002')
  })

  it('不同 profile 的已训练股互不干扰', async () => {
    await markTrained('600001', 'profileA')
    await markTrained('600002', 'profileB')
    expect(await getTrainedCodes('profileA')).toEqual(['600001'])
    expect(await getTrainedCodes('profileB')).toEqual(['600002'])
  })

  it('持久化后重启能恢复（forceRefresh=false 从 IndexedDB 加载）', async () => {
    await markTrained('600999', 'default')
    // 模拟重启：再次 init 但不强制刷新
    await initBlindDb({ forceRefresh: false, locateFile })
    const trained = await getTrainedCodes('default')
    expect(trained).toContain('600999')
  })
})

// 创建一个 active session 的 helper（多条测试复用）
async function seedActiveSession(id: string, profileId = 'default') {
  await saveSession({
    id,
    sample_id: `smp-${id}`,
    stock_code: '600001',
    stock_name: '测试科技',
    interval_type: '1d',
    started_at: 1718000000000,
    initial_capital: 100000,
    created_at: 1718000000000,
    profile_id: profileId,
  })
}

describe('blindDb 动作持久化与结算', () => {
  it('saveTradeAction 写入 trade_actions 并能经 getSessionActions 查回', async () => {
    await seedActiveSession('sess-act-1')
    await saveTradeAction({
      sessionId: 'sess-act-1',
      barIndex: 0,
      actionType: 'buy',
      price: 10,
      shares: 100,
      amount: 1000,
      source: 'manual',
    })
    await saveTradeAction({
      sessionId: 'sess-act-1',
      barIndex: 5,
      actionType: 'sell',
      price: 15,
      shares: 100,
      amount: 1500,
      realizedPnl: 500,
      source: 'manual',
    })

    const actions = await getSessionActions('sess-act-1')
    expect(actions).toHaveLength(2)
    expect(actions[0].action_type).toBe('buy')
    expect(actions[1].action_type).toBe('sell')
    expect(actions[1].realized_pnl).toBe(500)
  })

  it('saveTradeAction 不影响其他 session', async () => {
    await seedActiveSession('sess-a')
    await seedActiveSession('sess-b')
    await saveTradeAction({ sessionId: 'sess-a', barIndex: 0, actionType: 'buy', price: 10, shares: 100 })
    expect(await getSessionActions('sess-b')).toHaveLength(0)
    expect(await getSessionActions('sess-a')).toHaveLength(1)
  })

  it('finishSession 写 finished_at/status/final_capital 并回算 session 聚合字段', async () => {
    await seedActiveSession('sess-fin-1')
    await saveTradeAction({ sessionId: 'sess-fin-1', barIndex: 0, actionType: 'buy', price: 10, shares: 100, amount: 1000 })
    await saveTradeAction({ sessionId: 'sess-fin-1', barIndex: 5, actionType: 'sell', price: 15, shares: 100, amount: 1500, realizedPnl: 500 })

    await finishSession('sess-fin-1', 100500, 500, { profileId: 'default' })

    const sessions = await listSessions()
    const s = sessions.find((row) => row.id === 'sess-fin-1')!
    expect(s).toBeTruthy()
    expect(s.status).toBe('finished')
    expect(s.finished_at).toBeGreaterThan(0)
    expect(s.final_capital).toBe(100500)
    expect(s.realized_pnl).toBe(500)
    expect(s.total_trades).toBe(2)
    expect(s.winning_trades).toBe(1)
  })

  it('finishSession 不存在的 session 返回 success:false', async () => {
    const result = await finishSession('sess-not-exist', 100000, 0, {})
    expect(result.success).toBe(false)
  })

  it('getSessionReview 在 finishSession 后返回非 null 复盘（含胜率/持仓/回撤）', async () => {
    await seedActiveSession('sess-rev-1')
    await saveTradeAction({ sessionId: 'sess-rev-1', barIndex: 0, actionType: 'buy', price: 10, shares: 100 })
    await saveTradeAction({ sessionId: 'sess-rev-1', barIndex: 5, actionType: 'sell', price: 15, shares: 100, realizedPnl: 500 })
    await finishSession('sess-rev-1', 100500, 500, { profileId: 'default' })

    const review = await getSessionReview('sess-rev-1')
    expect(review).not.toBeNull()
    expect(review!.session_id).toBe('sess-rev-1')
    expect(review!.buy_count).toBe(1)
    expect(review!.sell_count).toBe(1)
    expect(review!.total_trades).toBe(2)
    expect(review!.winning_trades).toBe(1)
    expect(review!.trade_win_rate).toBe(1)
    expect(review!.realized_pnl).toBe(500)
    expect(review!.avg_holding_bars).toBe(5)
    expect(review!.avg_holding_days).toBe(5)
  })

  it('getSessionReview 对无 actions 的 session 返回全零复盘（非 null）', async () => {
    await seedActiveSession('sess-rev-empty')
    await finishSession('sess-rev-empty', 100000, 0, { profileId: 'default' })
    const review = await getSessionReview('sess-rev-empty')
    expect(review).not.toBeNull()
    expect(review!.total_trades).toBe(0)
    expect(review!.trade_win_rate).toBe(0)
  })

  it('listSessions 按 started_at 倒序，并 LEFT JOIN review 指标', async () => {
    await seedActiveSession('sess-list-1')
    await saveTradeAction({ sessionId: 'sess-list-1', barIndex: 0, actionType: 'buy', price: 10, shares: 100 })
    await saveTradeAction({ sessionId: 'sess-list-1', barIndex: 2, actionType: 'sell', price: 12, shares: 100, realizedPnl: 200 })
    await finishSession('sess-list-1', 100200, 200, { profileId: 'default' })

    // 再建一个更晚的 session（未结算）
    await saveSession({
      id: 'sess-list-2',
      sample_id: 'smp-2',
      stock_code: '600002',
      stock_name: '测试B',
      interval_type: '1d',
      started_at: 1718000000000 + 100000,
      initial_capital: 100000,
      created_at: 1718000000000 + 100000,
      profile_id: 'default',
    })

    const sessions = await listSessions()
    expect(sessions.length).toBeGreaterThanOrEqual(2)
    // 倒序：更晚的在前
    expect(sessions[0].id).toBe('sess-list-2')
    const finished = sessions.find((s) => s.id === 'sess-list-1')!
    expect(finished.trade_win_rate).toBe(1)
    expect(finished.realized_pnl_pct).toBeCloseTo(0.2, 5)
  })

  it('listSessions 支持按 profileId 过滤', async () => {
    await seedActiveSession('sess-pf-a', 'profileA')
    await seedActiveSession('sess-pf-b', 'profileB')
    const aOnly = await listSessions('profileA')
    expect(aOnly.every((s) => s.profile_id === 'profileA')).toBe(true)
    expect(aOnly.some((s) => s.id === 'sess-pf-a')).toBe(true)
    expect(aOnly.some((s) => s.id === 'sess-pf-b')).toBe(false)
  })

  it('结算数据持久化：重启后历史 session 与复盘仍在', async () => {
    await seedActiveSession('sess-persist')
    await saveTradeAction({ sessionId: 'sess-persist', barIndex: 0, actionType: 'buy', price: 10, shares: 100 })
    await saveTradeAction({ sessionId: 'sess-persist', barIndex: 3, actionType: 'sell', price: 13, shares: 100, realizedPnl: 300 })
    await finishSession('sess-persist', 100300, 300, { profileId: 'default' })

    // 模拟重启
    await initBlindDb({ forceRefresh: false, locateFile })
    const sessions = await listSessions()
    expect(sessions.some((s) => s.id === 'sess-persist')).toBe(true)
    const review = await getSessionReview('sess-persist')
    expect(review).not.toBeNull()
    expect(review!.realized_pnl).toBe(300)
    const actions = await getSessionActions('sess-persist')
    expect(actions).toHaveLength(2)
  })
})

describe('blindDb 多账户管理', () => {
  it('init 后默认账户存在且 active', async () => {
    const active = await getActiveProfile()
    expect(active).not.toBeNull()
    expect(active!.id).toBe('default')
    expect(active!.is_active).toBe(1)
    expect(active!.current_capital).toBe(100000)
  })

  it('listProfiles 返回至少一个默认账户', async () => {
    const list = await listProfiles()
    expect(list.some((p) => p.id === 'default')).toBe(true)
  })

  it('createProfile 新建账户并自动激活', async () => {
    const p = await createProfile('趋势跟踪', 200000)
    expect(p.id).toMatch(/^profile_/)
    expect(p.name).toBe('趋势跟踪')
    expect(p.current_capital).toBe(200000)
    expect(p.initial_capital).toBe(200000)
    expect(p.is_active).toBe(1)

    const active = await getActiveProfile()
    expect(active!.id).toBe(p.id)
  })

  it('createProfile 同名抛错', async () => {
    await createProfile('策略A', 100000)
    await expect(createProfile('策略A', 200000)).rejects.toThrow(/已存在|重复/)
  })

  it('createProfile 资金 ≤0 抛错', async () => {
    await expect(createProfile('Zero', 0)).rejects.toThrow()
    await expect(createProfile('Neg', -100)).rejects.toThrow()
  })

  it('loadProfile 切换 active', async () => {
    const p = await createProfile('B', 150000)
    await loadProfile('default')
    const active = await getActiveProfile()
    expect(active!.id).toBe('default')
    expect(p.id).not.toBe('default')
  })

  it('finishSession 后 profile.current_capital 反映最后一局结果', async () => {
    await seedActiveSession('sess-pf-1', 'default')
    await saveTradeAction({ sessionId: 'sess-pf-1', barIndex: 0, actionType: 'buy', price: 10, shares: 100 })
    await saveTradeAction({ sessionId: 'sess-pf-1', barIndex: 4, actionType: 'sell', price: 13, shares: 100, realizedPnl: 300 })
    await finishSession('sess-pf-1', 100300, 300, { profileId: 'default' })

    const active = await getActiveProfile()
    expect(active!.current_capital).toBe(100300)
    expect(active!.total_pnl).toBe(300)
    expect(active!.total_sessions).toBe(1)
    expect(active!.total_wins).toBe(1)
    expect(active!.total_trades_count).toBe(2)
    expect(active!.total_winning_trades).toBe(1)
  })

  it('deleteProfile 删除非默认、非 active 的账户；返回 success=true', async () => {
    const p = await createProfile('ToDelete', 50000)
    await loadProfile('default')
    const result = await deleteProfile(p.id)
    expect(result.success).toBe(true)
    const list = await listProfiles()
    expect(list.some((x) => x.id === p.id)).toBe(false)
  })

  it('deleteProfile 拒绝删除默认账户', async () => {
    const result = await deleteProfile('default')
    expect(result.success).toBe(false)
  })

  it('deleteProfile 拒绝删除当前 active 账户', async () => {
    const p = await createProfile('Active', 50000)
    const result = await deleteProfile(p.id)
    expect(result.success).toBe(false)
  })

  it('resetProfileCapital 重置 current_capital 并清零聚合指标', async () => {
    await seedActiveSession('sess-reset-1', 'default')
    await saveTradeAction({ sessionId: 'sess-reset-1', barIndex: 0, actionType: 'buy', price: 10, shares: 100 })
    await saveTradeAction({ sessionId: 'sess-reset-1', barIndex: 2, actionType: 'sell', price: 12, shares: 100, realizedPnl: 200 })
    await finishSession('sess-reset-1', 100200, 200, { profileId: 'default' })

    await resetProfileCapital('default', 500000)
    const p = (await listProfiles()).find((x) => x.id === 'default')!
    expect(p.current_capital).toBe(500000)
    expect(p.total_sessions).toBe(0)
    expect(p.total_pnl).toBe(0)
    expect(p.total_trades_count).toBe(0)
  })

  it('getProfileStats 返回 sessionTrend + dailyStats + profile', async () => {
    await seedActiveSession('sess-stats-1', 'default')
    await saveTradeAction({ sessionId: 'sess-stats-1', barIndex: 0, actionType: 'buy', price: 10, shares: 100 })
    await saveTradeAction({ sessionId: 'sess-stats-1', barIndex: 3, actionType: 'sell', price: 11, shares: 100, realizedPnl: 100 })
    await finishSession('sess-stats-1', 100100, 100, { profileId: 'default' })

    const stats = await getProfileStats('default')
    expect(stats).not.toBeNull()
    expect(stats!.profile.id).toBe('default')
    expect(stats!.sessionTrend.length).toBe(1)
    expect(stats!.sessionTrend[0].pnlPct).toBeCloseTo(0.1, 5)
    expect(stats!.dailyStats.length).toBeGreaterThan(0)
  })
})
