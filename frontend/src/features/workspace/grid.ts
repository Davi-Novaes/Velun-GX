/** Busca todas as disposições, maximizando a área de vídeo sem cortar ou distorcer. */
export function fitGrid(count: number, width: number, height: number, aspect = 16 / 9, gap = 16, chrome = 0) {
  if (count < 1 || width <= 0 || height <= 0) return { columns: 1, width: 0, height: 0 }
  let best = { columns: 1, width: 0, height: 0 }
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns)
    const tileWidth = Math.max(0, Math.min((width - gap * (columns - 1)) / columns, ((height - gap * (rows - 1)) / rows - chrome) * aspect))
    if (tileWidth > best.width) best = { columns, width: tileWidth, height: tileWidth / aspect }
  }
  return best
}
