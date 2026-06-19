import { describe, it, expect, beforeEach } from 'vitest'
import fakeIndexedDB from 'fake-indexeddb'
import { resolve } from 'node:path'
import {
  initBlindDb,
  saveSession,
  markTrained,
  getTrainedCodes,
  isBlindDbReady,
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
