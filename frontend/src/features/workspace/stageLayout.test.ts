import { describe, expect, it } from 'vitest'
import { computeStageLayout, fitRect, gridColumns, type TileRect } from './stageLayout'

const W = 1600, H = 900
const rows = (layout: Record<string, TileRect>) => [...new Set(Object.values(layout).map((r) => Math.round(r.top)))].length
const inside = (r: TileRect) => r.left >= -0.5 && r.top >= -0.5 && r.left + r.width <= W + 0.5 && r.top + r.height <= H + 0.5

describe('palco: grade', () => {
  it('segue o padrão 1 | 2 lado a lado | 2+1 | 2+2', () => {
    expect(gridColumns(1, W, H)).toBe(1)
    expect(gridColumns(2, W, H)).toBe(2)
    expect(gridColumns(3, W, H)).toBe(2)
    expect(gridColumns(4, W, H)).toBe(2)
    const three = computeStageLayout({ ids: ['a', 'b', 'c'], mode: 'grid', focusedId: null, width: W, height: H })
    expect(rows(three)).toBe(2)
    // a terceira fica centralizada sozinha na segunda linha
    expect(three.c!.left + three.c!.width / 2).toBeCloseTo(W / 2)
  })

  it('mantém 16:9, não corta e não ultrapassa a área', () => {
    for (const count of [1, 2, 3, 4, 5, 7]) {
      const layout = computeStageLayout({ ids: [...'abcdefg'].slice(0, count), mode: 'grid', focusedId: null, width: W, height: H })
      for (const rect of Object.values(layout)) {
        expect(rect.width / rect.height).toBeCloseTo(16 / 9)
        expect(inside(rect)).toBe(true)
      }
    }
  })

  it('em tela em pé (celular) empilha quando isso deixa o vídeo maior', () => {
    expect(gridColumns(2, 390, 700)).toBe(1)
  })

  it('o foco escolhido não muda a grade', () => {
    const a = computeStageLayout({ ids: ['a', 'b'], mode: 'grid', focusedId: 'b', width: W, height: H })
    const b = computeStageLayout({ ids: ['a', 'b'], mode: 'grid', focusedId: null, width: W, height: H })
    expect(a).toEqual(b)
  })
})

describe('palco: destaque', () => {
  it('a transmissão principal ocupa quase todo o palco e as outras viram miniaturas embaixo', () => {
    const layout = computeStageLayout({ ids: ['a', 'b', 'eu'], mode: 'focus', focusedId: 'b', width: W, height: H })
    expect(layout.b!.role).toBe('main')
    expect(layout.a!.role).toBe('thumb')
    expect(layout.eu!.role).toBe('thumb')
    expect(layout.b!.height).toBeGreaterThan(H * 0.75)
    expect(layout.a!.top).toBeGreaterThan(layout.b!.top + layout.b!.height)
    expect(layout.a!.width / layout.a!.height).toBeCloseTo(16 / 9)
    for (const rect of Object.values(layout)) expect(inside(rect)).toBe(true)
  })

  it('usa a proporção real da transmissão principal (ultrawide não fica com faixas)', () => {
    const layout = computeStageLayout({ ids: ['a'], mode: 'focus', focusedId: 'a', width: 2560, height: 900, aspects: { a: 32 / 9 } })
    expect(layout.a!.width / layout.a!.height).toBeCloseTo(32 / 9)
    expect(layout.a!.width).toBeCloseTo(2560)
  })

  it('sozinha, ocupa o maior retângulo possível e fica centralizada', () => {
    const layout = computeStageLayout({ ids: ['a'], mode: 'focus', focusedId: 'a', width: W, height: H })
    expect(layout.a).toMatchObject({ width: W, height: 900, left: 0, top: 0 })
  })

  it('muitas miniaturas diminuem para caber na largura, sem rolagem', () => {
    const ids = ['m', 't1', 't2', 't3', 't4', 't5']
    const layout = computeStageLayout({ ids, mode: 'focus', focusedId: 'm', width: 500, height: 800 })
    for (const rect of Object.values(layout)) expect(rect.left + rect.width).toBeLessThanOrEqual(500.5)
  })

  it('sem foco válido, destaca a primeira', () => {
    const layout = computeStageLayout({ ids: ['a', 'b'], mode: 'focus', focusedId: 'sumiu', width: W, height: H })
    expect(layout.a!.role).toBe('main')
  })

  it('fitRect nunca corta', () => {
    expect(fitRect(16 / 9, 1000, 100)).toEqual({ width: 100 * 16 / 9, height: 100 })
    expect(fitRect(16 / 9, 0, 100)).toEqual({ width: 0, height: 0 })
  })
})
