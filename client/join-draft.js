import { getSocket } from './socket.js'
import { setHTML, showConfirm, showToast } from './dom.js'

const PLAYER_COLORS = [
  '#e53935','#1e88e5','#43a047','#fb8c00',
  '#8e24aa','#00acc1','#f4511e','#795548',
  '#d81b60','#00897b','#fdd835','#3949ab',
  '#6d4c41','#546e7a','#c0ca33','#7b1fa2',
]

const TIER_RANK   = { Ubers:0, OU:1, UUBL:2, UU:3, RUBL:4, RU:5, NUBL:6, NU:7, PUBL:8, PU:9, ZU:10, NFE:11, LC:12 }
const TIER_BL_CHILD = { OU:'UUBL', UU:'RUBL', RU:'NUBL', NU:'PUBL' }
const BL_PARENT     = { UUBL:'OU', RUBL:'UU', NUBL:'RU', PUBL:'NU' }
const BL_TIERS      = new Set(Object.keys(BL_PARENT))

let _discordCtx = null
let _draftInstanceId = null
let _myId = null
let _pokemonAll = []
let _picks = []
let _pickOrder = []
let _currentPickIndex = 0
let _teamSize = 0
let _totalCoins = 0
let _draftName = ''
let _tierSlots = {}
let _maxMegas = 0
let _draftType = 'clasico'
let _tierCosts = {}
let _presetAssignments = null  // { [pokemonId]: points } | null
let _minBid = 0
let _minTeamSize = 0
let _auctionTimer = 10
let _auctionState = null       // current auction state from server
let _auctionLocalEnd = 0      // client-local ms timestamp derived from server secsLeft
let _countdownInterval = null  // setInterval for timer UI
let _isSpectator = false
let _prevAuctionActive = false // detect auction start/end to force section re-render
let _prevNominatorId = null    // detect nominator change to re-init picker
let _prevAuctionPokemonId = null // detect new nomination to play bell
let _audioCtx = null
let _viewingTeamOf = null   // userId whose team is shown in the grid, or null
let _pickSearch = ''
let _pickTier = ''
let _pickType = ''
let _pickMegaFilter = false
let _pickPage = 1
const PICK_PAGE_SIZE = 30

export function init(discordCtx, draftInstanceId) {
  _discordCtx = discordCtx
  _draftInstanceId = draftInstanceId
  _myId = discordCtx.user.id
  _picks = []
  _pickOrder = []
  _currentPickIndex = 0
  _teamSize = 0
  _totalCoins = 0
  _draftName = ''
  _tierSlots = {}
  _maxMegas = 0
  _draftType = 'clasico'
  _tierCosts = {}
  _presetAssignments = null
  _minBid = 0
  _minTeamSize = 0
  _auctionTimer = 10
  _auctionState = null
  _auctionLocalEnd = 0
  _countdownInterval = null
  _isSpectator = false
  _prevAuctionActive = false
  _prevNominatorId = null
  _prevAuctionPokemonId = null
  _viewingTeamOf = null
  _pickSearch = ''
  _pickTier = ''
  _pickType = ''
  _pickMegaFilter = false
  _pickPage = 1

  const socket = getSocket()
  const { sdk, user } = discordCtx

  socket.off('room-state')
  socket.off('draft-cancelled')
  socket.off('connect')

  const joinRoom = () => socket.emit('join-room', { instanceId: sdk.instanceId, draftInstanceId, user, channelId: sdk.channelId, guildId: sdk.guildId })
  socket.on('connect', joinRoom)
  joinRoom()

  socket.on('room-state', room => render(room))
  socket.on('draft-cancelled', ({ draftInstanceId: cancelledId }) => {
    if (cancelledId !== _draftInstanceId) return
    clearInterval(_countdownInterval)
    location.hash = '#lobby'
    showToast('El draft ha sido cancelado por el host')
  })
}

function currentPickerId(pickOrder, idx) {
  if (!pickOrder?.length) return null
  const n = pickOrder.length
  const round = Math.floor(idx / n)
  const pos = idx % n
  return pickOrder[round % 2 === 0 ? pos : n - 1 - pos]?.id ?? null
}

function avatarHTML(user, size = 64) {
  const initial = (user.global_name || user.username || '?')[0].toUpperCase()
  if (user.avatar) {
    return `<img class="participant-avatar" src="/api/avatar/${user.id}/${user.avatar}" width="${size}" height="${size}" alt="${user.username}" loading="lazy" />`
  }
  return `<div class="participant-avatar participant-avatar-initials" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${initial}</div>`
}

function playBellSound() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const ctx = _audioCtx
    const t = ctx.currentTime
    const v = 0.85 // 15% volume reduction
    // Gavel: impact thud (pitch drops), wooden resonance, sharp crack transient
    ;[[200, 70, 0.55, 0.14], [430, 430, 0.22, 0.28], [1000, 1000, 0.09, 0.032]].forEach(([fStart, fEnd, vol, decay]) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(fStart, t)
      if (fStart !== fEnd) osc.frequency.exponentialRampToValueAtTime(fEnd, t + decay)
      gain.gain.setValueAtTime(vol * v, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + decay)
      osc.start(t)
      osc.stop(t + decay + 0.01)
    })
  } catch {}
}

// ── Main render (room-state handler) ─────────────────────────────────────────

