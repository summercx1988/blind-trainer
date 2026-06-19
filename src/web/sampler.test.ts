import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fakeIndexedDB from 'fake-indexeddb'
import { initDb } from './dbLoader'
import { initBlindDb, markTrained } from './blindDb'
import { getRandomSamples } from './sampler'

;(globalThis as unknown as { indexedDB: typeof fakeIndexedDB }).indexedDB = fakeIndexedDB

const PACK_PATH = resolve(process.cwd(), 'public/data/builtin-100.sqlite')
const WASM_PATH = resolve(process.cwd(), 'public/sql-wasm.wasm')
const packBuffer = new Uint8Array(readFileSync(PACK_PATH))
const locateFile = () => `file://${WASM_PATH}`

beforeAll(async () => {
  await initDb({ packData: packBuffer, locateFile })
  await initBlindDb({ forceRefresh: true, locateFile })
}, 30000)

describe('sampler 零重复抽签', () => {
  it('能抽到样本（至少 1 个）', async () => {
    const samples = await getRandomSamples('mixed', 10, {
      maxBarsPerSymbol: 260,
      profileId: 'default',
    })
    expect(samples.length).toBeGreaterThan(0)
    expect(samples[0]).toHaveProperty('code')
    expect(samples[0]).toHaveProperty('klines')
    expect((samples[0] as { klines: unknown[] }).klines.length).toBeGreaterThan(0)
  })

  it('抽到的股票不重复出现（同批次无重复）', async () => {
    const samples = await getRandomSamples('mixed', 5, {
      maxBarsPerSymbol: 260,
      profileId: 'sampler-test-nodup',
    })
    const codes = samples.map((s) => (s as { code: string }).code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('已训练的股票会被排除', async () => {
    const firstBatch = await getRandomSamples('mixed', 3, {
      maxBarsPerSymbol: 260,
      profileId: 'sampler-test-exclude',
    })
    const firstCodes = firstBatch.map((s) => (s as { code: string }).code)
    for (const code of firstCodes) {
      await markTrained(code, 'sampler-test-exclude')
    }
    const secondBatch = await getRandomSamples('mixed', 3, {
      maxBarsPerSymbol: 260,
      profileId: 'sampler-test-exclude',
    })
    expect(secondBatch.length).toBeGreaterThan(0)
    const secondCodes = secondBatch.map((s) => (s as { code: string }).code)
    for (const code of firstCodes) {
      expect(secondCodes).not.toContain(code)
    }
  })

  it('minPrice 过滤生效', async () => {
    const samples = await getRandomSamples('mixed', 5, {
      maxBarsPerSymbol: 260,
      profileId: 'sampler-test-price',
      minPrice: 50,
    })
    for (const s of samples) {
      const klines = (s as { klines: Array<{ close: number }> }).klines
      const lastClose = klines[klines.length - 1]?.close ?? 0
      expect(lastClose).toBeGreaterThanOrEqual(50)
    }
  })
})
