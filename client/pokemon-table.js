const PAGE_SIZE = 20

let allPokemon = []
let currentPage = 1
let searchQuery = ''
let selectedTier = ''
let selectedNatDex = ''

async function fetchPokemon() {
  document.querySelector('#app').innerHTML = `<p class="loading">Cargando Pokémon...</p>`
  try {
    const res = await fetch('/api/pokemon', { cache: 'no-store' })
    allPokemon = await res.json()
    render()
  } catch (err) {
    document.querySelector('#app').innerHTML = `
      <p style="color: #ff6b6b;">Error al cargar. ¿Está corriendo el servidor en el puerto 3001?</p>
    `
  }
}

function getFiltered() {
  const q = searchQuery.toLowerCase()
  return allPokemon.filter(p => {
    const matchName = !q || p.name.toLowerCase().includes(q)
    const matchTier = !selectedTier || p.tier === selectedTier
    const matchNatDex = !selectedNatDex || p.natDexTier === selectedNatDex
    return matchName && matchTier && matchNatDex
  })
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

function render() {
  const filtered = getFiltered()
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  if (currentPage > totalPages) currentPage = 1
  const start = (currentPage - 1) * PAGE_SIZE
  const page = filtered.slice(start, start + PAGE_SIZE)

  const tiers = getUniqueValues('tier')
  const natDexTiers = getUniqueValues('natDexTier')

  const tierOptions = tiers.map(t => `<option value="${t}" ${selectedTier === t ? 'selected' : ''}>${t}</option>`).join('')
  const natDexOptions = natDexTiers.map(t => `<option value="${t}" ${selectedNatDex === t ? 'selected' : ''}>${t}</option>`).join('')

  const isEmpty = filtered.length === 0

  const tableOrEmpty = isEmpty
    ? `<p class="empty-state">No se encontró ningún Pokémon</p>`
    : `
      <table class="pokemon-table">
        <thead>
          <tr>
            <th>Imagen</th>
            <th>Nombre</th>
            <th>Tipos</th>
            <th>Stats</th>
            <th>Tier</th>
            <th>NatDex Tier</th>
          </tr>
        </thead>
        <tbody>
          ${page.map(p => `
            <tr>
              <td class="td-img"><img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.id}.png" alt="${p.name}" width="64" height="64" /></td>
              <td class="pokemon-name">${p.name}</td>
              <td class="td-types">${typeBadges(p.types)}</td>
              <td>${statsGrid(p.stats)}</td>
              <td>${tierBadge(p.tier)}</td>
              <td>${tierBadge(p.natDexTier)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="pagination">
        <button id="prev" ${currentPage === 1 ? 'disabled' : ''}>← Anterior</button>
        <span class="page-info">Página ${currentPage} de ${totalPages}</span>
        <button id="next" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente →</button>
      </div>
    `

  document.querySelector('#app').innerHTML = `
    <div class="back-bar">
      <a class="back-link" href="#lobby">← Volver</a>
    </div>
    <h1>Pokémon Draft</h1>
    <div class="controls">
      <input id="search" class="search-input" type="text" placeholder="Buscar por nombre..." value="${searchQuery}" />
      <select id="filter-tier" class="filter-select">
        <option value="">Todos los tiers</option>
        ${tierOptions}
      </select>
      <select id="filter-natdex" class="filter-select">
        <option value="">Todos los NatDex tiers</option>
        ${natDexOptions}
      </select>
    </div>
    <div class="results-info">${filtered.length} Pokémon encontrados</div>
    ${tableOrEmpty}
  `

  document.querySelector('#search').addEventListener('input', e => {
    searchQuery = e.target.value
    currentPage = 1
    render()
  })
  document.querySelector('#filter-tier').addEventListener('change', e => {
    selectedTier = e.target.value
    currentPage = 1
    render()
  })
  document.querySelector('#filter-natdex').addEventListener('change', e => {
    selectedNatDex = e.target.value
    currentPage = 1
    render()
  })
  document.querySelector('#prev')?.addEventListener('click', () => { currentPage--; render() })
  document.querySelector('#next')?.addEventListener('click', () => { currentPage++; render() })
}

export function init() {
  fetchPokemon()
}