function render(room) {
  const app = document.querySelector('#app')
  if (!app) return

  const draft = room.drafts?.[_draftInstanceId]
  if (!draft) {
    document.querySelector('#app').innerHTML = `
      <div class="back-bar"><a class="back-link" href="#lobby">← Volver</a></div>
      <p class="loading">Esperando datos del draft…</p>
    `
    return
  }
  const phase = draft?.phase ?? 'lobby'

  // Sync picks state from server
  _picks = draft?.picks ?? []
  _pickOrder = draft?.pickOrder ?? []
  _currentPickIndex = draft?.currentPickIndex ?? 0
  _isSpectator = (phase === 'picking') && _pickOrder.length > 0 && !_pickOrder.some(p => p.id === _myId)
  _teamSize   = draft?.config?.teamSize ?? 0
  _totalCoins = draft?.config?.coins    ?? 0
  _draftName  = draft?.config?.name     ?? ''
  _tierSlots  = draft?.config?.tierSlots ?? {}
  _maxMegas   = draft?.config?.maxMegas  ?? 0
  _draftType          = draft?.config?.draftType ?? 'clasico'
  _tierCosts          = draft?.config?.tierCosts ?? {}
  _presetAssignments  = draft?.config?.presetAssignments ?? null
  _minBid             = draft?.config?.minBid ?? 0
  _minTeamSize        = draft?.config?.minTeamSize ?? _teamSize
  _auctionTimer       = draft?.config?.auctionTimer ?? 10
  _auctionState       = draft?.auctionState ?? null
  // Bell sound on new nomination
  const curAuctionPokemonId = _auctionState?.pokemonId ?? null
  if (curAuctionPokemonId && curAuctionPokemonId !== _prevAuctionPokemonId) playBellSound()
  _prevAuctionPokemonId = curAuctionPokemonId
  // Convert server-relative secsLeft to client-local end timestamp to avoid clock skew
  if (_auctionState) {
    const sl = _auctionState.secsLeft ?? 0
    if (sl > 0) {
      _auctionLocalEnd = Date.now() + sl * 1000
    } else if (_auctionLocalEnd <= Date.now()) {
      // secsLeft missing or 0 but auction active — fall back to configured timer duration
      _auctionLocalEnd = Date.now() + (_auctionTimer || 10) * 1000
    }
    // else: keep existing _auctionLocalEnd (still in the future)
  } else {
    _auctionLocalEnd = 0
  }

  // Draft finished — show results summary and stop
  if (phase === 'complete') {
    renderCompletedSummary()
    return
  }

  // Bootstrap two-section layout on first render for this page visit
  if (!document.querySelector('#draft-top')) {
    app.innerHTML = `
      <div class="back-bar"><a class="back-link" href="#lobby">← Volver</a></div>
      <div id="draft-top"></div>
      <div id="draft-pokemon"></div>
    `
  }

  renderTop(room)

  const pokemonSection = document.querySelector('#draft-pokemon')
  if (phase === 'picking' && pokemonSection) {
    const currentNominatorId = currentPickerId(_pickOrder, _currentPickIndex)
    const nominatorChanged   = _prevNominatorId !== currentNominatorId

    // Reset only free-text search on turn change; keep tier/type/mega filters
    if (nominatorChanged) {
      _pickSearch = ''; _pickPage = 1
      const searchEl = document.querySelector('#pick-search')
      if (searchEl) searchEl.value = ''
    }

    if (_draftType === 'subasta') {
      const auctionActive = !!_auctionState

      if (auctionActive !== _prevAuctionActive || nominatorChanged) {
        pokemonSection.dataset.init = ''
        clearInterval(_countdownInterval)
      }
      // When the nomination turn passes to us, clear any open team view
      if (nominatorChanged && currentNominatorId === _myId) {
        _viewingTeamOf = null
      }
      _prevAuctionActive = auctionActive
      _prevNominatorId = currentNominatorId

      if (auctionActive) {
        renderAuctionPanel(pokemonSection)
      } else if (currentNominatorId === _myId) {
        if (!pokemonSection.dataset.init) {
          pokemonSection.dataset.init = '1'
          if (_pokemonAll.length > 0) renderNominationPicker(pokemonSection)
          else initNominationPicker(pokemonSection)
        } else if (document.querySelector('#pick-results')) {
          renderPickResults()
        }
      } else {
        pokemonSection.dataset.init = ''
        renderWaitingForNomination(pokemonSection, currentNominatorId)
      }
    } else {
      _prevNominatorId = currentNominatorId
      if (!pokemonSection.dataset.init) {
        pokemonSection.dataset.init = '1'
        if (_pokemonAll.length > 0) {
          renderPokemonPicker(pokemonSection)
        } else {
          initPokemonPicker(pokemonSection)
        }
      } else if (document.querySelector('#pick-results')) {
        renderPickResults()
      }
    }
  }
}

// ── PokePaste helpers ─────────────────────────────────────────────────────────

function toPokePasteName(name) {
  return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-')
}

function buildPokePaste(pokemon) {
  return pokemon.map(p => toPokePasteName(p.pokemonName)).join('\n\n')
}

async function tryWriteClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true } catch {}
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {}
  return false
}

function showPokePasteModal(text) {
  const existing = document.querySelector('#pokepaste-modal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
  modal.id = 'pokepaste-modal'
  modal.className = 'pokepaste-modal-overlay'
  modal.innerHTML = `
    <div class="pokepaste-modal">
      <div class="pokepaste-modal-header">
        <span>PokePaste — selecciona y copia</span>
        <button class="pokepaste-modal-close">✕</button>
      </div>
      <textarea class="pokepaste-modal-text" readonly>${text}</textarea>
    </div>
  `
  document.body.appendChild(modal)

  const ta = modal.querySelector('textarea')
  ta.focus(); ta.select()

  modal.querySelector('.pokepaste-modal-close').addEventListener('click', () => modal.remove())
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
}

// ── Draft complete summary ─────────────────────────────────────────────────────

function renderCompletedSummary() {
  const app = document.querySelector('#app')
  if (!app) return

  const teams = _pickOrder.map(player => ({
    ...player,
    pokemon: _picks
      .filter(pk => pk.userId === player.id)
      .sort((a, b) => a.pickOrder - b.pickOrder),
  }))

  app.innerHTML = `
    <div class="back-bar"><a class="back-link" href="#lobby">← Volver al lobby</a></div>
    <div class="draft-detail-header">
      <h1>${_draftName || 'Draft'}</h1>
      <div class="draft-detail-meta">
        <span class="draft-phase-chip draft-phase-chip-complete">Completado</span>
        <span>${teams.length} jugadores · ${_teamSize} Pokémon/equipo</span>
      </div>
    </div>
    <div class="team-cards">
      ${teams.map(t => {
        const color   = playerColor(t.id)
        const initial = (t.global_name || t.username || '?')[0].toUpperCase()
        const avatar  = t.avatar
          ? `<img class="participant-avatar" src="/api/avatar/${t.id}/${t.avatar}" width="36" height="36" alt="${t.username}" loading="lazy" />`
          : `<div class="participant-avatar participant-avatar-initials" style="width:36px;height:36px;font-size:14px;background:${color}">${initial}</div>`
        return `
          <div class="team-card" style="border-color:${color}">
            <div class="team-card-header" style="background:${color}18">
              ${avatar}
              <span class="team-card-name">${t.global_name || t.username}</span>
              <span class="team-card-count" style="color:${color}">${t.pokemon.length}/${_teamSize}</span>
              <button class="copy-pokepaste-btn" data-user-id="${t.id}">Pokepast</button>
            </div>
            <div class="team-pokemon-grid">
              ${t.pokemon.map(p => `
                <div class="team-pokemon-item">
                  <img src="/api/sprite/${p.pokemonId}" alt="${p.pokemonName}" width="56" height="56" />
                  <div class="team-pokemon-name">${p.pokemonName}</div>
                  ${p.tier ? `<span class="tier-badge ${p.tier}">${p.tier}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `
      }).join('')}
    </div>
  `

  app.querySelectorAll('.copy-pokepaste-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const team = teams.find(t => t.id === btn.dataset.userId)
      if (!team || team.pokemon.length === 0) return
      const text = buildPokePaste(team.pokemon)
      const ok = await tryWriteClipboard(text)
      if (ok) {
        btn.textContent = '✓ Copiado'
        setTimeout(() => { btn.textContent = 'Pokepast' }, 2000)
      } else {
        showPokePasteModal(text)
      }
    })
  })
}

