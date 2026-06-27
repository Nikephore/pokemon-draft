import { getSocket } from './socket.js'

const POKEBALL_SVG = `<svg class="app-logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="48" fill="#fff" stroke="#1a1a2e" stroke-width="4"/>
  <path d="M2 50 h96" stroke="#1a1a2e" stroke-width="4"/>
  <path d="M2 50 Q2 2 50 2 Q98 2 98 50 Z" fill="#cc0000"/>
  <circle cx="50" cy="50" r="14" fill="#fff" stroke="#1a1a2e" stroke-width="4"/>
  <circle cx="50" cy="50" r="6" fill="#1a1a2e"/>
</svg>`

export function init({ sdk, user }) {
  const instanceId = sdk.instanceId
  const socket = getSocket()

  document.querySelector('#app').innerHTML = `
    <div class="app-header">
      ${POKEBALL_SVG}
      <h1 class="app-title">PokéDraft</h1>
      <p class="app-subtitle">Draft de Pokémon para Discord</p>
    </div>
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

function avatarHTML(user) {
  const initial = (user.global_name || user.username || '?')[0].toUpperCase()
  if (user.avatar) {
    return `<img class="participant-avatar" src="/api/avatar/${user.id}/${user.avatar}" width="40" height="40" alt="${user.username}" loading="lazy" />`
  }
  return `<div class="participant-avatar participant-avatar-initials" style="width:40px;height:40px;font-size:16px">${initial}</div>`
}

function renderParticipants(participants, myId) {
  const bar = document.querySelector('#participants')
  if (!bar) return
  bar.innerHTML = participants.map(p => `
    <div class="participant-card-mini ${p.id === myId ? 'participant-card-me' : ''}">
      ${avatarHTML(p)}
      <span class="participant-card-mini-name">${p.global_name || p.username}${p.id === myId ? ' (tú)' : ''}</span>
    </div>
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
        <span class="lobby-card-icon">⚔️</span>
        <div class="lobby-card-body">
          <h3 class="lobby-card-title">Crear Draft</h3>
          <p class="lobby-card-desc">Configura y crea un nuevo draft para tu servidor</p>
        </div>
        <span class="lobby-card-arrow">→</span>
      </a>
    ` : ''}
    ${hasDraft ? `
      <a class="lobby-card lobby-card-highlight" href="#join-draft">
        <span class="lobby-card-icon">🎯</span>
        <div class="lobby-card-body">
          <h3 class="lobby-card-title">${room.draft.config?.name || 'Draft activo'}</h3>
          <p class="lobby-card-desc">Hay un draft activo en esta sala — ¡únete!</p>
        </div>
        <span class="lobby-card-arrow">→</span>
      </a>
    ` : ''}
    ${!hasDraft && !isHost ? `
      <div class="lobby-card lobby-card-muted">
        <span class="lobby-card-icon">⏳</span>
        <div class="lobby-card-body">
          <h3 class="lobby-card-title">Esperando al host...</h3>
          <p class="lobby-card-desc">El host aún no ha creado un draft</p>
        </div>
      </div>
    ` : ''}
    <a class="lobby-card" href="#pokemon-table">
      <span class="lobby-card-icon">📋</span>
      <div class="lobby-card-body">
        <h3 class="lobby-card-title">Ver Pokémon</h3>
        <p class="lobby-card-desc">Consulta la lista completa con tiers y estadísticas</p>
      </div>
      <span class="lobby-card-arrow">→</span>
    </a>
    <a class="lobby-card" href="#draft-history">
      <span class="lobby-card-icon">📜</span>
      <div class="lobby-card-body">
        <h3 class="lobby-card-title">Mis Drafts</h3>
        <p class="lobby-card-desc">Consulta los drafts anteriores y los equipos formados</p>
      </div>
      <span class="lobby-card-arrow">→</span>
    </a>
  `
}
