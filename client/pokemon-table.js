import { setHTML } from './dom.js'

const PAGE_SIZE_TABLE = 20
const PAGE_SIZE_GRID  = 30

let allPokemon = []
let currentPage = 1
let searchQuery = ''
let selectedTier = ''
let selectedNatDex = ''
let sortOrder = 'id'
let viewMode = 'grid'

async function fetchPokemon() {
  setHTML(document.querySelector('#app'), `<p class="loading">Cargando Pokémon...</p>`)
  try {
    const res = await fetch('/api/pokemon', { cache: 'no-store' })
    allPokemon = await res.json()
    render()
  } catch (err) {
    setHTML(document.querySelector('#app'), `
      <p style="color: #ff6b6b;">Error al cargar. ¿Está corriendo el servidor en el puerto 3001?</p>
    `)
  }
}

function getFiltered() {
  const q = searchQuery.toLowerCase()
  const filtered = allPokemon.filter(p => {
    const matchName = !q || p.name.toLowerCase().includes(q)
    const matchTier = !selectedTier || p.tier === selectedTier
    const matchNatDex = !selectedNatDex || p.natDexTier === selectedNatDex
    return matchName && matchTier && matchNatDex
  })
  if (sortOrder === 'alpha') filtered.sort((a, b) => a.name.localeCompare(b.name))
  return filtered
}

function getUniqueValues(field) {
  return [...new Set(allPokemon.map(p => p[field]).filter(Boolean))].sort()
}

function tierBadge(value) {
  if (!value) return '<span class="tier-none">—</span>'
  return `<span class="tier-badge ${value}">${value}</span>`
}

function typeBadges(types) {
  return types.map(t => `<span class="type-badge type-${t}">${t}</span>`).join('')
}

function statsGrid(s) {
  return `
    <div class="stats-grid">
      <span><span class="stat-label stat-hp">HP</span><span class="stat-val">${s.hp}</span></span>
      <span><span class="stat-label stat-spa">SpA</span><span class="stat-val">${s.spa}</span></span>
      <span><span class="stat-label stat-atk">Atk</span><span class="stat-val">${s.attack}</span></span>
      <span><span class="stat-label stat-spd">SpD</span><span class="stat-val">${s.spd}</span></span>
      <span><span class="stat-label stat-def">Def</span><span class="stat-val">${s.defense}</span></span>
      <span><span class="stat-label stat-spe">Spe</span><span class="stat-val">${s.speed}</span></span>
    </div>
  `
}

function cardStats(s) {
  return `<div class="pokemon-card-stats">` +
    `<span class="stat-hp">${s.hp}</span>/` +
    `<span class="stat-atk">${s.attack}</span>/` +
    `<span class="stat-def">${s.defense}</span>/` +
    `<span class="stat-spa">${s.spa}</span>/` +
    `<span class="stat-spd">${s.spd}</span>/` +
    `<span class="stat-spe">${s.speed}</span>` +
    `</div>`
}

// Creates the static shell with controls (including search input) once per page visit.
// The search input lives here and is NEVER destroyed during typing.
function initShell() {
  const app = document.querySelector('#app')
  if (!app) return

  const tiers = getUniqueValues('tier')
  const natDexTiers = getUniqueValues('natDexTier')
  const tierOptions = tiers.map(t => `<option value="${t}">${t}</option>`).join('')
  const natDexOptions = natDexTiers.map(t => `<option value="${t}">${t}</option>`).join('')

  app.innerHTML = `
    <div class="back-bar">
      <a class="back-link" href="#lobby">← Volver</a>
    </div>
    <h1>Pokémon Draft</h1>
    <div class="controls">
      <input id="search" class="search-input" type="text" placeholder="Buscar por nombre..." />
      <select id="filter-tier" class="filter-select">
        <option value="">Todos los tiers</option>
        ${tierOptions}
      </select>
      <select id="filter-natdex" class="filter-select">
        <option value="">Todos los NatDex tiers</option>
        ${natDexOptions}
      </select>
      <div class="sort-toggle">
        <button id="sort-id" class="sort-btn">0-9</button>
        <button id="sort-alpha" class="sort-btn">A-Z</button>
      </div>
      <div class="view-toggle">
        <button id="view-grid" class="view-btn" title="Vista cuadrícula">⊞</button>
        <button id="view-table" class="view-btn" title="Vista tabla">☰</button>
      </div>
    </div>
    <div id="results-info" class="results-info"></div>
    <div id="pokemon-results"></div>
  `

  document.querySelector('#search').addEventListener('input', e => {
    searchQuery = e.target.value; currentPage = 1; renderResults()
  })
  document.querySelector('#filter-tier').addEventListener('change', e => {
    selectedTier = e.target.value; currentPage = 1; renderResults()
  })
  document.querySelector('#filter-natdex').addEventListener('change', e => {
    selectedNatDex = e.target.value; currentPage = 1; renderResults()
  })
  document.querySelector('#sort-id').addEventListener('click', () => {
    sortOrder = 'id'; currentPage = 1; renderResults()
  })
  document.querySelector('#sort-alpha').addEventListener('click', () => {
    sortOrder = 'alpha'; currentPage = 1; renderResults()
  })
  document.querySelector('#view-grid').addEventListener('click', () => {
    viewMode = 'grid'; renderResults()
  })
  document.querySelector('#view-table').addEventListener('click', () => {
    viewMode = 'table'; renderResults()
  })
}