// ── Top section (player cards + banners + action) ─────────────────────────────

function renderTop(room) {
  const top = document.querySelector('#draft-top')
  if (!top) return

  const { sdk, user } = _discordCtx
  const draft = room.drafts?.[_draftInstanceId]
  const isCreator = draft?.creatorId === user.id
  const phase = draft?.phase ?? 'lobby'
  const readyPlayers = draft?.readyPlayers ?? []
  const participants = (phase === 'picking' && draft?.pickOrder?.length)
    ? draft.pickOrder
    : draft?.participants ?? []

  const currentId = phase === 'picking'
    ? currentPickerId(draft.pickOrder, draft.currentPickIndex ?? 0)
    : null

  const roundNum = (draft?.currentPickIndex != null && draft?.pickOrder?.length)
    ? Math.floor(draft.currentPickIndex / draft.pickOrder.length) + 1
    : null

  const readyCount = (draft?.participants ?? []).filter(p => readyPlayers.includes(p.id)).length
  const allReady = (draft?.participants ?? []).length > 0 && readyCount === (draft?.participants ?? []).length

  // ── Phase banner ────────────────────────────────────────────────────────────
  let phaseBanner = ''
  if (phase === 'picking' && currentId) {
    const picker = participants.find(p => p.id === currentId)
    const isMyTurn = currentId === user.id
    if (_draftType === 'subasta') {
      const auction = draft?.auctionState
      if (auction) {
        const bannerSecs = Math.max(0, Math.ceil((_auctionLocalEnd - Date.now()) / 1000))
        phaseBanner = `
          <div class="draft-phase-banner">
            <span style="font-size:1.3rem">🔨</span>
            <span class="draft-phase-text">
              En subasta: <strong>${auction.pokemonName}</strong>
              · Puja: <strong>💰 ${auction.currentBid.toLocaleString()}</strong>
              por ${auction.highestBidderName}
              · ⏱ ${bannerSecs}s
            </span>
          </div>
        `
      } else {
        phaseBanner = `
          <div class="draft-phase-banner ${isMyTurn ? 'draft-phase-banner-me' : ''}">
            ${avatarHTML(picker, 36)}
            <span class="draft-phase-text">
              ${isMyTurn ? '⚡ ¡Es tu turno de nominar un Pokémon!' : `Nomina <strong>${picker?.global_name || picker?.username}</strong>`}
            </span>
            <span class="draft-round-badge">Ronda ${roundNum}</span>
          </div>
        `
      }
    } else {
      phaseBanner = `
        <div class="draft-phase-banner ${isMyTurn ? 'draft-phase-banner-me' : ''}">
          ${avatarHTML(picker, 36)}
          <span class="draft-phase-text">
            ${isMyTurn ? '¡Es tu turno de elegir!' : `Turno de <strong>${picker?.global_name || picker?.username}</strong>`}
          </span>
          <span class="draft-round-badge">Ronda ${roundNum}</span>
        </div>
      `
    }
  }

  // ── Snake order bar ─────────────────────────────────────────────────────────
  let snakeInfo = ''
  if (phase === 'picking' && draft?.pickOrder?.length && _draftType !== 'subasta') {
    const n = draft.pickOrder.length
    const isReversed = Math.floor((draft.currentPickIndex ?? 0) / n) % 2 !== 0
    const roundOrder = isReversed ? [...draft.pickOrder].reverse() : [...draft.pickOrder]
    const arrows = roundOrder.map((p, i) => {
      const active = p.id === currentId
      return `<span class="snake-name ${active ? 'snake-name-active' : ''}">${p.global_name || p.username}</span>${i < roundOrder.length - 1 ? '<span class="snake-arrow">→</span>' : ''}`
    }).join('')
    snakeInfo = `
      <div class="snake-order-bar">
        <span class="snake-label">Orden ronda ${roundNum}${isReversed ? ' (↩)' : ''}:</span>
        ${arrows}
      </div>
    `
  }

  // ── Player cards ────────────────────────────────────────────────────────────
  const snakeN = draft?.pickOrder?.length ?? 0
  const isReversed = phase === 'picking' && snakeN > 0
    ? Math.floor((draft.currentPickIndex ?? 0) / snakeN) % 2 !== 0
    : false

  const cardHtmlArr = participants.map((p, i) => {
    const isCurrent  = p.id === currentId
    const isMe       = p.id === user.id
    const isReady    = readyPlayers.includes(p.id)
    const isViewing  = phase === 'picking' && _viewingTeamOf === p.id
    const isClickable = phase === 'picking'

    const color = phase === 'picking' ? playerColor(p.id) : null
    const viewStyle = isViewing && color
      ? `style="border-color:${color};box-shadow:0 0 0 4px ${color}28"`
      : ''
    const spentCoins = phase === 'picking'
      ? _picks.filter(pk => pk.userId === p.id).reduce((s, pk) => s + (pk.cost ?? 0), 0)
      : 0
    const remainingCoins = _totalCoins - spentCoins
    const pDone = phase === 'picking' && isPlayerDone(p.id)

    return `
      <div class="participant-card
        ${isCurrent   ? ' participant-card-active'  : ''}
        ${isMe        ? ' participant-card-me'       : ''}
        ${isReady && phase === 'lobby' ? ' participant-card-ready' : ''}
        ${isClickable ? ' participant-card-clickable' : ''}
        ${isViewing   ? ' participant-card-viewing'  : ''}
        ${pDone       ? ' participant-card-done'     : ''}"
        data-user-id="${p.id}"
        ${viewStyle}>
        ${phase === 'picking' ? `<span class="pick-order-badge" style="background:${color}">${i + 1}</span>` : ''}
        ${isReady && phase === 'lobby' ? '<span class="ready-check">✓</span>' : ''}
        ${avatarHTML(p, 64)}
        <span class="participant-card-name">${p.global_name || p.username}${isMe ? ' (tú)' : ''}</span>
        ${phase === 'picking' && _draftType !== 'clasico' ? `<span class="player-coins" style="color:${pDone ? '#999' : color}">${_draftType === 'puntos' ? '⭐' : '💰'} ${remainingCoins}${pDone ? ' ✓' : ''}</span>` : ''}
        ${isCurrent ? '<span class="picking-indicator">Eligiendo…</span>' : ''}
        ${isMe && phase === 'lobby' ? `
          <button class="ready-btn ${isReady ? 'ready-btn-on' : ''}" id="ready-btn">
            ${isReady ? '✓ Listo' : 'Estoy listo'}
          </button>` : ''}
        ${isCreator && phase === 'picking' && !isMe ? `<button class="notify-btn" data-user-id="${p.id}" title="Enviar recordatorio por DM">🔔</button>` : ''}
      </div>
    `
  })

  // Build connector element between consecutive cards
  const snakeConnector = phase === 'picking' && cardHtmlArr.length > 1
    ? isReversed
      ? `<div class="snake-card-connector"><span class="scc-head">◀</span><span class="scc-line"></span></div>`
      : `<div class="snake-card-connector"><span class="scc-line"></span><span class="scc-head">▶</span></div>`
    : null

  const cards = snakeConnector
    ? cardHtmlArr.join(snakeConnector)
    : cardHtmlArr.join('')

  // ── Action area ─────────────────────────────────────────────────────────────
  let actionArea = ''
  if (phase === 'lobby') {
    if (isCreator) {
      actionArea = `
        <div class="start-area">
          <p class="ready-counter ${allReady ? 'ready-counter-ok' : ''}">${readyCount} / ${(draft?.participants ?? []).length} listos</p>
          <button id="start-picks-btn" class="start-picks-btn">⚔️ Iniciar Picks</button>
        </div>
      `
    } else {
      actionArea = `<p class="waiting-msg">Esperando a que el creador inicie los picks…</p>`
    }
  }

  const TYPE_ICON = { clasico: '🐍', subasta: '🔨', puntos: '⭐' }
  const cancelBtn = isCreator && !_isSpectator
    ? `<button class="cancel-draft-btn" id="cancel-draft-btn">🗑 Cancelar draft</button>`
    : ''

  const spectatorBanner = _isSpectator
    ? `<div class="spectator-banner">👁 Modo espectador</div>`
    : ''

  setHTML(top, `
    <h1>${draft?.config?.name || 'Draft'} <span style="font-size:0.6em;opacity:0.55;font-weight:400">${TYPE_ICON[_draftType] ?? ''} ${_draftType}</span></h1>
    ${spectatorBanner}
    ${phaseBanner}
    ${snakeInfo}
    <div class="participant-cards${phase === 'picking' ? ' participant-cards-snake' : ''}">${cards}</div>
    ${actionArea}
    ${cancelBtn}
  `)

  // Player card clicks — toggle team view for other players in picking phase
  if (phase === 'picking') {
    top.querySelectorAll('.participant-card-clickable[data-user-id]').forEach(card => {
      card.addEventListener('click', () => {
        const uid = card.dataset.userId
        _viewingTeamOf = (_viewingTeamOf === uid) ? null : uid
        // Update card highlight immediately without full re-render
        top.querySelectorAll('.participant-card[data-user-id]').forEach(c => {
          const isNowViewing = _viewingTeamOf === c.dataset.userId
          c.classList.toggle('participant-card-viewing', isNowViewing)
          if (isNowViewing) {
            const col = playerColor(c.dataset.userId)
            c.style.borderColor = col
            c.style.boxShadow = `0 0 0 4px ${col}28`
          } else {
            c.style.borderColor = ''
            c.style.boxShadow   = ''
          }
        })
        renderPickResults()
      })
    })
  }

  top.querySelectorAll('.notify-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      getSocket().emit('send-turn-dm', {
        instanceId: sdk.instanceId,
        draftInstanceId: _draftInstanceId,
        targetUserId: btn.dataset.userId,
      })
      btn.textContent = '✓'
      setTimeout(() => { btn.textContent = '🔔' }, 2000)
    })
  })

  document.querySelector('#cancel-draft-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirm(
      '¿Seguro que quieres cancelar el draft?<br>Se eliminará para todos los participantes.',
      'Cancelar draft'
    )
    if (!confirmed) return
    getSocket().emit('cancel-draft', { instanceId: sdk.instanceId, draftInstanceId: _draftInstanceId })
  })

  document.querySelector('#ready-btn')?.addEventListener('click', () => {
    getSocket().emit('toggle-ready', { instanceId: sdk.instanceId, draftInstanceId: _draftInstanceId })
  })

  document.querySelector('#start-picks-btn')?.addEventListener('click', async () => {
    if (!allReady) {
      const notReady = (draft?.participants ?? [])
        .filter(p => !readyPlayers.includes(p.id))
        .map(p => p.global_name || p.username)
      const plural = notReady.length > 1
      const msg = `<strong>${notReady.join(', ')}</strong> no ${plural ? 'están listos' : 'está listo'}.<br>¿Iniciar los picks de todas formas?`
      const confirmed = await showConfirm(msg, 'Iniciar de todas formas')
      if (!confirmed) return
    }
    getSocket().emit('start-picks', { instanceId: sdk.instanceId, draftInstanceId: _draftInstanceId })
  })
}

