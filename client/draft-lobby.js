import { getSocket } from './socket.js'

const TIERS = ['Ubers', 'OU', 'UUBL', 'UU', 'RUBL', 'RU', 'NUBL', 'NU', 'PUBL', 'PU', 'ZU', 'NFE', 'LC']

const state = {
  teamSize: 6,
  coins: 100,
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
        type="number"
        class="tier-slot-input"
        data-tier="${t}"
        min="0"
        max="${state.teamSize}"
        value="${state.tierSlots[t]}"
      />
    </div>
  `).join('')

  document.querySelector('#app').innerHTML = `
    <div class="back-bar">
      <a class="back-link" href="#lobby">← Volver</a>
    </div>
    <h1>Pokémon Draft</h1>
    <div class="draft-form">
      <h2 class="draft-form-title">Crear Draft</h2>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Pokémon por equipo</label>
          <input id="team-size" class="form-input" type="number" min="1" max="18" value="${state.teamSize}" />
        </div>
        <div class="form-group">
          <label class="form-label">Monedas por equipo</label>
          <input id="coins" class="form-input" type="number" min="0" value="${state.coins}" />
        </div>
      </div>

      <div class="form-group">
        <div class="form-label-row">
          <label class="form-label">Pokémon por tier</label>
          <span class="tier-counter ${isValid ? 'tier-counter-ok' : 'tier-counter-err'}">
            ${total} / ${state.teamSize}
          </span>
        </div>
        <div class="tier-slots-grid">${tierRows}</div>
      </div>

      <button id="create-btn" class="create-btn" ${!isValid ? 'disabled' : ''}>
        Crear Draft
      </button>
    </div>
  `

  document.querySelector('#team-size').addEventListener('input', e => {
    state.teamSize = Math.max(1, parseInt(e.target.value) || 1)
    render()
  })

  document.querySelector('#coins').addEventListener('input', e => {
    state.coins = Math.max(0, parseInt(e.target.value) || 0)
  })

  document.querySelectorAll('.tier-slot-input').forEach(input => {
    input.addEventListener('input', e => {
      state.tierSlots[e.target.dataset.tier] = Math.max(0, parseInt(e.target.value) || 0)
      const total = tierTotal()
      const counter = document.querySelector('.tier-counter')
      if (counter) {
        counter.textContent = `${total} / ${state.teamSize}`
        counter.className = `tier-counter ${total === state.teamSize ? 'tier-counter-ok' : 'tier-counter-err'}`
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
    teamSize: state.teamSize,
    coins: state.coins,
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
