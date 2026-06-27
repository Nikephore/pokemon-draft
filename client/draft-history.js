const PLAYER_COLORS = [
  '#e53935','#1e88e5','#43a047','#fb8c00',
  '#8e24aa','#00acc1','#f4511e','#795548',
  '#d81b60','#00897b','#fdd835','#3949ab',
  '#6d4c41','#546e7a','#c0ca33','#7b1fa2',
]

let _discordCtx = null

export function init(discordCtx) {
  _discordCtx = discordCtx
  renderList()
}

// ── List view ─────────────────────────────────────────────────────────────────

async function renderList() {
  const app = document.querySelector('#app')
  app.innerHTML = `
    <div class="back-bar"><a class="back-link" href="#lobby">← Volver</a></div>
    <h1>Mis Drafts</h1>
    <p class="loading">Cargando…</p>
  `

  try {
    const res = await fetch(`/api/drafts/mine?userId=${_discordCtx.user.id}`)
    const drafts = await res.json()

    if (drafts.length === 0) {
      app.innerHTML = `
        <div class="back-bar"><a class="back-link" href="#lobby">← Volver</a></div>
        <h1>Mis Drafts</h1>
        <p class="empty-state">Aún no has participado en ningún draft.</p>
      `
      return
    }

    app.innerHTML = `
      <div class="back-bar"><a class="back-link" href="#lobby">← Volver</a></div>
      <h1>Mis Drafts</h1>
      <div class="draft-list">
        ${drafts.map(d => `
          <div class="draft-list-card" data-instance="${d.instance_id}">
            <div class="draft-list-card-main">
              <span class="draft-list-name">${d.name}</span>
              <span class="draft-phase-chip draft-phase-chip-${d.phase}">${phaseLabel(d.phase)}</span>
            </div>
            <div class="draft-list-card-meta">
              <span>${d.participant_count} jugadores · ${d.team_size} Pokémon/equipo</span>
              <span>${formatDate(d.created_at)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `

    app.querySelectorAll('.draft-list-card').forEach(card => {
      card.addEventListener('click', () => renderDetail(card.dataset.instance))
    })
  } catch {
    app.innerHTML = `
      <div class="back-bar"><a class="back-link" href="#lobby">← Volver</a></div>
      <h1>Mis Drafts</h1>
      <p style="color:var(--red)">Error al cargar los drafts.</p>
    `
  }
}

// ── Detail view ───────────────────────────────────────────────────────────────

async function renderDetail(instanceId) {
  const app = document.querySelector('#app')
  app.innerHTML = `
    <div class="back-bar">
      <button class="back-btn" id="back-btn">← Volver a mis drafts</button>
    </div>
    <p class="loading">Cargando equipos…</p>
  `
  app.querySelector('#back-btn').addEventListener('click', renderList)

  try {
    const res = await fetch(`/api/drafts/${instanceId}/teams`)
    const { draft, teams } = await res.json()

    const pickOrder = draft.pickOrder ?? []
    const playerColor = userId => {
      const i = pickOrder.findIndex(p => p.id === userId)
      return i >= 0 ? PLAYER_COLORS[i % PLAYER_COLORS.length] : '#888'
    }
    const avatarEl = (t, color) => {
      const initial = (t.global_name || t.username || '?')[0].toUpperCase()
      return t.avatar
        ? `<img class="participant-avatar" src="/api/avatar/${t.userId}/${t.avatar}" width="36" height="36" alt="${t.username}" loading="lazy" />`
        : `<div class="participant-avatar participant-avatar-initials" style="width:36px;height:36px;font-size:14px;background:${color}">${initial}</div>`
    }
    app.innerHTML = `
      <div class="back-bar">
        <button class="back-btn" id="back-btn">← Volver a mis drafts</button>
      </div>
      <div class="draft-detail-header">
        <h1>${draft.name}</h1>
        <div class="draft-detail-meta">
          <span class="draft-phase-chip draft-phase-chip-${draft.phase}">${phaseLabel(draft.phase)}</span>
          <span>${teams.length} jugadores · ${draft.teamSize} Pokémon/equipo</span>
          <span>${formatDate(draft.createdAt)}</span>
        </div>
      </div>
      <div class="team-cards">
        ${teams.map(t => {
          const color = playerColor(t.userId)
          const filled = t.pokemon.length
          const empty = Math.max(0, draft.teamSize - filled)
          return `
            <div class="team-card" style="border-color:${color}">
              <div class="team-card-header" style="background:${color}18">
                ${avatarEl(t, color)}
                <span class="team-card-name">${t.global_name || t.username}</span>
                <span class="team-card-count" style="color:${color}">${filled}/${draft.teamSize}</span>
              </div>
              <div class="team-pokemon-grid">
                ${t.pokemon.map(p => `
                  <div class="team-pokemon-item">
                    <img src="/api/sprite/${p.pokemonId}" alt="${p.pokemonName}" width="56" height="56" />
                    <div class="team-pokemon-name">${p.pokemonName}</div>
                    ${p.tier ? `<span class="tier-badge ${p.tier}">${p.tier}</span>` : ''}
                  </div>
                `).join('')}
                ${Array.from({ length: empty }).map(() =>
                  `<div class="team-pokemon-item team-pokemon-empty"></div>`
                ).join('')}
              </div>
            </div>
          `
        }).join('')}
      </div>
    `

    app.querySelector('#back-btn').addEventListener('click', renderList)
  } catch {
    app.innerHTML = `
      <div class="back-bar">
        <button class="back-btn" id="back-btn">← Volver a mis drafts</button>
      </div>
      <p style="color:var(--red)">Error al cargar los equipos.</p>
    `
    app.querySelector('#back-btn').addEventListener('click', renderList)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function phaseLabel(phase) {
  if (phase === 'complete') return 'Completado'
  if (phase === 'picking')  return 'En curso'
  return 'En lobby'
}

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str.replace(' ', 'T') + 'Z')
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}