// ── Pokemon picker (picking phase only) ──────────────────────────────────────

async function initPokemonPicker(container) {
  container.innerHTML = `<p class="loading" style="margin-top:2rem">Cargando Pokémon…</p>`
  try {
    const res = await fetch('/api/pokemon', { cache: 'no-store' })
    _pokemonAll = await res.json()
    renderPokemonPicker(container)
  } catch {
    container.innerHTML = `<p style="color:var(--red);margin-top:1rem">Error al cargar los Pokémon</p>`
  }
}

function getFilteredPokemon() {
  const q = _pickSearch.toLowerCase()
  return _pokemonAll.filter(p => {
    if (_presetAssignments && !(String(p.id) in _presetAssignments)) return false
    const matchName = !q || p.name.toLowerCase().includes(q)
    const matchTier = !_pickTier || p.tier === _pickTier || p.tier === TIER_BL_CHILD[_pickTier]
    const matchType = !_pickType || (p.types && p.types.includes(_pickType))
    const matchMega = !_pickMegaFilter || p.name.includes('-mega')
    return matchName && matchTier && matchType && matchMega
  })
}

function typeBadges(types) {
  return types.map(t => `<span class="type-badge type-${t}">${t}</span>`).join('')
}

function tierBadge(value) {
  if (!value) return '<span class="tier-none">—</span>'
  return `<span class="tier-badge ${value}">${value}</span>`
}

