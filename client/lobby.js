import { getSocket } from './socket.js'

export function init({ sdk, user }) {
  const instanceId = sdk.instanceId
  const socket = getSocket()

  document.querySelector('#app').innerHTML = `
    <h1>Pokémon Draft</h1>
    <div id="participants" class="participants-bar"></div>
    <div id="lobby-cards" class="lobby">
      <p class="loading">Conectando a la sala...</p>
    </div>
  `

  socket.off('room-state')

  socket.emit('join-room', { instanceId, user })

  socket.on('room-state', room => {
    renderParticipants(room.participants, user.id)
    renderCards(room, user.id)
  })
}

function renderParticipants(participants, myId) {
  const bar = document.querySelector('#participants')
  if (!bar) return
  bar.innerHTML = participants.map(p => `
    <span class="participant-chip ${p.id === myId ? 'participant-me' : ''}">
      ${p.global_name || p.username}${p.id === myId ? ' (tú)' : ''}
    </span>
  `).join('')
}

function renderCards(room, myId) {
  const container = document.querySelector('#lobby-cards')
  if (!container) return

  const isHost = room.host === myId
  const hasDraft = room.draft !== null

  container.innerHTML = `
    ${!hasDraft && isHost ? `
      <a class="lobby-card" href="#create-draft">
        <div class="lobby-card-body">
          <h3 class="lobby-card-title">Crear Draft</h3>
          <p class="lobby-card-desc">Configura y crea un nuevo draft para tu servidor</p>
        </div>
        <span class="lobby-card-arrow">→</span>
      </a>
    ` : ''}
    ${hasDraft ? `
      <a class="lobby-card lobby-card-highlight" href="#join-draft">
        <div class="lobby-card-body">
          <h3 class="lobby-card-title">Unirse al Draft</h3>
          <p class="lobby-card-desc">Hay un draft activo en esta sala</p>
        </div>
        <span class="lobby-card-arrow">→</span>
      </a>
    ` : ''}
    ${!hasDraft && !isHost ? `
      <div class="lobby-card lobby-card-muted">
        <div class="lobby-card-body">
          <h3 class="lobby-card-title">Esperando al host...</h3>
          <p class="lobby-card-desc">El host aún no ha creado un draft</p>
        </div>
      </div>
    ` : ''}
    <a class="lobby-card" href="#pokemon-table">
      <div class="lobby-card-body">
        <h3 class="lobby-card-title">Ver Pokémon</h3>
        <p class="lobby-card-desc">Consulta la lista completa con tiers y estadísticas</p>
      </div>
      <span class="lobby-card-arrow">→</span>
    </a>
  `
}
