import { getSocket } from './socket.js'
import { setHTML } from './dom.js'

const TIERS = ['Ubers', 'OU', 'UUBL', 'UU', 'RUBL', 'RU', 'NUBL', 'NU', 'PUBL', 'PU', 'ZU', 'NFE', 'LC']
const AUCTION_BUDGET_MULTIPLIER = 10

const DRAFT_TYPES = [
  { id: 'clasico',  icon: '🐍', name: 'Clásico',  desc: 'Snake draft por turnos' },
  { id: 'subasta',  icon: '🔨', name: 'Subasta',   desc: 'Pujas en tiempo real'  },
  { id: 'puntos',   icon: '⭐', name: 'Puntos',    desc: 'Coste de puntos por tier' },
]

const state = {
  draftType: 'clasico',
  name: '',
  teamSize: 6,
  // Subasta-specific
  minTeamSize: 3,
  maxTeamSize: 6,
  minBid: 3000,
  auctionTimer: 10,
  coins: 100,
  maxMegas: 0,
  tierSlots: Object.fromEntries(TIERS.map(t => [t, 0])),
  tierCosts: Object.fromEntries(TIERS.map(t => [t, 0])),
  presetId: null,
  presets: [],        // loaded from API when type = puntos
  presetsLoaded: false,
}

let _discordCtx = null

function tierTotal() {
  return Object.values(state.tierSlots).reduce((a, b) => a + b, 0)
}

function isValid() {
  if (state.draftType === 'subasta') {
    return state.minTeamSize >= 1
      && state.maxTeamSize >= state.minTeamSize
      && state.minBid >= 1
      && state.coins >= state.minBid * state.minTeamSize
  }
  if (state.draftType === 'puntos') return !!state.presetId
  return tierTotal() === state.teamSize
}


