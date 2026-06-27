import { getSocket } from './socket.js'
import { setHTML, showConfirm } from './dom.js'

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
let _teamSize = 0
let _draftName = ''
let _tierSlots = {}
let _maxMegas = 0
let _viewingTeamOf = null   // userId whose team is shown in the grid, or null
let _pickSearch = ''
let _pickTier = ''
let _pickMegaFilter = false
let _pickPage = 1
const PICK_PAGE_SIZE = 30

export function init(discordCtx) {
  _discordCtx = discordCtx
  _myId = discordCtx.user.id
  _picks = []
  _pickOrder = []
  _currentPickIndex = 0
  _teamSize = 0
  _draftName = ''
  _tierSlots = {}
  _maxMegas = 0
  _viewingTeamOf = null
  _pickSearch = ''
  _pickTier = ''
  _pickMegaFilter = false
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
  _teamSize = room.draft?.config?.teamSize ?? 0
  _draftName = room.draft?.config?.name ?? ''
  _tierSlots = room.draft?.config?.tierSlots ?? {}
  _maxMegas  = room.draft?.config?.maxMegas  ?? 0

  // Draft finished — show results summary and stop
  if (phase === 'complete') {
    renderCompletedSummary()
    return
  }

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

// ── Draft complete summary ─────────────────────────────────────────────────────

function renderCompletedSummary() {
  const app = document.querySelector('#app')
  if (!app) return

  const teams = _pickOrder.map(player => ({
    ...player,
    pokemon: _picks
      .filter(pk => pk.userId === player.id)
      .sort((a, b) => a.pickOrder - b.pickOrder),
  }))

  app.innerHTML = `
    <div class="back-bar"><a class="back-link" href="#lobby">← Volver al lobby</a></div>
    <div class="draft-detail-header">
      <h1>${_draftName || 'Draft'}</h1>
      <div class="draft-detail-meta">
        <span class="draft-phase-chip draft-phase-chip-complete">Completado</span>
        <span>${teams.length} jugadores · ${_teamSize} Pokémon/equipo</span>
      </div>
    </div>
    <div class="team-cards">
      ${teams.map(t => {
        const color   = playerColor(t.id)
        const initial = (t.global_name || t.username || '?')[0].toUpperCase()
        const avatar  = t.avatar
          ? `<img class="participant-avatar" src="/api/avatar/${t.id}/${t.avatar}" width="36" height="36" alt="${t.username}" loading="lazy" />`
          : `<div class="participant-avatar participant-avatar-initials" style="width:36px;height:36px;font-size:14px;background:${color}">${initial}</div>`
        return `
          <div class="team-card" style="border-color:${color}">
            <div class="team-card-header" style="background:${color}18">
              ${avatar}
              <span class="team-card-name">${t.global_name || t.username}</span>
              <span class="team-card-count" style="color:${color}">${t.pokemon.length}/${_teamSize}</span>
            </div>
            <div class="team-pokemon-grid">
              ${t.pokemon.map(p => `
                <div class="team-pokemon-item">
                  <img src="/api/sprite/${p.pokemonId}" alt="${p.pokemonName}" width="56" height="56" />
                  <div class="team-pokemon-name">${p.pokemonName}</div>
                  ${p.tier ? `<span class="tier-badge ${p.tier}">${p.tier}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `
      }).join('')}
    </div>
  `
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
    const isCurrent  = p.id === currentId
    const isMe       = p.id === user.id
    const isReady    = readyPlayers.includes(p.id)
    const isViewing  = phase === 'picking' && _viewingTeamOf === p.id
    const isClickable = phase === 'picking'

    const color = isViewing ? playerColor(p.id) : null
    const viewStyle = isViewing
      ? `style="border-color:${color};box-shadow:0 0 0 4px ${color}28"`
      : ''

    return `
      <div class="participant-card
        ${isCurrent   ? ' participant-card-active'  : ''}
        ${isMe        ? ' participant-card-me'       : ''}
        ${isReady && phase === 'lobby' ? ' participant-card-ready' : ''}
        ${isClickable ? ' participant-card-clickable' : ''}
        ${isViewing   ? ' participant-card-viewing'  : ''}"
        data-user-id="${p.id}"
        ${viewStyle}>
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

  // Player card clicks — toggle team view for other players in picking phase
  if (phase === 'picking') {
    top.querySelectorAll('.participant-card-clickable[data-user-id]').forEach(card => {
      card.addEventListener('click', () => {
        const uid = card.dataset.userId
        _viewingTeamOf = (_viewingTeamOf === uid) ? null : uid
        // Update card highlight immediately without full re-render
        top.querySelectorAll('.participant-card[data-user-id]').forEach(c => {
          const isNowViewing = _viewingTeamOf === c.dataset.userId
          c.classList.toggle('participant-card-viewing', isNowViewing)
          if (isNowViewing) {
            const col = playerColor(c.dataset.userId)
            c.style.borderColor = col
            c.style.boxShadow = `0 0 0 4px ${col}28`
          } else {
            c.style.borderColor = ''
            c.style.boxShadow   = ''
          }
        })
        renderPickResults()
      })
    })
  }

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
      const confirmed = await showConfirm(msg, 'Iniciar de todas formas')
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
    const matchMega = !_pickMegaFilter || p.name.includes('-mega')
    return matchName && matchTier && matchMega
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
      <div id="pick-tier-slots"></div>
      <div id="pick-results"></div>
    </div>
  `

  document.querySelector('#pick-search').addEventListener('input', e => {
    _pickSearch = e.target.value; _pickPage = 1; renderPickResults()
  })
  document.querySelector('#pick-tier').addEventListener('change', e => {
    _pickTier = e.target.value; _pickMegaFilter = false; _pickPage = 1; renderPickResults()
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

function renderTierSlotsRow(userId, clickable = false) {
  const el = document.querySelector('#pick-tier-slots')
  if (!el) return

  const allowedTiers = Object.entries(_tierSlots).filter(([, max]) => max > 0)
  if (!allowedTiers.length && _maxMegas === 0) { el.innerHTML = ''; return }

  const playerPicks = _picks.filter(pk => pk.userId === userId)
  const byTier = {}
  for (const pk of playerPicks) {
    if (pk.tier) byTier[pk.tier] = (byTier[pk.tier] || 0) + 1
  }
  const megaCount = playerPicks.filter(pk => pk.pokemonName?.includes('-mega')).length

  el.innerHTML = `
    <div class="pick-tier-slots${clickable ? ' pick-tier-slots-interactive' : ''}">
      ${allowedTiers.map(([tier, max]) => {
        const used = byTier[tier] ?? 0
        const full = used >= max
        const active = _pickTier === tier
        return `
          <span class="pick-tier-chip${full ? ' pick-tier-chip-full' : ''}${active ? ' pick-tier-chip-active' : ''}" data-tier="${tier}">
            <span class="tier-badge ${tier}">${tier}</span>
            <span class="pick-tier-chip-count">${used}/${max}</span>
          </span>`
      }).join('')}
      ${_maxMegas > 0 ? `
        <span class="pick-tier-chip pick-tier-chip-mega${megaCount >= _maxMegas ? ' pick-tier-chip-full' : ''}${_pickMegaFilter ? ' pick-tier-chip-active' : ''}">
          <span class="tier-badge tier-mega">mega</span>
          <span class="pick-tier-chip-count">${megaCount}/${_maxMegas}</span>
        </span>` : ''}
    </div>
  `

  if (!clickable) return

  el.querySelectorAll('.pick-tier-chip[data-tier]').forEach(chip => {
    chip.addEventListener('click', () => {
      _pickTier = (_pickTier === chip.dataset.tier) ? '' : chip.dataset.tier
      _pickPage = 1
      const sel = document.querySelector('#pick-tier')
      if (sel) sel.value = _pickTier
      renderPickResults()
    })
  })

  const megaChip = el.querySelector('.pick-tier-chip-mega')
  if (megaChip) {
    megaChip.addEventListener('click', () => {
      _pickMegaFilter = !_pickMegaFilter
      _pickPage = 1
      renderPickResults()
    })
  }
}

// Only replaces the results grid — never touches the search input
function renderPickResults() {
  const container = document.querySelector('#pick-results')
  if (!container) return

  // ── Team view mode ──────────────────────────────────────────────────────────
  if (_viewingTeamOf) {
    renderTierSlotsRow(_viewingTeamOf, false)
    const playerPicks = _picks.filter(pk => pk.userId === _viewingTeamOf)
    const player = _pickOrder.find(p => p.id === _viewingTeamOf)
    const color  = playerColor(_viewingTeamOf)
    const name   = player?.global_name || player?.username || '?'
    const empty  = Math.max(0, _teamSize - playerPicks.length)

    const infoEl = document.querySelector('#pick-results-info')
    if (infoEl) infoEl.textContent = ''

    container.innerHTML = `
      <div class="team-view-banner" style="border-color:${color};background:${color}12">
        <span class="team-view-label">
          Equipo de <strong>${name}</strong>
          <span class="team-view-count" style="color:${color}">${playerPicks.length}/${_teamSize}</span>
        </span>
        <button class="team-view-close" id="team-view-close">✕ Cerrar</button>
      </div>
      <div class="pokemon-grid">
        ${playerPicks.map(pk => `
          <div class="pokemon-card">
            <div class="pokemon-card-sprite-wrap">
              <img src="/api/sprite/${pk.pokemonId}" alt="${pk.pokemonName}" width="72" height="72" />
            </div>
            <div class="pokemon-card-name">${pk.pokemonName}</div>
            <div class="pokemon-card-tier">${tierBadge(pk.tier)}</div>
          </div>
        `).join('')}
        ${Array.from({ length: empty }).map(() =>
          `<div class="pokemon-card pokemon-card-empty-slot"></div>`
        ).join('')}
        ${playerPicks.length === 0
          ? `<p class="empty-state" style="grid-column:1/-1;padding:2rem 0">Aún no ha elegido ningún Pokémon.</p>`
          : ''}
      </div>
    `

    document.querySelector('#team-view-close').addEventListener('click', () => {
      _viewingTeamOf = null
      // Remove highlight from all player cards without re-rendering the top section
      document.querySelectorAll('.participant-card[data-user-id]').forEach(c => {
        c.classList.remove('participant-card-viewing')
        c.style.borderColor = ''
        c.style.boxShadow   = ''
      })
      renderPickResults()
    })
    return
  }

  // ── Normal grid mode ────────────────────────────────────────────────────────
  renderTierSlotsRow(_myId, true)
  const filtered = getFilteredPokemon()
  const totalPages = Math.max(1, Math.ceil(filtered.length / PICK_PAGE_SIZE))
  if (_pickPage > totalPages) _pickPage = 1
  const page = filtered.slice((_pickPage - 1) * PICK_PAGE_SIZE, _pickPage * PICK_PAGE_SIZE)

  const infoEl = document.querySelector('#pick-results-info')
  if (infoEl) infoEl.textContent = `${filtered.length} Pokémon`

  const tierEl = document.querySelector('#pick-tier')
  if (tierEl && tierEl.value !== _pickTier) tierEl.value = _pickTier

  const currentId = currentPickerId(_pickOrder, _currentPickIndex)
  const isMyTurn  = currentId === _myId

  // Compute my tier usage for restriction checks
  const myPicksByTier = {}
  let myMegaCount = 0
  if (isMyTurn) {
    for (const pk of _picks.filter(pk => pk.userId === _myId)) {
      if (pk.tier) myPicksByTier[pk.tier] = (myPicksByTier[pk.tier] || 0) + 1
      if (pk.pokemonName?.includes('-mega')) myMegaCount++
    }
  }

  container.innerHTML = `
    <div class="pokemon-grid">
      ${page.map(p => {
        const pick = _picks.find(pk => pk.pokemonId === p.id)
        const isPicked = !!pick
        const color    = isPicked ? playerColor(pick.userId) : null

        const isMega      = p.name.includes('-mega')
        const tierLimit   = _tierSlots[p.tier] ?? 0
        const tierFull    = (myPicksByTier[p.tier] ?? 0) >= tierLimit
        const megaFull    = isMega && myMegaCount >= _maxMegas
        const isDisabled  = isMyTurn && !isPicked && (tierFull || megaFull)
        const isPickable  = isMyTurn && !isPicked && !isDisabled

        const cls   = `pokemon-card${isPicked ? ' pokemon-card-picked' : ''}${isPickable ? ' pokemon-card-pickable' : ''}${isDisabled ? ' pokemon-card-disabled' : ''}`
        const style = isPicked ? `style="background:${color}28;border-color:${color}"` : ''
        const data  = isPickable ? `data-id="${p.id}" data-name="${p.name}" data-tier="${p.tier || ''}"` : ''

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
