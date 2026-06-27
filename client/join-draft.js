import { getSocket } from './socket.js'
import { setHTML } from './dom.js'

function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal">
        <p class="modal-message">${message}</p>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-cancel">Cancelar</button>
          <button class="modal-btn modal-btn-confirm">Iniciar de todas formas</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    overlay.querySelector('.modal-btn-cancel').addEventListener('click', () => { overlay.remove(); resolve(false) })
    overlay.querySelector('.modal-btn-confirm').addEventListener('click', () => { overlay.remove(); resolve(true) })
  })
}

const PLAYER_COLORS = [
  '#e53935','#1e88e5','#43a047','#fb8c00',
  '#8e24aa','#00acc1','#f4511e','#795548',
  '#d81b60','#00897b','#fdd835','#3949ab',
  '#6d4c41','#546e7a','#c0ca33','#7b1fa2',
]

let _discordCtx = null
let _myId = null
let _pokemonAll = []
let _picks = []
let _pickOrder = []
let _currentPickIndex = 0
let _pickSearch = ''
let _pickTier = ''
let _pickPage = 1
const PICK_PAGE_SIZE = 30

export function init(discordCtx) {
  _discordCtx = discordCtx
  _myId = discordCtx.user.id
  _picks = []
  _pickOrder = []
  _currentPickIndex = 0
  _pickSearch = ''
  _pickTier = ''
  _pickPage = 1

  const socket = getSocket()
  const { sdk, user } = discordCtx

  socket.off('room-state')
  socket.emit('join-room', { instanceId: sdk.instanceId, user })
  socket.on('room-state', room => render(room))
}

function currentPickerId(pickOrder, idx) {
  if (!pickOrder?.length) return null
  const n = pickOrder.length
  const round = Math.floor(idx / n)
  const pos = idx % n
  return pickOrder[round % 2 === 0 ? pos : n - 1 - pos]?.id ?? null
}

function avatarHTML(user, size = 64) {
  const initial = (user.global_name || user.username || '?')[0].toUpperCase()
  if (user.avatar) {
    return `<img class="participant-avatar" src="/api/avatar/${user.id}/${user.avatar}" width="${size}" height="${size}" alt="${user.username}" loading="lazy" />`
  }
  return `<div class="participant-avatar participant-avatar-initials" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${initial}</div>`
}

// ── Main render (room-state handler) ─────────────────────────────────────────

function render(room) {
  const app = document.querySelector('#app')
  if (!app) return

  const phase = room.draft?.phase ?? 'lobby'

  // Sync picks state from server
  _picks = room.draft?.picks ?? []
  _pickOrder = room.draft?.pickOrder ?? []
  _currentPickIndex = room.draft?.currentPickIndex ?? 0

  // Bootstrap two-section layout on first render for this page visit
  if (!document.querySelector('#draft-top')) {
    app.innerHTML = `
      <div class="back-bar"><a class="back-link" href="#lobby">← Volver</a></div>
      <div id="draft-top"></div>
      <div id="draft-pokemon"></div>
    `
  }

  renderTop(room)

  const pokemonSection = document.querySelector('#draft-pokemon')
  if (phase === 'picking' && pokemonSection) {
    if (!pokemonSection.dataset.init) {
      // First time entering picking phase — initialize the picker
      pokemonSection.dataset.init = '1'
      if (_pokemonAll.length > 0) {
        renderPokemonPicker(pokemonSection)
      } else {
        initPokemonPicker(pokemonSection)
      }
    } else if (document.querySelector('#pick-results')) {
      // Picker already shown — refresh grid to reflect new picks/turn
      renderPickResults()
    }
  }
}

// ── Top section (player cards + banners + action) ─────────────────────────────

