import { getSocket } from './socket.js'
import { setHTML } from './dom.js'

const TIERS = ['Ubers', 'OU', 'UUBL', 'UU', 'RUBL', 'RU', 'NUBL', 'NU', 'PUBL', 'PU', 'ZU', 'NFE', 'LC']

const state = {
  name: '',
  teamSize: 6,
  coins: 100,
  maxMegas: 0,
  tierSlots: Object.fromEntries(TIERS.map(t => [t, 0])),
}

let _discordCtx = null

function tierTotal() {
  return Object.values(state.tierSlots).reduce((a, b) => a + b, 0)
}

function render() {
  const total = tierTotal()
  const isValid = total === state.teamSize

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

  setHTML(document.querySelector('#app'), `
    <div class="back-bar">
      <a class="back-link" href="#lobby">← Volver</a>
    </div>
    <h1>Pokémon Draft</h1>
    <div class="draft-form">
      <h2 class="draft-form-title">Crear Draft</h2>

      <div class="form-group">
        <label class="form-label">Nombre del Draft</label>
        <input id="draft-name" class="form-input" type="text" maxlength="40" placeholder="Ej: Liga de Tontopollas de España" value="${state.name}" />
      </div>

      <div class="form-row" style="grid-template-columns:1fr 1fr 1fr">
        <div class="form-group">
          <label class="form-label">Pokémon por equipo</label>
          <input id="team-size" class="form-input" type="number" min="1" max="18" value="${state.teamSize}" />
        </div>
        <div class="form-group">
          <label class="form-label">Monedas por equipo</label>
          <input id="coins" class="form-input" type="number" min="0" value="${state.coins}" />
        </div>
        <div class="form-group">
          <label class="form-label">Megaevoluciones máx.</label>
          <input id="max-megas" class="form-input" type="number" min="0" max="${state.teamSize}" value="${state.maxMegas}" />
        </div>
      </div>

      <div class="form-group">
        <div class="form-label-row">
          <label class="form-label">Pokémon por tier</label>
          <span class="tier-counter ${isValid ? 'tier-counter-ok' : 'tier-counter-err'}">
            ${total} / ${state.teamSize}
          </span>
        </div>
        <div class="tier-progress-wrap">
          <div class="tier-progress-bar">
            <div class="tier-progress-fill" style="
              width: ${Math.min(100, state.teamSize > 0 ? (total / state.teamSize) * 100 : 0)}%;
              background: ${isValid ? '#2e7d32' : total > state.teamSize ? '#cc0000' : '#f9a825'};
            "></div>
          </div>
        </div>
        <div class="tier-slots-grid">${tierRows}</div>
      </div>

      <button id="create-btn" class="create-btn" ${!isValid ? 'disabled' : ''}>
        Crear Draft
      </button>
    </div>
  `)

  document.querySelector('#draft-name').addEventListener('input', e => {
    state.name = e.target.value
  })

  document.querySelector('#team-size').addEventListener('input', e => {
    state.teamSize = Math.max(1, parseInt(e.target.value) || 1)
    render()
  })

  document.querySelector('#coins').addEventListener('input', e => {
    state.coins = Math.max(0, parseInt(e.target.value) || 0)
  })

  document.querySelector('#max-megas').addEventListener('input', e => {
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
        const isValid = total === state.teamSize
        fill.style.width = `${pct}%`
        fill.style.background = isValid ? '#2e7d32' : total > state.teamSize ? '#cc0000' : '#f9a825'
      }
      const btn = document.querySelector('#create-btn')
      if (btn) btn.disabled = total !== state.teamSize
    })
  })

  document.querySelector('#create-btn')?.addEventListener('click', handleCreate)
}

function handleCreate() {
  if (!_discordCtx) return
  const { sdk, user } = _discordCtx
  const socket = getSocket()

  const config = {
    name: state.name.trim() || 'Draft',
    teamSize: state.teamSize,
    coins: state.coins,
    maxMegas: state.maxMegas,
    tierSlots: { ...state.tierSlots },
  }

  socket.emit('create-draft', { instanceId: sdk.instanceId, config })

  // Navigate back to lobby where room-state will show the active draft
  location.hash = '#lobby'
}

export function init(discordCtx) {
  _discordCtx = discordCtx
  render()
}
