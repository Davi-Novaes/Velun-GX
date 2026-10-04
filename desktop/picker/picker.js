// Seletor do Velun Gx (sem Node; só a ponte window.velunPicker).
const grid = document.getElementById('grid')
const go = document.getElementById('go')
const hint = document.getElementById('hint')
const tabs = { screen: document.getElementById('tab-screen'), window: document.getElementById('tab-window') }
let kind = 'screen'
let sources = []
let selected = null

const HINTS = {
  screen: 'O áudio da tela é compartilhado automaticamente. Quem assiste controla o volume.',
  window: 'O áudio do aplicativo é compartilhado automaticamente, quando disponível.',
}

function displayName(source) {
  if (source.kind !== 'screen') return source.name
  return source.name.replace(/^Entire screen$/i, 'Tela inteira').replace(/^Screen (\d+)$/i, 'Tela $1')
}

function render() {
  const list = sources.filter((s) => s.kind === kind)
  grid.replaceChildren()
  if (!list.length) {
    const p = document.createElement('p')
    p.className = 'empty'
    p.textContent = kind === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta para transmitir.'
    grid.append(p)
  }
  for (const source of list) {
    const card = document.createElement('button')
    card.className = 'card'
    card.dataset.id = source.id
    card.setAttribute('role', 'option')
    card.setAttribute('aria-selected', String(source.id === selected))
    const thumb = document.createElement('img')
    thumb.className = 'thumb'
    thumb.src = source.thumbnail
    thumb.alt = ''
    const label = document.createElement('span')
    label.className = 'label'
    if (source.icon) {
      const icon = document.createElement('img')
      icon.src = source.icon
      icon.alt = ''
      label.append(icon)
    }
    const name = document.createElement('span')
    name.textContent = displayName(source)
    name.title = source.name
    label.append(name)
    card.append(thumb, label)
    card.addEventListener('click', () => { selected = source.id; update() })
    card.addEventListener('dblclick', () => window.velunPicker.choose(source.id))
    grid.append(card)
  }
  hint.textContent = HINTS[kind]
}

function update() {
  for (const card of grid.querySelectorAll('.card')) card.setAttribute('aria-selected', String(card.dataset.id === selected))
  go.disabled = !sources.some((s) => s.id === selected)
}

function setKind(next) {
  kind = next
  for (const [key, tab] of Object.entries(tabs)) tab.setAttribute('aria-selected', String(key === next))
  render()
  update()
}

async function refresh() {
  sources = await window.velunPicker.sources()
  // com uma tela só, ela já vem selecionada
  const screens = sources.filter((s) => s.kind === 'screen')
  if (!selected && screens.length === 1) selected = screens[0].id
  render()
  update()
}

tabs.screen.addEventListener('click', () => setKind('screen'))
tabs.window.addEventListener('click', () => setKind('window'))
go.addEventListener('click', () => { if (selected) window.velunPicker.choose(selected) })
document.getElementById('cancel').addEventListener('click', () => window.velunPicker.choose(null))
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.velunPicker.choose(null)
  if (event.key === 'Enter' && selected) window.velunPicker.choose(selected)
})

void refresh()
// miniaturas atualizadas enquanto o seletor está aberto
setInterval(() => { void refresh() }, 3000)