function renderTop(room) {
  const top = document.querySelector('#draft-top')
  if (!top) return

  const { sdk, user } = _discordCtx
  const isHost = room.host === user.id
  const draft = room.draft
  const phase = draft?.phase ?? 'lobby'
  const readyPlayers = draft?.readyPlayers ?? []
  const participants = (phase === 'picking' && draft.pickOrder?.length)
    ? draft.pickOrder
    : room.participants

  const currentId = phase === 'picking'
    ? currentPickerId(draft.pickOrder, draft.currentPickIndex ?? 0)
    : null

  const roundNum = (draft?.currentPickIndex != null && draft.pickOrder?.length)
    ? Math.floor(draft.currentPickIndex / draft.pickOrder.length) + 1
    : null

  const readyCount = room.participants.filter(p => readyPlayers.includes(p.id)).length
  const allReady = room.participants.length > 0 && readyCount === room.participants.length

  // ── Phase banner ────────────────────────────────────────────────────────────
  let phaseBanner = ''
  if (phase === 'picking' && currentId) {
    const picker = participants.find(p => p.id === currentId)
    const isMyTurn = currentId === user.id
    phaseBanner = `
      <div class="draft-phase-banner ${isMyTurn ? 'draft-phase-banner-me' : ''}">
        ${avatarHTML(picker, 36)}
        <span class="draft-phase-text">
          ${isMyTurn ? '¡Es tu turno de elegir!' : `Turno de <strong>${picker?.global_name || picker?.username}</strong>`}
        </span>
        <span class="draft-round-badge">Ronda ${roundNum}</span>
      </div>
    `
  }

  // ── Snake order bar ─────────────────────────────────────────────────────────
  let snakeInfo = ''
  if (phase === 'picking' && draft.pickOrder?.length) {
    const n = draft.pickOrder.length
    const isReversed = Math.floor((draft.currentPickIndex ?? 0) / n) % 2 !== 0
    const roundOrder = isReversed ? [...draft.pickOrder].reverse() : [...draft.pickOrder]
    const arrows = roundOrder.map((p, i) => {
      const active = p.id === currentId
      return `<span class="snake-name ${active ? 'snake-name-active' : ''}">${p.global_name || p.username}</span>${i < roundOrder.length - 1 ? '<span class="snake-arrow">→</span>' : ''}`
    }).join('')
    snakeInfo = `
      <div class="snake-order-bar">
        <span class="snake-label">Orden ronda ${roundNum}${isReversed ? ' (↩)' : ''}:</span>
        ${arrows}
      </div>
    `
  }

  // ── Player cards ────────────────────────────────────────────────────────────
  const cards = participants.map((p, i) => {
    const isCurrent = p.id === currentId
    const isMe = p.id === user.id
    const isReady = readyPlayers.includes(p.id)
    return `
      <div class="participant-card
        ${isCurrent ? ' participant-card-active' : ''}
        ${isMe ? ' participant-card-me' : ''}
        ${isReady && phase === 'lobby' ? ' participant-card-ready' : ''}">
        ${phase === 'picking' ? `<span class="pick-order-badge">${i + 1}</span>` : ''}
        ${isReady && phase === 'lobby' ? '<span class="ready-check">✓</span>' : ''}
        ${avatarHTML(p, 64)}
        <span class="participant-card-name">${p.global_name || p.username}${isMe ? ' (tú)' : ''}</span>
        ${isCurrent ? '<span class="picking-indicator">Eligiendo…</span>' : ''}
        ${isMe && phase === 'lobby' ? `
          <button class="ready-btn ${isReady ? 'ready-btn-on' : ''}" id="ready-btn">
            ${isReady ? '✓ Listo' : 'Estoy listo'}
          </button>` : ''}
      </div>
    `
  }).join('')

  // ── Action area ─────────────────────────────────────────────────────────────
  let actionArea = ''
  if (phase === 'lobby') {
    if (isHost) {
      actionArea = `
        <div class="start-area">
          <p class="ready-counter ${allReady ? 'ready-counter-ok' : ''}">${readyCount} / ${room.participants.length} listos</p>
          <button id="start-picks-btn" class="start-picks-btn">⚔️ Iniciar Picks</button>
        </div>
      `
    } else {
      actionArea = `<p class="waiting-msg">Esperando a que el host inicie los picks…</p>`
    }
  }

  setHTML(top, `
    <h1>${draft?.config?.name || 'Draft'}</h1>
    ${phaseBanner}
    ${snakeInfo}
    <div class="participant-cards">${cards}</div>
    ${actionArea}
  `)

  document.querySelector('#ready-btn')?.addEventListener('click', () => {
    getSocket().emit('toggle-ready', { instanceId: sdk.instanceId })
  })

  document.querySelector('#start-picks-btn')?.addEventListener('click', async () => {
    if (!allReady) {
      const notReady = room.participants
        .filter(p => !readyPlayers.includes(p.id))
        .map(p => p.global_name || p.username)
      const plural = notReady.length > 1
      const msg = `<strong>${notReady.join(', ')}</strong> no ${plural ? 'están listos' : 'está listo'}.<br>¿Iniciar los picks de todas formas?`
      const confirmed = await showConfirm(msg)
      if (!confirmed) return
    }
    getSocket().emit('start-picks', { instanceId: sdk.instanceId })
  })
}

// ── Pokemon picker (picking phase only) ──────────────────────────────────────

async function initPokemonPicker(container) {
  container.innerHTML = `<p class="loading" style="margin-top:2rem">Cargando Pokémon…</p>`
  try {
    const res = await fetch('/api/pokemon', { cache: 'no-store' })
    _pokemonAll = await res.json()
    renderPokemonPicker(container)
  } catch {
    container.innerHTML = `<p style="color:var(--red);margin-top:1rem">Error al cargar los Pokémon</p>`
  }
}

function getFilteredPokemon() {
  const q = _pickSearch.toLowerCase()
  return _pokemonAll.filter(p => {
    const matchName = !q || p.name.toLowerCase().includes(q)
    const matchTier = !_pickTier || p.tier === _pickTier
    return matchName && matchTier
  })
}

function typeBadges(types) {
  return types.map(t => `<span class="type-badge type-${t}">${t}</span>`).join('')
}

