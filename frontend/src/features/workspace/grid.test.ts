import { describe, expect, it } from 'vitest'
import { fitGrid } from './grid'
describe('grade automática', () => {
  it.each([1, 2, 3, 4, 5, 8, 20])('cabe sem distorcer %s transmissões', (count) => {
    const l = fitGrid(count, 1000, 600)
    expect(l.width / l.height).toBeCloseTo(16 / 9)
    expect(l.width * l.columns + 16 * (l.columns - 1)).toBeLessThanOrEqual(1000.001)
    const rows = Math.ceil(count / l.columns)
    expect(l.height * rows + 16 * (rows - 1)).toBeLessThanOrEqual(600.001)
  })
  it('reage ao formato da área, sem fixar duas colunas', () => {
    expect(fitGrid(2, 1200, 400).columns).toBe(2)
    expect(fitGrid(2, 400, 800).columns).toBe(1)
    expect(fitGrid(1, 1200, 800).columns).toBe(1)
  })
  it('tolera montagem sem dimensões ou streams', () => { expect(fitGrid(0, 100, 100).width).toBe(0); expect(fitGrid(4, 0, 0).width).toBe(0) })
})
