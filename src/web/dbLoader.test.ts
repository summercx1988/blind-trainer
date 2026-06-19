import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fakeIndexedDB from 'fake-indexeddb'
import { initDb, queryKline, queryStockList } from './dbLoader'

// jsdom 不内置 IndexedDB，用 fake-indexeddb 注入到全局
;(globalThis as unknown as { indexedDB: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB

// 测试用 fs 直接读内置包（绕过 fetch，jsdom 无 origin）
// 用 process.cwd()（vitest 运行时为项目根），避免 import.meta.url 在 jsdom 下路径解析问题
const PACK_PATH = resolve(process.cwd(), 'public/data/builtin-100.sqlite')
const WASM_PATH = resolve(process.cwd(), 'public/sql-wasm.wasm')
const packBuffer = new Uint8Array(readFileSync(PACK_PATH))

describe('dbLoader 真实数据查询', () => {
  beforeAll(async () => {
    // jsdom 下 locateFile 默认指向 /（vite dev server 路径），测试改用 file:// 协议
    await initDb({
      packData: packBuffer,
      locateFile: () => `file://${WASM_PATH}`,
    })
  }, 30000)

  it('能查到股票列表（至少 1 只）', async () => {
    const stocks = await queryStockList(10)
    expect(stocks.length).toBeGreaterThan(0)
    expect(stocks[0]).toHaveProperty('code')
    expect(stocks[0]).toHaveProperty('name')
  })

  it('能查到指定股票的 K 线（至少 1 根）', async () => {
    const stocks = await queryStockList(1)
    const code = stocks[0].code as string
    const klines = await queryKline(code, 'daily', 120)
    expect(klines.length).toBeGreaterThan(0)
    expect(klines[0]).toHaveProperty('trade_date')
    expect(klines[0]).toHaveProperty('close')
  })

  it('不存在的股票返回空数组', async () => {
    const klines = await queryKline('NOTEXIST', 'daily', 10)
    expect(klines).toEqual([])
  })
})