function syncControlStates() {
  const searchEl = document.querySelector('#search')
  if (searchEl && searchEl.value !== searchQuery) searchEl.value = searchQuery

  const tierEl = document.querySelector('#filter-tier')
  if (tierEl && tierEl.value !== selectedTier) tierEl.value = selectedTier

  const natDexEl = document.querySelector('#filter-natdex')
  if (natDexEl && natDexEl.value !== selectedNatDex) natDexEl.value = selectedNatDex

  document.querySelector('#sort-id')?.classList.toggle('sort-btn-active', sortOrder === 'id')
  document.querySelector('#sort-alpha')?.classList.toggle('sort-btn-active', sortOrder === 'alpha')
  document.querySelector('#view-grid')?.classList.toggle('view-btn-active', viewMode === 'grid')
  document.querySelector('#view-table')?.classList.toggle('view-btn-active', viewMode === 'table')
}

// Only replaces the results section — never touches the search input
function renderResults() {
  syncControlStates()
  const filtered = getFiltered()
  const PAGE_SIZE = viewMode === 'grid' ? PAGE_SIZE_GRID : PAGE_SIZE_TABLE
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  if (currentPage > totalPages) currentPage = 1
  const start = (currentPage - 1) * PAGE_SIZE
  const page = filtered.slice(start, start + PAGE_SIZE)

  const infoEl = document.querySelector('#results-info')
  if (infoEl) infoEl.textContent = `${filtered.length} Pokémon encontrados`

  const container = document.querySelector('#pokemon-results')
  if (!container) return

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty-state">No se encontró ningún Pokémon</p>`
    return
  }

  const gridContent = `
    <div class="pokemon-grid">
      ${page.map(p => `
        <div class="pokemon-card">
          <img src="/api/sprite/${p.id}" alt="${p.name}" width="72" height="72" />
          <div class="pokemon-card-name">${p.name}</div>
          <div class="pokemon-card-types">${typeBadges(p.types)}</div>
          <div class="pokemon-card-tier">${tierBadge(p.tier)}</div>
          ${cardStats(p.stats)}
        </div>
      `).join('')}
    </div>
  `

  const tableContent = `
    <table class="pokemon-table">
      <thead>
        <tr>
          <th>Imagen</th><th>Nombre</th><th>Tipos</th>
          <th>Stats</th><th>Tier</th><th>NatDex Tier</th>
        </tr>
      </thead>
      <tbody>
        ${page.map(p => `
          <tr>
            <td class="td-img"><img src="/api/sprite/${p.id}" alt="${p.name}" width="64" height="64" /></td>
            <td class="pokemon-name">${p.name}</td>
            <td class="td-types">${typeBadges(p.types)}</td>
            <td>${statsGrid(p.stats)}</td>
            <td>${tierBadge(p.tier)}</td>
            <td>${tierBadge(p.natDexTier)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `

  container.innerHTML = `
    ${viewMode === 'grid' ? gridContent : tableContent}
    <div class="pagination">
      <button id="prev" ${currentPage === 1 ? 'disabled' : ''}>← Anterior</button>
      <span class="page-info">Página ${currentPage} de ${totalPages}</span>
      <button id="next" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente →</button>
    </div>
  `

  document.querySelector('#prev')?.addEventListener('click', () => { currentPage--; renderResults() })
  document.querySelector('#next')?.addEventListener('click', () => { currentPage++; renderResults() })
}

function render() {
  if (!document.querySelector('#pokemon-results')) {
    initShell()
  }
  syncControlStates()
  renderResults()
}

export function init() {
  fetchPokemon()
}
