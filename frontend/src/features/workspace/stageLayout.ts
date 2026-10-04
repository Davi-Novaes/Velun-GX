// Posição e tamanho de cada transmissão no palco. Função pura: o componente só aplica os retângulos,
// assim trocar Grade/Destaque ou o stream principal não recria vídeo nem conexão — apenas move os tiles.

export type ViewMode = 'grid' | 'focus'
export type TileRole = 'grid' | 'main' | 'thumb'

export interface TileRect {
  left: number
  top: number
  width: number
  height: number
  role: TileRole
}

export interface StageInput {
  ids: string[]
  mode: ViewMode
  focusedId: string | null
  width: number
  height: number
  /** Proporção real (largura/altura) de cada transmissão, quando já conhecida. Padrão 16:9. */
  aspects?: Record<string, number>
}

export const STAGE_ASPECT = 16 / 9
const GRID_GAP = 12
const FOCUS_GAP = 12
const STRIP_GAP = 10

/** Maior retângulo com a proporção dada que cabe na área, sem cortar nem distorcer. */
export function fitRect(aspect: number, width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const byWidth = { width, height: width / aspect }
  return byWidth.height <= height ? byWidth : { width: height * aspect, height }
}

/**
 * Colunas da grade. Até 4 transmissões em área deitada segue o padrão fixo (1 | 2 lado a lado | 2+1 | 2+2);
 * acima disso, ou em área em pé (celular), escolhe a disposição que deixa cada vídeo maior.
 */
export function gridColumns(count: number, width: number, height: number): number {
  if (count <= 1) return 1
  if (count <= 4 && width >= height) return 2
  let best = { columns: 1, size: 0 }
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    const tile = fitRect(STAGE_ASPECT, (width - GRID_GAP * (columns - 1)) / columns, (height - GRID_GAP * (rows - 1)) / rows)
    if (tile.width > best.size) best = { columns, size: tile.width }
  }
  return best.columns
}

function clampAspect(aspect: number | undefined): number {
  return aspect && Number.isFinite(aspect) ? Math.min(3.6, Math.max(1, aspect)) : STAGE_ASPECT
}

function gridLayout(ids: string[], width: number, height: number): Record<string, TileRect> {
  const columns = gridColumns(ids.length, width, height)
  const rows = Math.ceil(ids.length / columns)
  const tile = fitRect(STAGE_ASPECT, (width - GRID_GAP * (columns - 1)) / columns, (height - GRID_GAP * (rows - 1)) / rows)
  const top0 = (height - (rows * tile.height + (rows - 1) * GRID_GAP)) / 2
  const result: Record<string, TileRect> = {}
  ids.forEach((id, index) => {
    const row = Math.floor(index / columns)
    const inRow = Math.min(columns, ids.length - row * columns)
    // a última linha incompleta fica centralizada
    const left0 = (width - (inRow * tile.width + (inRow - 1) * GRID_GAP)) / 2
    result[id] = { left: left0 + (index % columns) * (tile.width + GRID_GAP), top: top0 + row * (tile.height + GRID_GAP), width: tile.width, height: tile.height, role: 'grid' }
  })
  return result
}

function focusLayout(ids: string[], focusedId: string, width: number, height: number, aspects: Record<string, number>): Record<string, TileRect> {
  const others = ids.filter((id) => id !== focusedId)
  const aspect = clampAspect(aspects[focusedId])
  const result: Record<string, TileRect> = {}
  if (!others.length) {
    const main = fitRect(aspect, width, height)
    result[focusedId] = { left: (width - main.width) / 2, top: (height - main.height) / 2, ...main, role: 'main' }
    return result
  }
  // miniaturas 16:9 numa fileira; diminuem para caber na largura em vez de criar rolagem
  let thumbHeight = Math.round(Math.min(132, Math.max(64, height * 0.16)))
  let thumbWidth = thumbHeight * STAGE_ASPECT
  const stripFull = others.length * thumbWidth + (others.length - 1) * STRIP_GAP
  if (stripFull > width) {
    thumbWidth = (width - (others.length - 1) * STRIP_GAP) / others.length
    thumbHeight = thumbWidth / STAGE_ASPECT
  }
  const main = fitRect(aspect, width, height - thumbHeight - FOCUS_GAP)
  // vídeo principal e fileira ficam juntos, centralizados na vertical (sem faixa vazia entre eles)
  const top0 = Math.max(0, (height - (main.height + FOCUS_GAP + thumbHeight)) / 2)
  result[focusedId] = { left: (width - main.width) / 2, top: top0, ...main, role: 'main' }
  const stripWidth = others.length * thumbWidth + (others.length - 1) * STRIP_GAP
  const stripLeft = (width - stripWidth) / 2
  const stripTop = top0 + main.height + FOCUS_GAP
  others.forEach((id, index) => {
    result[id] = { left: stripLeft + index * (thumbWidth + STRIP_GAP), top: stripTop, width: thumbWidth, height: thumbHeight, role: 'thumb' }
  })
  return result
}

/** No modo destaque, focusedId define o principal; na grade ele é ignorado. */
export function computeStageLayout({ ids, mode, focusedId, width, height, aspects = {} }: StageInput): Record<string, TileRect> {
  if (!ids.length || width <= 0 || height <= 0) return {}
  if (mode === 'focus') {
    const main = focusedId && ids.includes(focusedId) ? focusedId : ids[0]!
    return focusLayout(ids, main, width, height, aspects)
  }
  return gridLayout(ids, width, height)
}