function playerColor(userId) {
  const idx = _pickOrder.findIndex(p => p.id === userId)
  return idx >= 0 ? PLAYER_COLORS[idx % PLAYER_COLORS.length] : '#888'
}

function pickerDisplayName(userId) {
  const p = _pickOrder.find(p => p.id === userId)
  return p ? (p.global_name || p.username) : '?'
}

function isPlayerDone(userId) {
  const picks   = _picks.filter(pk => pk.userId === userId)
  const myCount = picks.length
  if (myCount >= _teamSize) return true
  if (_minBid > 0 && _minTeamSize > 0 && myCount >= _minTeamSize) {
    const mySpent = picks.reduce((s, pk) => s + (pk.cost ?? 0), 0)
    if (_totalCoins - mySpent < _minBid) return true
  }
  return false
}

function canPickTier(newTier, myPickTiers, tierSlots) {
  if (!newTier || TIER_RANK[newTier] === undefined) {
    return (tierSlots[newTier] ?? 0) > myPickTiers.filter(t => t === newTier).length
  }
  const allRanks = [...myPickTiers.filter(t => TIER_RANK[t] !== undefined), newTier]
    .map(t => TIER_RANK[t]).sort((a, b) => a - b)
  const slotRanks = []
  for (const [t, count] of Object.entries(tierSlots)) {
    if (TIER_RANK[t] !== undefined) for (let i = 0; i < (count || 0); i++) slotRanks.push(TIER_RANK[t])
  }
  slotRanks.sort((a, b) => a - b)
  const used = new Array(slotRanks.length).fill(false)
  for (const pr of allRanks) {
    let best = -1
    for (let i = 0; i < slotRanks.length; i++) {
      if (!used[i] && slotRanks[i] <= pr && (best === -1 || slotRanks[i] > slotRanks[best])) best = i
    }
    if (best === -1) return false
    used[best] = true
  }
  return true
}

// ── Subasta auction panel ────────────────────────────────────────────────────

function renderAuctionPanel(container) {
  const auction = _auctionState
  if (!auction) return
  const prevCustomAmount = document.querySelector('#auction-custom-amount')?.value ?? ''

  const myCount = _picks.filter(pk => pk.userId === _myId).length
  const mySpent = _picks.filter(pk => pk.userId === _myId).reduce((s, pk) => s + (pk.cost ?? 0), 0)
  const myCoins = _totalCoins - mySpent

  const isExcluded      = isPlayerDone(_myId)
  const isHighestBidder = auction.highestBidderId === _myId
  const isNominator     = auction.nominatorId === _myId
  const canBid          = !_isSpectator && !isExcluded && !isHighestBidder && !(isNominator && !auction.hasOtherBid)

  const bidIncrement   = Math.ceil(_minBid / 3)
  const quickAmount    = auction.currentBid + bidIncrement
  const reserve        = Math.max(0, _minTeamSize - myCount - 1) * _minBid
  const canAffordQuick = myCoins >= quickAmount + reserve
  const allInAmount    = myCoins - reserve

  const totalSeconds = _auctionTimer || 10
  const timeLeft = Math.max(0, Math.ceil((_auctionLocalEnd - Date.now()) / 1000))
  const timerPct = Math.min(100, (timeLeft / totalSeconds) * 100)

  container.innerHTML = `
    <div class="auction-panel">
      <div class="auction-pokemon">
        <img src="/api/sprite/${auction.pokemonId}" alt="${auction.pokemonName}" width="96" height="96" loading="lazy" />
        <div>
          <div class="auction-pokemon-name">${auction.pokemonName}</div>
          ${auction.tier ? `<span class="tier-badge ${auction.tier}">${auction.tier}</span>` : ''}
          <div style="font-size:0.78rem;opacity:0.55;margin-top:0.25rem">
            Nominado por ${_pickOrder.find(p => p.id === auction.nominatorId)?.global_name || _pickOrder.find(p => p.id === auction.nominatorId)?.username || '?'}
          </div>
        </div>
      </div>

      <div class="auction-bid-info">
        <div class="auction-current-bid">
          <span class="auction-bid-label">Puja actual</span>
          <span class="auction-bid-amount">💰 ${auction.currentBid.toLocaleString()}</span>
        </div>
        <div class="auction-timer" id="auction-timer-display">⏱ ${timeLeft}s</div>
        <div class="auction-bidder">Por: <strong>${auction.highestBidderName}</strong></div>
        <div class="auction-timer-bar-wrap">
          <div class="auction-timer-bar" id="auction-timer-bar" style="width:${timerPct}%"></div>
        </div>
      </div>

      ${!_isSpectator ? `
      <div class="auction-my-status">
        💰 ${myCoins.toLocaleString()} disponibles · ${myCount}/${_teamSize} Pokémon
        ${reserve > 0 ? `· Reserva mínima: ${reserve.toLocaleString()}` : ''}
      </div>` : ''}

      ${_isSpectator ? `
        <div class="auction-status-msg">👁 Modo espectador</div>
      ` : `
        ${isHighestBidder ? `<div class="auction-status-msg auction-status-winning">✓ Estás ganando esta subasta</div>` : ''}
        ${isNominator && !auction.hasOtherBid ? `<div class="auction-status-msg">Has nominado este Pokémon. Espera a que otro jugador puje.</div>` : ''}
        ${isExcluded ? `<div class="auction-status-msg">${myCount >= _teamSize ? 'Tu equipo está completo — no puedes pujar.' : 'Tienes el mínimo de Pokémon y no tienes fondos suficientes para seguir pujando.'}</div>` : ''}
        <div class="auction-bid-actions">
          <button class="auction-bid-btn" id="auction-quick-bid" ${!canBid || !canAffordQuick ? 'disabled' : ''}>
            +${bidIncrement.toLocaleString()} → Pujar ${quickAmount.toLocaleString()}
          </button>
          <button class="auction-bid-btn auction-bid-btn-allin" id="auction-allin-bid" ${!canBid || allInAmount <= auction.currentBid ? 'disabled' : ''}>
            All-in 💰 ${allInAmount.toLocaleString()}
          </button>
          <div class="auction-custom-bid">
            <input class="form-input" type="number" id="auction-custom-amount"
              min="${auction.currentBid + 1}" max="${allInAmount}" step="${bidIncrement}" ${!canBid ? 'disabled' : ''} />
            <button class="auction-bid-btn auction-bid-btn-custom" id="auction-custom-submit" ${!canBid ? 'disabled' : ''}>Pujar</button>
          </div>
        </div>
      `}
    </div>
  `

  // Restore custom amount the user was typing before re-render
  const customInput = document.querySelector('#auction-custom-amount')
  if (customInput && prevCustomAmount) customInput.value = prevCustomAmount

  document.querySelector('#auction-quick-bid')?.addEventListener('click', () => {
    placeBid(quickAmount)
  })
  document.querySelector('#auction-allin-bid')?.addEventListener('click', () => {
    if (allInAmount > auction.currentBid) placeBid(allInAmount)
  })
  document.querySelector('#auction-custom-submit')?.addEventListener('click', () => {
    const amount = parseInt(document.querySelector('#auction-custom-amount')?.value ?? 0)
    if (amount > auction.currentBid && myCoins >= amount + reserve) placeBid(amount)
  })

  startCountdown(_auctionLocalEnd, totalSeconds)
}

