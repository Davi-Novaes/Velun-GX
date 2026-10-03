import { useState } from 'react'
export function IconPicker({ value, onChange }: { value: string | null; onChange: (icon: string | null) => void }) {
  const [error, setError] = useState('')
  async function select(file: File | undefined) {
    if (!file) return
    setError('')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Escolha PNG, JPEG ou WebP de até 5 MB.'); return }
    let bitmap: ImageBitmap | undefined
    try {
      bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96
      const context = canvas.getContext('2d')!
      const side = Math.min(bitmap.width, bitmap.height)
      context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 96, 96)
      const icon = canvas.toDataURL('image/png')
      if (icon.length > 90000) throw new Error('Imagem muito grande.')
      onChange(icon)
    } catch { setError('Não foi possível abrir essa imagem.') } finally { bitmap?.close() }
  }
  return <div className="icon-picker"><label className="field-label" htmlFor="server-icon-file">Ícone (opcional)</label><div>{value && <img src={value} alt="Prévia do ícone" width={48} height={48} />}<input id="server-icon-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void select(e.target.files?.[0])} />{value && <button className="subtle-button" type="button" onClick={() => onChange(null)}>Remover ícone</button>}</div>{error && <p role="alert" className="error-text">{error}</p>}</div>
}