function tierBadge(value) {
  if (!value) return '<span class="tier-none">—</span>'
  return `<span class="tier-badge ${value}">${value}</span>`
}

function playerColor(userId) {
  const idx = _pickOrder.findIndex(p => p.id === userId)
  return idx >= 0 ? PLAYER_COLORS[idx % PLAYER_COLORS.length] : '#888'
}

function pickerDisplayName(userId) {
  const p = _pickOrder.find(p => p.id === userId)
  return p ? (p.global_name || p.username) : '?'
}

// Creates the picker controls shell once — search input is never destroyed during typing
function initPickerShell(container) {
  const tiers = [...new Set(_pokemonAll.map(p => p.tier).filter(Boolean))].sort()
  const tierOpts = tiers.map(t => `<option value="${t}">${t}</option>`).join('')

  container.innerHTML = `
    <div class="pick-pokemon-section">
      <div class="controls">
        <input id="pick-search" class="search-input" type="text" placeholder="Buscar por nombre…" />
        <select id="pick-tier" class="filter-select">
          <option value="">Todos los tiers</option>
          ${tierOpts}
        </select>
        <span id="pick-results-info" class="results-info" style="margin-left:auto"></span>
      </div>
      <div id="pick-results"></div>
    </div>
  `

  document.querySelector('#pick-search').addEventListener('input', e => {
    _pickSearch = e.target.value; _pickPage = 1; renderPickResults()
  })
  document.querySelector('#pick-tier').addEventListener('change', e => {
    _pickTier = e.target.value; _pickPage = 1; renderPickResults()
  })

  // Event delegation for picks — on container so it survives grid re-renders
  container.addEventListener('click', e => {
    const card = e.target.closest('.pokemon-card-pickable')
    if (!card) return
    getSocket().emit('pick-pokemon', {
      instanceId: _discordCtx.sdk.instanceId,
      pokemonId: parseInt(card.dataset.id),
      pokemonName: card.dataset.name,
      tier: card.dataset.tier || null,
    })
  })
}

// Only replaces the results grid — never touches the search input
function renderPickResults() {
  const filtered = getFilteredPokemon()
  const totalPages = Math.max(1, Math.ceil(filtered.length / PICK_PAGE_SIZE))
  if (_pickPage > totalPages) _pickPage = 1
  const page = filtered.slice((_pickPage - 1) * PICK_PAGE_SIZE, _pickPage * PICK_PAGE_SIZE)

  const infoEl = document.querySelector('#pick-results-info')
  if (infoEl) infoEl.textContent = `${filtered.length} Pokémon`

  const tierEl = document.querySelector('#pick-tier')
  if (tierEl && tierEl.value !== _pickTier) tierEl.value = _pickTier

  const container = document.querySelector('#pick-results')
  if (!container) return

  const currentId = currentPickerId(_pickOrder, _currentPickIndex)
  const isMyTurn = currentId === _myId

  container.innerHTML = `
    <div class="pokemon-grid">
      ${page.map(p => {
        const pick = _picks.find(pk => pk.pokemonId === p.id)
        const isPicked = !!pick
        const isPickable = isMyTurn && !isPicked
        const color = isPicked ? playerColor(pick.userId) : null

        const cls = `pokemon-card${isPicked ? ' pokemon-card-picked' : ''}${isPickable ? ' pokemon-card-pickable' : ''}`
        const style = isPicked ? `style="background:${color}28;border-color:${color}"` : ''
        const data = isPickable ? `data-id="${p.id}" data-name="${p.name}" data-tier="${p.tier || ''}"` : ''

        return `
          <div class="${cls}" ${style} ${data}>
            <div class="pokemon-card-sprite-wrap">
              <img src="/api/sprite/${p.id}" alt="${p.name}" width="72" height="72" />
              ${isPicked ? `<div class="pick-owner-badge" style="background:${color}">${pickerDisplayName(pick.userId)}</div>` : ''}
            </div>
            <div class="pokemon-card-name">${p.name}</div>
            <div class="pokemon-card-types">${typeBadges(p.types)}</div>
            <div class="pokemon-card-tier">${tierBadge(p.tier)}</div>
          </div>
        `
      }).join('')}
    </div>
    ${totalPages > 1 ? `
      <div class="pagination">
        <button id="pick-prev" ${_pickPage === 1 ? 'disabled' : ''}>← Anterior</button>
        <span class="page-info">Página ${_pickPage} de ${totalPages}</span>
        <button id="pick-next" ${_pickPage === totalPages ? 'disabled' : ''}>Siguiente →</button>
      </div>` : ''}
  `

  document.querySelector('#pick-prev')?.addEventListener('click', () => { _pickPage--; renderPickResults() })
  document.querySelector('#pick-next')?.addEventListener('click', () => { _pickPage++; renderPickResults() })
}

function renderPokemonPicker(container) {
  if (!document.querySelector('#pick-results')) {
    initPickerShell(container)
  }
  renderPickResults()
}