function startCountdown(timerEnd, totalSeconds) {
  clearInterval(_countdownInterval)
  _countdownInterval = setInterval(() => {
    const el  = document.querySelector('#auction-timer-display')
    const bar = document.querySelector('#auction-timer-bar')
    if (!el) { clearInterval(_countdownInterval); return }
    const left = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000))
    el.textContent = `⏱ ${left}s`
    if (bar) bar.style.width = `${Math.min(100, (left / totalSeconds) * 100)}%`
    if (left <= 0) clearInterval(_countdownInterval)
  }, 250)
}

function placeBid(amount) {
  getSocket().emit('place-bid', {
    instanceId: _discordCtx.sdk.instanceId,
    draftInstanceId: _draftInstanceId,
    amount,
  })
}

function renderWaitingForNomination(container, nominatorId) {
  const nominator = _pickOrder.find(p => p.id === nominatorId)
  const teams = _pickOrder.map(player => ({
    ...player,
    pokemon: _picks
      .filter(pk => pk.userId === player.id)
      .sort((a, b) => a.pickOrder - b.pickOrder),
  }))

  container.innerHTML = `
    <div class="auction-waiting-header">
      <span style="font-size:1.5rem">🔨</span>
      Esperando a que <strong>${nominator?.global_name || nominator?.username || '?'}</strong> nomine un Pokémon…
    </div>
    <div class="team-cards">
      ${teams.map(t => {
        const color   = playerColor(t.id)
        const initial = (t.global_name || t.username || '?')[0].toUpperCase()
        const avatar  = t.avatar
          ? `<img class="participant-avatar" src="/api/avatar/${t.id}/${t.avatar}" width="36" height="36" alt="${t.username}" loading="lazy" />`
          : `<div class="participant-avatar participant-avatar-initials" style="width:36px;height:36px;font-size:14px;background:${color}">${initial}</div>`
        const spentCoins = _picks.filter(pk => pk.userId === t.id).reduce((s, pk) => s + (pk.cost ?? 0), 0)
        const remaining  = _totalCoins - spentCoins
        return `
          <div class="team-card" style="border-color:${color}">
            <div class="team-card-header" style="background:${color}18">
              ${avatar}
              <span class="team-card-name">${t.global_name || t.username}</span>
              <span class="team-card-count" style="color:${color}">💰 ${remaining.toLocaleString()}</span>
            </div>
            <div class="team-pokemon-grid">
              ${t.pokemon.map(p => `
                <div class="team-pokemon-item">
                  <img src="/api/sprite/${p.pokemonId}" alt="${p.pokemonName}" width="56" height="56" />
                  <div class="team-pokemon-name">${p.pokemonName}</div>
                </div>
              `).join('')}
              ${t.pokemon.length === 0 ? `<div style="opacity:0.4;font-size:0.8rem;padding:0.5rem">Sin Pokémon aún</div>` : ''}
            </div>
          </div>
        `
      }).join('')}
    </div>
  `
}

async function initNominationPicker(container) {
  container.innerHTML = `<p class="loading" style="margin-top:2rem">Cargando Pokémon…</p>`
  try {
    const res = await fetch('/api/pokemon', { cache: 'no-store' })
    _pokemonAll = await res.json()
    renderNominationPicker(container)
  } catch {
    container.innerHTML = `<p style="color:var(--red);margin-top:1rem">Error al cargar los Pokémon</p>`
  }
}

function renderNominationPicker(container) {
  if (!document.querySelector('#pick-results')) {
    initPickerShell(container)
  }
  renderPickResults()
}