function render() {
  const total = tierTotal()
  const valid = isValid()
  const showTierSlots = state.draftType !== 'subasta'

  const tierRows = TIERS.map(t => `
    <div class="tier-slot-row">
      <span class="tier-badge ${t}">${t}</span>
      <input
        type="range"
        class="tier-slot-input"
        data-tier="${t}"
        min="0"
        max="${state.teamSize}"
        value="${state.tierSlots[t]}"
      />
      <span class="tier-slot-val">${state.tierSlots[t]}</span>
    </div>
  `).join('')

  const suggestedBudget = state.maxTeamSize * state.minBid * AUCTION_BUDGET_MULTIPLIER
  const budgetValid = state.coins >= state.minBid * state.minTeamSize
  const subastaConfigHTML = state.draftType === 'subasta' ? `
    <div class="form-row" style="grid-template-columns:1fr 1fr">
      <div class="form-group">
        <label class="form-label">Pokémon mínimo por equipo</label>
        <input id="min-team-size" class="form-input" type="number" min="1" max="18" value="${state.minTeamSize}" />
      </div>
      <div class="form-group">
        <label class="form-label">Pokémon máximo por equipo</label>
        <input id="max-team-size" class="form-input" type="number" min="1" max="18" value="${state.maxTeamSize}" />
      </div>
    </div>
    <div class="form-row" style="grid-template-columns:1fr 1fr">
      <div class="form-group">
        <label class="form-label">Puja mínima</label>
        <input id="min-bid" class="form-input" type="number" min="1" value="${state.minBid}" />
      </div>
      <div class="form-group">
        <label class="form-label">Temporizador (segundos)</label>
        <input id="auction-timer" class="form-input" type="number" min="5" max="600" value="${state.auctionTimer}" />
      </div>
    </div>
    <div class="form-group">
      <div class="form-label-row">
        <label class="form-label">Presupuesto por jugador</label>
        <span class="form-hint" style="font-size:0.78rem;color:rgba(0,0,0,0.4)">Sugerido: ${suggestedBudget.toLocaleString()}</span>
      </div>
      <input id="coins" class="form-input" type="number" min="0" value="${state.coins}" />
      ${!budgetValid ? `<span style="font-size:0.78rem;color:#cc0000">Debe ser ≥ puja mínima × mín. pokémon (${(state.minBid * state.minTeamSize).toLocaleString()})</span>` : ''}
    </div>
  ` : ''

  const completedPresets = state.presets.filter(p => p.status === 'completed')
  const presetSelectorHTML = state.draftType === 'puntos' ? `
    <div class="form-group">
      <label class="form-label">Preset de Puntos</label>
      ${completedPresets.length === 0 ? `
        <p class="preset-empty-hint">
          No hay presets completados.
          <a href="#presets">Crear un preset</a> antes de crear el draft.
        </p>
      ` : `
        <div class="preset-selector">
          ${completedPresets.map(p => `
            <label class="preset-selector-card ${state.presetId === p.id ? 'preset-selector-card-active' : ''}">
              <input type="radio" name="preset" value="${p.id}" ${state.presetId === p.id ? 'checked' : ''} style="display:none" />
              <span class="preset-card-name">${p.name}</span>
              <span class="preset-card-meta">Máx: ${p.max_points} pts</span>
            </label>
          `).join('')}
        </div>
      `}
    </div>
  ` : ''

  const typeCards = DRAFT_TYPES.map(dt => `
    <button class="draft-type-card ${state.draftType === dt.id ? 'draft-type-card-active' : ''}" data-type="${dt.id}" type="button">
      <span class="draft-type-icon">${dt.icon}</span>
      <span class="draft-type-name">${dt.name}</span>
      <span class="draft-type-desc">${dt.desc}</span>
    </button>
  `).join('')

  setHTML(document.querySelector('#app'), `
    <div class="back-bar">
      <a class="back-link" href="#lobby">← Volver</a>
    </div>
    <h1>Pokémon Draft</h1>
    <div class="draft-form">
      <h2 class="draft-form-title">Crear Draft</h2>

      <div class="form-group">
        <label class="form-label">Tipo de draft</label>
        <div class="draft-type-selector">${typeCards}</div>
      </div>

      <div class="form-group">
        <label class="form-label">Nombre del Draft</label>
        <input id="draft-name" class="form-input" type="text" maxlength="40" placeholder="Ej: Liga de Tontopollas de España" value="${state.name}" />
      </div>

      ${state.draftType === 'subasta' ? subastaConfigHTML : state.draftType === 'puntos' ? `
        <div class="form-row" style="grid-template-columns:1fr 1fr 1fr">
          <div class="form-group">
            <label class="form-label">Pokémon por equipo</label>
            <input id="team-size" class="form-input" type="number" min="1" max="18" value="${state.teamSize}" />
          </div>
          <div class="form-group">
            <label class="form-label">Presupuesto de puntos</label>
            <input id="coins" class="form-input" type="number" min="0" value="${state.coins}" />
          </div>
          <div class="form-group">
            <label class="form-label">Megaevoluciones máx.</label>
            <input id="max-megas" class="form-input" type="number" min="0" max="${state.teamSize}" value="${state.maxMegas}" />
          </div>
        </div>
      ` : `
        <div class="form-row" style="grid-template-columns:1fr 1fr">
          <div class="form-group">
            <label class="form-label">Pokémon por equipo</label>
            <input id="team-size" class="form-input" type="number" min="1" max="18" value="${state.teamSize}" />
          </div>
          <div class="form-group">
            <label class="form-label">Megaevoluciones máx.</label>
            <input id="max-megas" class="form-input" type="number" min="0" max="${state.teamSize}" value="${state.maxMegas}" />
          </div>
        </div>
      `}

      ${presetSelectorHTML}

      ${showTierSlots ? `
        <div class="form-group">
          <div class="form-label-row">
            <label class="form-label">Pokémon por tier</label>
            <span class="tier-counter ${valid ? 'tier-counter-ok' : 'tier-counter-err'}">
              ${total} / ${state.teamSize}
            </span>
          </div>
          <div class="tier-progress-wrap">
            <div class="tier-progress-bar">
              <div class="tier-progress-fill" style="
                width: ${Math.min(100, state.teamSize > 0 ? (total / state.teamSize) * 100 : 0)}%;
                background: ${valid ? '#2e7d32' : total > state.teamSize ? '#cc0000' : '#f9a825'};
              "></div>
            </div>
          </div>
          <div class="tier-slots-grid">${tierRows}</div>
        </div>
      ` : ''}

      <button id="create-btn" class="create-btn" ${!valid ? 'disabled' : ''}>
        Crear Draft
      </button>
    </div>
  `)

  // Type selector
  document.querySelectorAll('.draft-type-card').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.draftType = btn.dataset.type
      if (state.draftType === 'subasta') {
        state.coins = state.maxTeamSize * state.minBid * AUCTION_BUDGET_MULTIPLIER
      }
      if (state.draftType === 'puntos' && !state.presetsLoaded) {
        const { sdk } = _discordCtx
        state.presets = await fetch(`/api/presets?instanceId=${encodeURIComponent(sdk.instanceId)}`).then(r => r.json())
        state.presetsLoaded = true
      }
      render()
    })
  })

  // Preset radio buttons
  document.querySelectorAll('input[name="preset"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.presetId = parseInt(radio.value)
      document.querySelector('#create-btn').disabled = !isValid()
      document.querySelectorAll('.preset-selector-card').forEach(c => c.classList.remove('preset-selector-card-active'))
      radio.closest('.preset-selector-card').classList.add('preset-selector-card-active')
    })
  })

  document.querySelector('#draft-name').addEventListener('input', e => {
    state.name = e.target.value
  })

  document.querySelector('#team-size')?.addEventListener('input', e => {
    state.teamSize = Math.max(1, parseInt(e.target.value) || 1)
    document.querySelectorAll('.tier-slot-input').forEach(input => { input.max = state.teamSize })
    const megasInput = document.querySelector('#max-megas')
    if (megasInput) megasInput.max = state.teamSize
    const total = tierTotal()
    const counter = document.querySelector('.tier-counter')
    if (counter) {
      counter.textContent = `${total} / ${state.teamSize}`
      counter.className = `tier-counter ${total === state.teamSize ? 'tier-counter-ok' : 'tier-counter-err'}`
    }
    const fill = document.querySelector('.tier-progress-fill')
    if (fill) {
      const pct = state.teamSize > 0 ? Math.min(100, (total / state.teamSize) * 100) : 0
      fill.style.width = `${pct}%`
      fill.style.background = total === state.teamSize ? '#2e7d32' : total > state.teamSize ? '#cc0000' : '#f9a825'
    }
    const btn = document.querySelector('#create-btn')
    if (btn) btn.disabled = !isValid()
  })

  document.querySelector('#coins')?.addEventListener('input', e => {
    state.coins = Math.max(0, parseInt(e.target.value) || 0)
  })

  document.querySelector('#max-megas')?.addEventListener('input', e => {
    state.maxMegas = Math.max(0, parseInt(e.target.value) || 0)
  })

  document.querySelectorAll('.tier-slot-input').forEach(input => {
    input.addEventListener('input', e => {
      const val = parseInt(e.target.value) || 0
      state.tierSlots[e.target.dataset.tier] = val
      const valSpan = e.target.nextElementSibling
      if (valSpan) valSpan.textContent = val
      const total = tierTotal()
      const counter = document.querySelector('.tier-counter')
      if (counter) {
        counter.textContent = `${total} / ${state.teamSize}`
        counter.className = `tier-counter ${total === state.teamSize ? 'tier-counter-ok' : 'tier-counter-err'}`
      }
      const fill = document.querySelector('.tier-progress-fill')
      if (fill) {
        const pct = state.teamSize > 0 ? Math.min(100, (total / state.teamSize) * 100) : 0
        const ok = total === state.teamSize
        fill.style.width = `${pct}%`
        fill.style.background = ok ? '#2e7d32' : total > state.teamSize ? '#cc0000' : '#f9a825'
      }
      const btn = document.querySelector('#create-btn')
      if (btn) btn.disabled = !isValid()
    })
  })

  document.querySelectorAll('.tier-cost-input').forEach(input => {
    input.addEventListener('input', e => {
      state.tierCosts[e.target.dataset.tier] = Math.max(0, parseInt(e.target.value) || 0)
    })
  })

  // Subasta-specific listeners
  document.querySelector('#min-team-size')?.addEventListener('input', e => {
    state.minTeamSize = Math.max(1, parseInt(e.target.value) || 1)
    if (state.maxTeamSize < state.minTeamSize) {
      state.maxTeamSize = state.minTeamSize
      const maxEl = document.querySelector('#max-team-size')
      if (maxEl) maxEl.value = state.maxTeamSize
    }
    state.coins = state.maxTeamSize * state.minBid * AUCTION_BUDGET_MULTIPLIER
    const coinsEl = document.querySelector('#coins')
    if (coinsEl) coinsEl.value = state.coins
    document.querySelector('#create-btn').disabled = !isValid()
  })
  document.querySelector('#max-team-size')?.addEventListener('input', e => {
    const val = Math.max(1, parseInt(e.target.value) || 1)
    if (val < state.minTeamSize) {
      e.target.value = state.minTeamSize
      return
    }
    state.maxTeamSize = val
    document.querySelector('#create-btn').disabled = !isValid()
  })
  document.querySelector('#min-bid')?.addEventListener('input', e => {
    state.minBid = Math.max(1, parseInt(e.target.value) || 1)
    document.querySelector('#create-btn').disabled = !isValid()
  })
  document.querySelector('#auction-timer')?.addEventListener('input', e => {
    state.auctionTimer = Math.max(5, parseInt(e.target.value) || 10)
  })

  document.querySelector('#create-btn')?.addEventListener('click', handleCreate)
}

