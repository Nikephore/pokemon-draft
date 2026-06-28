import { showConfirm, showToast } from './dom.js'

let _discordCtx = null
let _presetId = null
let _preset = null       // { id, name, max_points, status, assignments: {} }
let _allPokemon = []
let _activeColumn = null // number | null — which column is being edited
let _searchQuery = ''
let _dirty = false

export async function init(discordCtx, presetId) {
  _discordCtx = discordCtx
  _presetId = parseInt(presetId)
  _activeColumn = null
  _searchQuery = ''
  _dirty = false

  document.querySelector('#app').innerHTML = `
    <div class="back-bar"><a class="back-link" href="#presets">← Presets</a></div>
    <div id="editor-root"><p class="loading">Cargando…</p></div>
  `

  const [presetRaw, pokemon] = await Promise.all([
    fetch(`/api/presets/${_presetId}`).then(r => r.json()),
    fetch('/api/pokemon', { cache: 'default' }).then(r => r.json()),
  ])

  _preset = { ...presetRaw, assignments: JSON.parse(presetRaw.assignments ?? '{}') }
  _allPokemon = pokemon
  render()
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function save(newStatus) {
  const status = newStatus ?? _preset.status
  const body = {
    name: _preset.name,
    assignments: _preset.assignments,
    status,
    userId: _discordCtx.user.id,
  }
  const updated = await fetch(`/api/presets/${_presetId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json())

  _preset = { ...updated, assignments: JSON.parse(updated.assignments ?? '{}') }
  _dirty = false
  return updated
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPokemonById(id) {
  return _allPokemon.find(p => p.id === id)
}

function getColumnPokemon(pts) {
  return Object.entries(_preset.assignments)
    .filter(([, v]) => v === pts)
    .map(([id]) => getPokemonById(parseInt(id)))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function getUnassigned() {
  const assigned = new Set(Object.keys(_preset.assignments).map(Number))
  return _allPokemon.filter(p => !assigned.has(p.id))
}

function getSearchResults() {
  const q = _searchQuery.toLowerCase()
  const unassigned = getUnassigned()
  if (!q) return unassigned
  return unassigned.filter(p => p.name.toLowerCase().includes(q))
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const root = document.querySelector('#editor-root')
  if (!root) return

  const isCompleted = _preset.status === 'completed'
  const isCreator = !_preset.created_by || _preset.created_by === _discordCtx.user.id
  const canEdit = isCreator && !isCompleted
  const maxPts = _preset.max_points
  const cols = Array.from({ length: maxPts }, (_, i) => maxPts - i) // [max, max-1, ..., 1]

  const colsHTML = cols.map(pts => {
    const mons = getColumnPokemon(pts)
    const isActive = _activeColumn === pts

    return `
      <div class="preset-col ${isActive ? 'preset-col-active' : ''}" data-pts="${pts}">
        <div class="preset-col-header">${pts} <span style="font-size:0.7rem;opacity:0.6">pts</span></div>
        <div class="preset-col-body">
          ${mons.map(p => `
            <div class="preset-pokemon-chip" data-pid="${p.id}">
              <span class="preset-chip-name">${p.name}</span>
              ${canEdit ? `<button class="preset-chip-remove" data-pid="${p.id}" title="Quitar">×</button>` : ''}
            </div>
          `).join('')}
        </div>
        ${canEdit ? `
          <button class="preset-col-add ${isActive ? 'preset-col-add-active' : ''}" data-pts="${pts}">
            ${isActive ? '✕ Cerrar' : '+ Agregar'}
          </button>
        ` : ''}
      </div>
    `
  }).join('')

  const searchResults = _activeColumn !== null ? getSearchResults() : []
  const searchPanelHTML = _activeColumn !== null ? `
    <div class="preset-search-panel">
      <div class="preset-search-header">
        <span>Añadiendo a <strong>${_activeColumn} pts</strong></span>
        <input id="preset-search-input" class="search-input" type="text" placeholder="Buscar Pokémon…" value="${_searchQuery}" style="max-width:220px" />
        <span class="results-info">${searchResults.length} disponibles</span>
      </div>
      <div class="preset-search-results">
        ${searchResults.slice(0, 60).map(p => `
          <button class="preset-search-chip" data-pid="${p.id}" title="${p.name}">
            <img src="/api/sprite/${p.id}" width="40" height="40" loading="lazy" alt="${p.name}" />
            <span>${p.name}</span>
          </button>
        `).join('')}
        ${searchResults.length === 0 ? '<p class="empty-state" style="grid-column:1/-1">Sin resultados</p>' : ''}
      </div>
    </div>
  ` : ''

  root.innerHTML = `
    <div class="preset-editor-header">
      <div class="preset-editor-meta">
        <input id="preset-name-input" class="preset-name-input" value="${_preset.name}" ${!canEdit ? 'readonly' : ''} />
        <span class="preset-status-badge preset-status-${_preset.status}">${isCompleted ? 'Completado' : 'Borrador'}</span>
        ${!isCreator ? '<span style="font-size:0.78rem;color:rgba(0,0,0,0.4)">(solo lectura)</span>' : ''}
        <span class="preset-editor-info">Máx: ${maxPts} pts · ${Object.keys(_preset.assignments).length} Pokémon asignados</span>
      </div>
      <div class="preset-editor-actions">
        ${isCreator && !isCompleted ? `
          <button id="save-draft-btn" class="preset-save-btn ${_dirty ? 'preset-save-btn-dirty' : ''}">
            ${_dirty ? '● Guardar borrador' : 'Guardado'}
          </button>
          <button id="complete-btn" class="create-btn" style="font-size:0.85rem;padding:0.5rem 1rem">Marcar como completado</button>
        ` : ''}
        ${isCreator && isCompleted ? `
          <button id="reopen-btn" class="preset-save-btn">Reabrir como borrador</button>
        ` : ''}
      </div>
    </div>

    <div class="preset-table-wrap">
      <div class="preset-table">${colsHTML}</div>
    </div>

    ${searchPanelHTML}
  `

  attachListeners(canEdit)
}

function attachListeners(canEdit) {
  // Name edit
  document.querySelector('#preset-name-input')?.addEventListener('input', e => {
    _preset.name = e.target.value
    _dirty = true
    syncDirtyBtn()
  })

  // Save draft
  document.querySelector('#save-draft-btn')?.addEventListener('click', async () => {
    await save()
    showToast('Borrador guardado')
    syncDirtyBtn()
  })

  // Complete
  document.querySelector('#complete-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirm(
      '¿Marcar el preset como completado?<br>Podrás reabrirlo como borrador si necesitas hacer cambios.',
      'Completar'
    )
    if (!confirmed) return
    await save('completed')
    render()
  })

  // Reopen as draft
  document.querySelector('#reopen-btn')?.addEventListener('click', async () => {
    await save('draft')
    render()
  })

  if (!canEdit) return

  // Column add/close buttons
  document.querySelectorAll('.preset-col-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const pts = parseInt(btn.dataset.pts)
      _activeColumn = (_activeColumn === pts) ? null : pts
      _searchQuery = ''
      render()
    })
  })

  // Remove Pokémon chip
  document.querySelectorAll('.preset-chip-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const pid = parseInt(btn.dataset.pid)
      delete _preset.assignments[String(pid)]
      _dirty = true
      render()
    })
  })

  // Search input
  const searchInput = document.querySelector('#preset-search-input')
  if (searchInput) {
    searchInput.focus()
    searchInput.addEventListener('input', e => {
      _searchQuery = e.target.value
      // Only re-render the results part to avoid losing focus
      const panel = document.querySelector('.preset-search-results')
      if (!panel) return
      const results = getSearchResults()
      panel.innerHTML = results.slice(0, 60).map(p => `
        <button class="preset-search-chip" data-pid="${p.id}" title="${p.name}">
          <img src="/api/sprite/${p.id}" width="40" height="40" loading="lazy" alt="${p.name}" />
          <span>${p.name}</span>
        </button>
      `).join('') || '<p class="empty-state" style="grid-column:1/-1">Sin resultados</p>'
      const info = document.querySelector('.preset-search-header .results-info')
      if (info) info.textContent = `${results.length} disponibles`
      attachSearchChipListeners()
    })
  }

  attachSearchChipListeners()
}

function attachSearchChipListeners() {
  document.querySelectorAll('.preset-search-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = String(parseInt(btn.dataset.pid))
      _preset.assignments[pid] = _activeColumn
      _dirty = true
      // Remove from search results immediately; re-render column body
      btn.remove()
      const colBody = document.querySelector(`.preset-col[data-pts="${_activeColumn}"] .preset-col-body`)
      if (colBody) {
        const p = getPokemonById(parseInt(pid))
        if (p) {
          const chip = document.createElement('div')
          chip.className = 'preset-pokemon-chip'
          chip.dataset.pid = pid
          chip.innerHTML = `
            <span class="preset-chip-name">${p.name}</span>
            <button class="preset-chip-remove" data-pid="${pid}" title="Quitar">×</button>
          `
          chip.querySelector('.preset-chip-remove').addEventListener('click', ev => {
            ev.stopPropagation()
            delete _preset.assignments[pid]
            _dirty = true
            chip.remove()
            syncDirtyBtn()
            // Add back to search results if search is still open
            addBackToSearch(parseInt(pid))
          })
          colBody.appendChild(chip)
        }
      }
      syncDirtyBtn()
      const info = document.querySelector('.preset-search-header .results-info')
      if (info) {
        const remaining = getSearchResults().length - 1
        info.textContent = `${Math.max(0, remaining)} disponibles`
      }
    })
  })
}

function addBackToSearch(pokemonId) {
  const panel = document.querySelector('.preset-search-results')
  if (!panel || !_activeColumn) return
  const q = _searchQuery.toLowerCase()
  const p = getPokemonById(pokemonId)
  if (!p) return
  if (q && !p.name.toLowerCase().includes(q)) return
  const btn = document.createElement('button')
  btn.className = 'preset-search-chip'
  btn.dataset.pid = pokemonId
  btn.title = p.name
  btn.innerHTML = `<img src="/api/sprite/${pokemonId}" width="40" height="40" loading="lazy" alt="${p.name}" /><span>${p.name}</span>`
  panel.appendChild(btn)
  attachSearchChipListeners()
}

function syncDirtyBtn() {
  const btn = document.querySelector('#save-draft-btn')
  if (!btn) return
  btn.textContent = _dirty ? '● Guardar borrador' : 'Guardado'
  btn.classList.toggle('preset-save-btn-dirty', _dirty)
}