function showPickConfirm(pokemonId, pokemonName, tier) {
  return new Promise(resolve => {
    const existing = document.querySelector('#pick-confirm-modal')
    if (existing) existing.remove()

    const pokemon  = _pokemonAll.find(p => p.id === pokemonId)
    const tierCost = _draftType === 'puntos'
      ? (_presetAssignments ? (_presetAssignments[String(pokemonId)] ?? 0) : (_tierCosts[tier] ?? 0))
      : null
    const actionLabel = _draftType === 'subasta' ? 'Nominar' : 'Elegir'

    const modal = document.createElement('div')
    modal.id = 'pick-confirm-modal'
    modal.className = 'pick-confirm-overlay'
    modal.innerHTML = `
      <div class="pick-confirm-dialog">
        <img src="/api/sprite/${pokemonId}" alt="${pokemonName}" width="96" height="96" />
        <div class="pick-confirm-name">${pokemonName}</div>
        ${pokemon?.types?.length ? `<div class="pick-confirm-types">${typeBadges(pokemon.types)}</div>` : ''}
        ${tier ? `<div>${tierBadge(tier)}</div>` : ''}
        ${tierCost ? `<div class="pick-confirm-cost">⭐ ${tierCost} puntos</div>` : ''}
        <div class="pick-confirm-actions">
          <button class="pick-confirm-btn pick-confirm-cancel">Cancelar</button>
          <button class="pick-confirm-btn pick-confirm-ok">${actionLabel}</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    modal.querySelector('.pick-confirm-ok').addEventListener('click', () => { modal.remove(); resolve(true) })
    modal.querySelector('.pick-confirm-cancel').addEventListener('click', () => { modal.remove(); resolve(false) })
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(false) } })
  })
}

// Creates the picker controls shell once — search input is never destroyed during typing
function initPickerShell(container) {
  const tiers = [...new Set(_pokemonAll.map(p => p.tier).filter(t => t && !BL_TIERS.has(t)))]
    .sort((a, b) => (TIER_RANK[a] ?? 999) - (TIER_RANK[b] ?? 999))
  const tierOpts = tiers.map(t => `<option value="${t}">${t}</option>`).join('')

  const ALL_TYPES = ['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy']
  const typeOpts = ALL_TYPES.map(t => `<option value="${t.toLowerCase()}">${t}</option>`).join('')

  container.innerHTML = `
    <div class="pick-pokemon-section">
      <div class="controls">
        <input id="pick-search" class="search-input" type="text" placeholder="Buscar por nombre…" />
        <select id="pick-tier" class="filter-select">
          <option value="">Todos los tiers</option>
          ${tierOpts}
        </select>
        <select id="pick-type" class="filter-select">
          <option value="">Todos los tipos</option>
          ${typeOpts}
        </select>
        <span id="pick-results-info" class="results-info" style="margin-left:auto"></span>
      </div>
      <div id="pick-tier-slots"></div>
      <div id="pick-results"></div>
    </div>
  `

  document.querySelector('#pick-search').addEventListener('input', e => {
    _pickSearch = e.target.value; _pickPage = 1; renderPickResults()
  })
  document.querySelector('#pick-tier').addEventListener('change', e => {
    _pickTier = e.target.value; _pickMegaFilter = false; _pickPage = 1; renderPickResults()
  })
  document.querySelector('#pick-type').addEventListener('change', e => {
    _pickType = e.target.value; _pickPage = 1; renderPickResults()
  })

  // Event delegation for picks — on container so it survives grid re-renders
  container.addEventListener('click', async e => {
    const card = e.target.closest('.pokemon-card-pickable')
    if (!card) return
    const pokemonId   = parseInt(card.dataset.id)
    const pokemonName = card.dataset.name
    const tier        = card.dataset.tier || null
    const confirmed   = await showPickConfirm(pokemonId, pokemonName, tier)
    if (!confirmed) return
    getSocket().emit(_draftType === 'subasta' ? 'nominate-pokemon' : 'pick-pokemon', {
      instanceId: _discordCtx.sdk.instanceId,
      draftInstanceId: _draftInstanceId,
      pokemonId,
      pokemonName,
      tier,
    })
  })
}

function renderTierSlotsRow(userId, clickable = false) {
  const el = document.querySelector('#pick-tier-slots')
  if (!el) return

  const hasTierSlots = Object.values(_tierSlots).some(v => v > 0)
  if (!hasTierSlots && _maxMegas === 0) { el.innerHTML = ''; return }

  const playerPicks = _picks.filter(pk => pk.userId === userId)
  const megaCount = playerPicks.filter(pk => pk.pokemonName?.includes('-mega')).length

  // Build chips: merge each BL tier into its parent tier
  const chipData = []
  const sortedEntries = Object.entries(_tierSlots).sort(([a], [b]) => (TIER_RANK[a] ?? 999) - (TIER_RANK[b] ?? 999))
  for (const [tier, max] of sortedEntries) {
    if (max === 0 || BL_TIERS.has(tier)) continue
    const blChild = TIER_BL_CHILD[tier]
    const combinedMax = max + (_tierSlots[blChild] ?? 0)
    const used = playerPicks.filter(pk => pk.tier === tier || pk.tier === blChild).length
    chipData.push({ tier, combinedMax, used })
  }
  // Standalone BL tiers whose parent isn't configured
  for (const [tier, max] of sortedEntries) {
    if (max === 0 || !BL_TIERS.has(tier) || (_tierSlots[BL_PARENT[tier]] ?? 0) > 0) continue
    const used = playerPicks.filter(pk => pk.tier === tier).length
    chipData.push({ tier, combinedMax: max, used })
  }

  el.innerHTML = `
    <div class="pick-tier-slots${clickable ? ' pick-tier-slots-interactive' : ''}">
      ${chipData.map(({ tier, combinedMax, used }) => `
        <span class="pick-tier-chip${used >= combinedMax ? ' pick-tier-chip-full' : ''}${_pickTier === tier ? ' pick-tier-chip-active' : ''}" data-tier="${tier}">
          <span class="tier-badge ${tier}">${tier}</span>
          <span class="pick-tier-chip-count">${used}/${combinedMax}</span>
        </span>`).join('')}
      ${_maxMegas > 0 ? `
        <span class="pick-tier-chip pick-tier-chip-mega${megaCount >= _maxMegas ? ' pick-tier-chip-full' : ''}${_pickMegaFilter ? ' pick-tier-chip-active' : ''}">
          <span class="tier-badge tier-mega">mega</span>
          <span class="pick-tier-chip-count">${megaCount}/${_maxMegas}</span>
        </span>` : ''}
    </div>
  `

  if (!clickable) return

  el.querySelectorAll('.pick-tier-chip[data-tier]').forEach(chip => {
    chip.addEventListener('click', () => {
      _pickTier = (_pickTier === chip.dataset.tier) ? '' : chip.dataset.tier
      _pickPage = 1
      const sel = document.querySelector('#pick-tier')
      if (sel) sel.value = _pickTier
      renderPickResults()
    })
  })

  const megaChip = el.querySelector('.pick-tier-chip-mega')
  if (megaChip) {
    megaChip.addEventListener('click', () => {
      _pickMegaFilter = !_pickMegaFilter
      _pickPage = 1
      renderPickResults()
    })
  }
}

// Only replaces the results grid — never touches the search input
function renderPickResults() {
  const container = document.querySelector('#pick-results')
  if (!container) return

  // ── Team view mode ──────────────────────────────────────────────────────────
  if (_viewingTeamOf) {
    renderTierSlotsRow(_viewingTeamOf, false)
    const playerPicks = _picks.filter(pk => pk.userId === _viewingTeamOf)
    const player = _pickOrder.find(p => p.id === _viewingTeamOf)
    const color  = playerColor(_viewingTeamOf)
    const name   = player?.global_name || player?.username || '?'
    const empty  = Math.max(0, _teamSize - playerPicks.length)

    const infoEl = document.querySelector('#pick-results-info')
    if (infoEl) infoEl.textContent = ''

    container.innerHTML = `
      <div class="team-view-banner" style="border-color:${color};background:${color}12">
        <span class="team-view-label">
          Equipo de <strong>${name}</strong>
          <span class="team-view-count" style="color:${color}">${playerPicks.length}/${_teamSize}</span>
        </span>
        <button class="team-view-close" id="team-view-close">✕ Cerrar</button>
      </div>
      <div class="pokemon-grid">
        ${playerPicks.map(pk => `
          <div class="pokemon-card">
            <div class="pokemon-card-sprite-wrap">
              <img src="/api/sprite/${pk.pokemonId}" alt="${pk.pokemonName}" width="72" height="72" />
            </div>
            <div class="pokemon-card-name">${pk.pokemonName}</div>
            <div class="pokemon-card-tier">${tierBadge(pk.tier)}</div>
          </div>
        `).join('')}
        ${Array.from({ length: empty }).map(() =>
          `<div class="pokemon-card pokemon-card-empty-slot"></div>`
        ).join('')}
        ${playerPicks.length === 0
          ? `<p class="empty-state" style="grid-column:1/-1;padding:2rem 0">Aún no ha elegido ningún Pokémon.</p>`
          : ''}
      </div>
    `

    document.querySelector('#team-view-close').addEventListener('click', () => {
      _viewingTeamOf = null
      // Remove highlight from all player cards without re-rendering the top section
      document.querySelectorAll('.participant-card[data-user-id]').forEach(c => {
        c.classList.remove('participant-card-viewing')
        c.style.borderColor = ''
        c.style.boxShadow   = ''
      })
      renderPickResults()
    })
    return
  }

  // ── Normal grid mode ────────────────────────────────────────────────────────
  renderTierSlotsRow(_myId, true)
  const filtered = getFilteredPokemon()
  const totalPages = Math.max(1, Math.ceil(filtered.length / PICK_PAGE_SIZE))
  if (_pickPage > totalPages) _pickPage = 1
  const page = filtered.slice((_pickPage - 1) * PICK_PAGE_SIZE, _pickPage * PICK_PAGE_SIZE)

  const infoEl = document.querySelector('#pick-results-info')
  if (infoEl) infoEl.textContent = `${filtered.length} Pokémon`

  const tierEl = document.querySelector('#pick-tier')
  if (tierEl && tierEl.value !== _pickTier) tierEl.value = _pickTier

  const typeEl = document.querySelector('#pick-type')
  if (typeEl && typeEl.value !== _pickType) typeEl.value = _pickType

  const currentId = currentPickerId(_pickOrder, _currentPickIndex)
  const isMyTurn  = currentId === _myId

  // Compute my picks data for restriction checks
  const myPickTiers = []
  let myMegaCount = 0
  let mySpent = 0
  if (isMyTurn) {
    for (const pk of _picks.filter(pk => pk.userId === _myId)) {
      if (pk.tier) myPickTiers.push(pk.tier)
      if (pk.pokemonName?.includes('-mega')) myMegaCount++
      mySpent += pk.cost ?? 0
    }
  }
  const myRemainingBudget = _totalCoins - mySpent
  const hasTierSlots = Object.values(_tierSlots).some(v => v > 0)

  // For subasta: check if any Pokémon is currently in auction
  const auctionedPokemonId = _auctionState?.pokemonId ?? null

  container.innerHTML = `
    <div class="pokemon-grid">
      ${page.map(p => {
        const pick = _picks.find(pk => pk.pokemonId === p.id)
        const isPicked = !!pick
        const isInAuction = p.id === auctionedPokemonId
        const color    = isPicked ? playerColor(pick.userId) : null

        const isMega      = p.name.includes('-mega')
        const tierFull    = hasTierSlots && !canPickTier(p.tier, myPickTiers, _tierSlots)
        const megaFull    = _draftType !== 'subasta' && isMega && myMegaCount >= _maxMegas
        const tierCost    = _draftType === 'puntos'
          ? (_presetAssignments ? (_presetAssignments[String(p.id)] ?? 0) : (_tierCosts[p.tier] ?? 0))
          : 0
        const cantAfford  = _draftType === 'puntos' && tierCost > myRemainingBudget
        const isDisabled       = isMyTurn && !isPicked && !isInAuction && (tierFull || megaFull || cantAfford)
        const isPickable       = isMyTurn && !isPicked && !isInAuction && !isDisabled
        const isNotSelectable  = !isMyTurn && !isPicked && !isInAuction

        const cls   = `pokemon-card${isPicked ? ' pokemon-card-picked' : ''}${isInAuction ? ' pokemon-card-in-auction' : ''}${isPickable ? ' pokemon-card-pickable' : ''}${isDisabled ? ' pokemon-card-disabled' : ''}${isNotSelectable ? ' pokemon-card-not-selectable' : ''}`
        const style = isPicked ? `style="background:${color}28;border-color:${color}"` : ''
        const data  = isPickable ? `data-id="${p.id}" data-name="${p.name}" data-tier="${p.tier || ''}"` : ''

        return `
          <div class="${cls}" ${style} ${data}>
            <div class="pokemon-card-sprite-wrap">
              <img src="/api/sprite/${p.id}" alt="${p.name}" width="72" height="72" />
              ${isPicked ? `<div class="pick-owner-badge" style="background:${color}">${pickerDisplayName(pick.userId)}</div>` : ''}
              ${isInAuction ? `<div class="pick-owner-badge" style="background:#fb8c00">🔨 subasta</div>` : ''}
            </div>
            <div class="pokemon-card-name">${p.name}</div>
            <div class="pokemon-card-types">${typeBadges(p.types)}</div>
            <div class="pokemon-card-tier">${tierBadge(p.tier)}</div>
            ${_draftType === 'puntos' && tierCost > 0 ? `<div class="pokemon-card-cost">⭐ ${tierCost} pts</div>` : ''}
          </div>
        `
      }).join('')}
    </div>
    ${totalPages > 1 ? `
      <div class="pagination">
        <button id="pick-prev" ${_pickPage === 1 ? 'disabled' : ''}>← Anterior</button>
        <span class="page-info">Página ${_pickPage} de ${totalPages}</span>
        <button id="pick-next" ${_pickPage === totalPages ? 'disabled' : ''}>Siguiente →</button>
      </div>` : ''}
  `

  document.querySelector('#pick-prev')?.addEventListener('click', () => { _pickPage--; renderPickResults() })
  document.querySelector('#pick-next')?.addEventListener('click', () => { _pickPage++; renderPickResults() })
}

function renderPokemonPicker(container) {
  if (!document.querySelector('#pick-results')) {
    initPickerShell(container)
  }
  renderPickResults()
}