function handleCreate() {
  if (!_discordCtx) return
  const { sdk, user } = _discordCtx
  const socket = getSocket()

  const isSubasta = state.draftType === 'subasta'
  const config = {
    draftType: state.draftType,
    name: state.name.trim() || 'Draft',
    teamSize: isSubasta ? state.maxTeamSize : state.teamSize,
    minTeamSize: isSubasta ? state.minTeamSize : 0,
    minBid: isSubasta ? state.minBid : 0,
    auctionTimer: isSubasta ? state.auctionTimer : 10,
    coins: state.coins,
    maxMegas: state.maxMegas,
    tierSlots: (!isSubasta && state.draftType !== 'puntos') ? { ...state.tierSlots } : {},
    tierCosts: {},
    presetId: state.draftType === 'puntos' ? state.presetId : null,
  }

  const draftInstanceId = `${sdk.instanceId}_${Date.now()}`
  socket.emit('create-draft', { instanceId: sdk.instanceId, draftInstanceId, config, user })
  location.hash = `#join-draft/${draftInstanceId}`
}

export function init(discordCtx) {
  _discordCtx = discordCtx
  state.name = ''

  const { sdk, user } = discordCtx
  const socket = getSocket()
  socket.emit('start-configuring', { instanceId: sdk.instanceId, user })

  window.addEventListener('hashchange', () => {
    socket.emit('stop-configuring', { instanceId: sdk.instanceId, userId: user.id })
  }, { once: true })

  render()
}
