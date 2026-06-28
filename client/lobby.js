import { getSocket } from './socket.js'

const POKEBALL_SVG = `<svg class="app-logo" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="pb-logo"><circle cx="50" cy="50" r="43"/></clipPath>
  </defs>
  <rect x="7" y="7"  width="86" height="43" fill="#cc0000"  clip-path="url(#pb-logo)"/>
  <rect x="7" y="50" width="86" height="43" fill="#ffffff"  clip-path="url(#pb-logo)"/>
  <rect x="7" y="44" width="86" height="12" fill="#1a1a2e"  clip-path="url(#pb-logo)"/>
  <circle cx="50" cy="50" r="11" fill="#1a1a2e"/>
  <circle cx="50" cy="50" r="7"  fill="#ffffff"/>
  <circle cx="50" cy="50" r="46" fill="none" stroke="#1a1a2e" stroke-width="6"/>
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
    <div id="lobby-cards" class="lobby">
      <p class="loading">Conectando a la sala...</p>
    </div>
  `

  socket.off('room-state')
  socket.off('connect')

  const joinRoom = () => socket.emit('view-room', { instanceId, user, channelId: sdk.channelId, guildId: sdk.guildId })
  socket.on('connect', joinRoom)
  joinRoom()

  socket.on('room-state', room => {
    renderCards(room, user.id)
  })
}

function snakeCurrentPickerId(pickOrder, idx) {
  if (!pickOrder?.length) return null
  const n = pickOrder.length
  const abs = idx % (n * 2)
  return abs < n ? pickOrder[abs]?.id : pickOrder[n * 2 - 1 - abs]?.id
}

function renderCards(room, myId) {
  const container = document.querySelector('#lobby-cards')
  if (!container) return

  const activeDrafts = Object.entries(room.drafts ?? {})
    .filter(([, d]) => d.phase !== 'complete')

  const TYPE_ICON = { clasico: '🐍', subasta: '🔨', puntos: '⭐' }
  const TYPE_NAME = { clasico: 'Clásico', subasta: 'Subasta', puntos: 'Puntos' }

  const configuringCards = (room.configuringUsers ?? []).map(u => `
    <div class="lobby-card lobby-card-creating">
      <span class="lobby-card-icon">⚙️</span>
      <div class="lobby-card-body">
        <h3 class="lobby-card-title">Draft en configuración</h3>
        <p class="lobby-card-desc">${u.global_name || u.username} está configurando un draft</p>
      </div>
    </div>
  `).join('')

  const draftCards = activeDrafts.map(([draftId, draft]) => {
    const type = draft.config?.draftType ?? 'clasico'
    const isCreator = draft.creatorId === myId
    const inLobby = draft.phase === 'lobby'
    const isParticipant = draft.participants?.some(p => p.id === myId)

    const isMyTurn = !inLobby && type !== 'subasta'
      && snakeCurrentPickerId(draft.pickOrder, draft.currentPickIndex ?? 0) === myId

    const cardClass = isMyTurn
      ? 'lobby-card lobby-card-my-turn'
      : 'lobby-card lobby-card-highlight'

    const phaseLabel = inLobby ? 'En creación' : 'En curso'

    const arrowLabel = inLobby && isCreator ? 'Configurar →'
      : isMyTurn ? '¡Tu turno! →'
      : !inLobby && type === 'subasta' && isParticipant ? 'Reanudar →'
      : '→'

    return `
      <a class="${cardClass}" href="#join-draft/${draftId}">
        <span class="lobby-card-icon">${TYPE_ICON[type] ?? '🎯'}</span>
        <div class="lobby-card-body">
          <h3 class="lobby-card-title">${draft.config?.name || 'Draft'}</h3>
          <p class="lobby-card-desc">${TYPE_NAME[type] ?? type} · ${draft.participants?.length ?? 0} participantes · ${phaseLabel}</p>
        </div>
        <span class="lobby-card-arrow">${arrowLabel}</span>
      </a>
    `
  }).join('')

  container.innerHTML = `
    <a class="lobby-card" href="#create-draft">
      <span class="lobby-card-icon">⚔️</span>
      <div class="lobby-card-body">
        <h3 class="lobby-card-title">Crear Draft</h3>
        <p class="lobby-card-desc">Configura y crea un nuevo draft para tu servidor</p>
      </div>
      <span class="lobby-card-arrow">→</span>
    </a>
    ${configuringCards}
    ${draftCards}
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
    <a class="lobby-card" href="#presets">
      <span class="lobby-card-icon">⭐</span>
      <div class="lobby-card-body">
        <h3 class="lobby-card-title">Presets de Puntos</h3>
        <p class="lobby-card-desc">Configura los Pokémon elegibles y sus costes para drafts de Puntos</p>
      </div>
      <span class="lobby-card-arrow">→</span>
    </a>
  `
}
