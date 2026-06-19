import { describe, it, expect, beforeEach } from 'vitest'
import fakeIndexedDB from 'fake-indexeddb'
import { saveSnapshot, loadSnapshot, clearSnapshot } from './idb'

// jsdom 不内置 IndexedDB，用 fake-indexeddb 注入到全局
;(globalThis as unknown as { indexedDB: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB

const DB_NAME = 'blind-trainer-test'
const STORE = 'kv'
const KEY = 'test-db'

describe('idb snapshot 存取', () => {
  beforeEach(async () => {
    await clearSnapshot(DB_NAME, STORE, KEY)
  })

  it('存入 Uint8Array 后能取回相同数据', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    await saveSnapshot(DB_NAME, STORE, KEY, data)
    const loaded = await loadSnapshot(DB_NAME, STORE, KEY)
    expect(loaded).not.toBeNull()
    expect(Array.from(loaded!)).toEqual([1, 2, 3, 4, 5])
  })

  it('未存入时返回 null', async () => {
    const loaded = await loadSnapshot(DB_NAME, STORE, KEY)
    expect(loaded).toBeNull()
  })

  it('clearSnapshot 后数据消失', async () => {
    const data = new Uint8Array([9, 9, 9])
    await saveSnapshot(DB_NAME, STORE, KEY, data)
    await clearSnapshot(DB_NAME, STORE, KEY)
    const loaded = await loadSnapshot(DB_NAME, STORE, KEY)
    expect(loaded).toBeNull()
  })
})
