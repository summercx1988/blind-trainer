import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fakeIndexedDB from 'fake-indexeddb'
import { createWebApi } from './webApi'

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

  it('db.finishSession 返回 success:true', async () => {
    const result = await api.db.finishSession('sess-test', 100000, 0, {}) as { success: boolean }
    expect(result.success).toBe(true)
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
