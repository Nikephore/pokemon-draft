let _discordCtx = null

export async function init(discordCtx) {
  _discordCtx = discordCtx
  const { sdk } = discordCtx
  const instanceId = sdk.instanceId

  document.querySelector('#app').innerHTML = `
    <div class="back-bar"><a class="back-link" href="#lobby">← Volver</a></div>
    <h1>Presets de Puntos</h1>
    <div id="presets-content"><p class="loading">Cargando…</p></div>
  `

  await refresh(instanceId)
}

async function refresh(instanceId) {
  const presets = await fetch(`/api/presets?instanceId=${encodeURIComponent(instanceId)}`).then(r => r.json())
  render(presets, instanceId)
}

function render(presets, instanceId) {
  const container = document.querySelector('#presets-content')
  if (!container) return

  const { user } = _discordCtx

  const STATUS_LABEL = { draft: 'Borrador', completed: 'Completado' }

  container.innerHTML = `
    <div class="preset-create-box">
      <h3 class="preset-create-title">Nuevo preset</h3>
      <div class="preset-create-row">
        <input id="new-preset-name" class="form-input" type="text" placeholder="Nombre del preset" maxlength="40" />
        <div class="form-group" style="min-width:160px">
          <label class="form-label">Puntos máx. por Pokémon</label>
          <input id="new-preset-maxpts" class="form-input" type="number" min="1" max="50" value="10" />
        </div>
        <button id="new-preset-btn" class="create-btn" style="align-self:flex-end">Crear</button>
      </div>
    </div>

    <div class="preset-list">
      ${presets.length === 0 ? '<p class="empty-state">No hay presets aún. Crea el primero.</p>' : ''}
      ${presets.map(p => `
        <a class="preset-card" href="#preset/${p.id}">
          <div class="preset-card-left">
            <span class="preset-card-name">${p.name}</span>
            <span class="preset-status-badge preset-status-${p.status}">${STATUS_LABEL[p.status] ?? p.status}</span>
          </div>
          <span class="preset-card-meta">Máx: ${p.max_points} pts</span>
        </a>
      `).join('')}
    </div>
  `

  document.querySelector('#new-preset-btn').addEventListener('click', async () => {
    const name = document.querySelector('#new-preset-name').value.trim()
    const maxPoints = parseInt(document.querySelector('#new-preset-maxpts').value) || 10
    if (!name) { document.querySelector('#new-preset-name').focus(); return }

    const preset = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId, name, maxPoints, createdBy: user.id }),
    }).then(r => r.json())

    location.hash = `#preset/${preset.id}`
  })
}
