import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import fetch from "node-fetch";
import {
  getDraftByInstance,
  getParticipants,
  getActiveDrafts,
  getDraftsByUser,
  getTeamsWithPicks,
  getAllPicksForDraft,
  deleteDraft,
  insertDraft,
  updateDraftPhase,
  updatePickState,
  upsertParticipant,
  insertTeam,
  getTeamId,
  insertPick,
  getTeamPokemon,
  getPresetsByInstance,
  getPresetById,
  insertPreset,
  updatePreset,
  deletePreset,
} from "./db.js";
dotenv.config({ path: "../.env" });

const TIER_RANK = { Ubers:0, OU:1, UUBL:2, UU:3, RUBL:4, RU:5, NUBL:6, NU:7, PUBL:8, PU:9, ZU:10, NFE:11, LC:12 }

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

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// Ignore abrupt client disconnects (browser tab closed, etc.)
httpServer.on('connection', socket => {
  socket.on('error', err => {
    if (err.code !== 'ECONNRESET') console.error('Socket error:', err)
  })
})

const port = 3001;
app.use(express.json());

// ── Pokemon cache ────────────────────────────────────────────────────────────

let pokemonCache = null;

function toShowdownId(name) {
  return name.replace(/-/g, "").toLowerCase();
}

async function fetchFormatsData() {
  const response = await fetch("https://play.pokemonshowdown.com/data/formats-data.js");
  const text = await response.text();
  const exportsObj = {};
  new Function("exports", text)(exportsObj);
  return exportsObj.BattleFormatsData;
}

async function fetchPokemonDetails(urls, batchSize = 50) {
  const results = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(url =>
        fetch(url)
          .then(r => r.json())
          .then(d => {
            const stat = name => d.stats?.find(s => s.stat.name === name)?.base_stat ?? 0
            if (!d.stats?.length) return null
            return {
              id: d.id,
              name: d.name,
              types: d.types.map(t => t.type.name),
              stats: {
                hp:      stat('hp'),
                attack:  stat('attack'),
                defense: stat('defense'),
                spa:     stat('special-attack'),
                spd:     stat('special-defense'),
                speed:   stat('speed'),
              },
            }
          })
      )
    );
    results.push(...batchResults.filter(Boolean));
    console.log(`Pokemon details: ${Math.min(i + batchSize, urls.length)}/${urls.length}`);
  }
  return results;
}

app.get("/api/avatar/:userId/:hash", async (req, res) => {
  const { userId, hash } = req.params
  if (!userId || !hash) return res.status(400).end()
  const upstream = await fetch(`https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=128`)
  if (!upstream.ok) return res.status(404).end()
  res.set('Content-Type', 'image/png')
  res.set('Cache-Control', 'public, max-age=3600')
  upstream.body.pipe(res)
})

app.get("/api/sprite/:id", async (req, res) => {
  const id = parseInt(req.params.id)
  if (!id || id < 1) return res.status(400).end()
  const upstream = await fetch(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`)
  if (!upstream.ok) return res.status(404).end()
  res.set('Content-Type', 'image/png')
  res.set('Cache-Control', 'public, max-age=86400')
  upstream.body.pipe(res)
})

app.get("/api/pokemon", async (req, res) => {
  if (pokemonCache) return res.json(pokemonCache);

  console.log("Building Pokemon cache, this may take a moment...");

  const [listData, formatsData] = await Promise.all([
    fetch("https://pokeapi.co/api/v2/pokemon?limit=10000&offset=0").then(r => r.json()),
    fetchFormatsData(),
  ]);

  const baseUrls = listData.results
    .filter(p => {
      const id = parseInt(p.url.split("/").filter(Boolean).pop());
      return (id >= 1 && id <= 1025) || id >= 10001;
    })
    .map(p => p.url);

  const details = await fetchPokemonDetails(baseUrls);
  details.sort((a, b) => a.id - b.id);

  pokemonCache = details.map(p => {
    const data = formatsData[toShowdownId(p.name)];
    return {
      id: p.id,
      name: p.name,
      types: p.types,
      stats: p.stats,
      tier: (data && data.tier) || null,
      natDexTier: (data && data.natDexTier) || null,
    };
  }).filter(p => p.id <= 1025 || p.tier !== null);

  console.log(`Cache ready: ${pokemonCache.length} Pokemon`);
  res.json(pokemonCache);
});

// ── Presets API ───────────────────────────────────────────────────────────────

app.get('/api/presets', (req, res) => {
  const { instanceId } = req.query
  if (!instanceId) return res.status(400).json({ error: 'instanceId required' })
  res.json(getPresetsByInstance.all(instanceId))
})

app.get('/api/presets/:id', (req, res) => {
  const preset = getPresetById.get(parseInt(req.params.id))
  if (!preset) return res.status(404).json({ error: 'Not found' })
  res.json(preset)
})

app.post('/api/presets', (req, res) => {
  const { instanceId, name, maxPoints, createdBy } = req.body
  if (!instanceId || !name || !maxPoints) return res.status(400).json({ error: 'Missing fields' })
  const { lastInsertRowid } = insertPreset.run({
    instance_id: instanceId, name, max_points: parseInt(maxPoints),
    status: 'draft', assignments: '{}', created_by: createdBy ?? null,
  })
  res.json(getPresetById.get(lastInsertRowid))
})

app.put('/api/presets/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const preset = getPresetById.get(id)
  if (!preset) return res.status(404).json({ error: 'Not found' })
  const { name, assignments, status, userId } = req.body
  if (preset.created_by && preset.created_by !== userId) return res.status(403).json({ error: 'Not the creator' })
  updatePreset.run({
    id,
    name: name ?? preset.name,
    assignments: assignments !== undefined ? JSON.stringify(assignments) : preset.assignments,
    status: status ?? preset.status,
  })
  res.json(getPresetById.get(id))
})

app.delete('/api/presets/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const { userId } = req.query
  const preset = getPresetById.get(id)
  if (!preset) return res.status(404).json({ error: 'Not found' })
  if (preset.created_by && preset.created_by !== userId) return res.status(403).json({ error: 'Not the creator' })
  deletePreset.run(id)
  res.json({ ok: true })
})

// ── Drafts API ────────────────────────────────────────────────────────────────

app.delete("/api/drafts/:instanceId", (req, res) => {
  const { userId } = req.query
  if (!userId) return res.status(400).json({ error: 'userId required' })

  const dbDraft = getDraftByInstance.get(req.params.instanceId)
  if (!dbDraft) return res.status(404).json({ error: 'Draft not found' })
  if (dbDraft.host_id !== userId) return res.status(403).json({ error: 'Not the host' })

  deleteDraft.run(req.params.instanceId, userId)
  rooms.delete(req.params.instanceId)

  res.json({ ok: true })
})

app.get("/api/drafts/mine", (req, res) => {
  const { userId } = req.query
  if (!userId) return res.status(400).json({ error: 'userId required' })
  res.json(getDraftsByUser.all(userId))
})

app.get("/api/drafts/:instanceId/teams", (req, res) => {
  const dbDraft = getDraftByInstance.get(req.params.instanceId)
  if (!dbDraft) return res.status(404).json({ error: 'Draft not found' })

  const rows = getTeamsWithPicks.all(dbDraft.id)
  const teamsMap = new Map()
  for (const row of rows) {
    if (!teamsMap.has(row.userId)) {
      teamsMap.set(row.userId, {
        userId: row.userId,
        username: row.username,
        global_name: row.global_name,
        avatar: row.avatar,
        pokemon: [],
      })
    }
    if (row.pokemonId != null) {
      teamsMap.get(row.userId).pokemon.push({
        pokemonId: row.pokemonId,
        pokemonName: row.pokemonName,
        tier: row.tier,
        cost: row.cost,
        pickOrder: row.pickOrder,
      })
    }
  }

  res.json({
    draft: {
      name: dbDraft.name,
      phase: dbDraft.phase,
      teamSize: dbDraft.team_size,
      createdAt: dbDraft.created_at,
      pickOrder: dbDraft.pick_order ? JSON.parse(dbDraft.pick_order) : [],
    },
    teams: [...teamsMap.values()],
  })
})

app.post("/api/token", async (req, res) => {
  const response = await fetch(`https://discord.com/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VITE_DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: req.body.code,
    }),
  });
  const { access_token } = await response.json();
  res.send({ access_token });
});

// ── Draft helpers ─────────────────────────────────────────────────────────────

function currentPickerId(pickOrder, idx) {
  if (!pickOrder?.length) return null
  const n = pickOrder.length
  const round = Math.floor(idx / n)
  const pos = idx % n
  return pickOrder[round % 2 === 0 ? pos : n - 1 - pos]?.id ?? null
}

// ── Draft rooms ──────────────────────────────────────────────────────────────

// rooms: Map<instanceId, { host: userId, participants: User[], draft: Draft|null }>
const rooms = new Map();

// Active auction setTimeout handles — kept outside draft object so they don't serialize
const auctionTimers = new Map() // key: draftInstanceId

// Restore active drafts from DB — group by discord_instance_id to support multiple drafts per room
for (const d of getActiveDrafts.all()) {
  const channelId = d.discord_instance_id || d.instance_id
  if (!rooms.has(channelId)) {
    rooms.set(channelId, { host: d.host_id, drafts: {}, configuringUsers: [] })
  }
  const participants = getParticipants.all(d.id).map(p => ({
    id: p.user_id, username: p.username, global_name: p.global_name,
    avatar: p.avatar, discriminator: '0',
  }))
  rooms.get(channelId).drafts[d.instance_id] = {
    id: d.id,
    config: {
      name: d.name, teamSize: d.team_size, coins: d.coins,
      tierSlots: JSON.parse(d.tier_slots), maxMegas: d.max_megas ?? 0,
      draftType: d.type ?? 'clasico',
      tierCosts: d.tier_costs ? JSON.parse(d.tier_costs) : {},
      presetId: d.preset_id ?? null,
      presetAssignments: d.preset_assignments ? JSON.parse(d.preset_assignments) : null,
      minTeamSize: d.min_team_size ?? 0,
      minBid: d.min_bid ?? 0,
      auctionTimer: d.auction_timer ?? 10,
    },
    phase: d.phase,
    participants,
    pickOrder: d.pick_order ? JSON.parse(d.pick_order) : [],
    currentPickIndex: d.current_pick_index ?? 0,
    picks: getAllPicksForDraft.all(d.id),
    readyPlayers: [],
    creatorId: d.host_id,
  }
}
console.log(`Restored ${rooms.size} room(s) from DB`)

function isPlayerDone(draft, userId) {
  const picks  = draft.picks.filter(pk => pk.userId === userId)
  const myCount = picks.length
  if (myCount >= draft.config.teamSize) return true
  const minBid      = draft.config.minBid ?? 0
  const minTeamSize = draft.config.minTeamSize ?? 0
  if (minBid > 0 && minTeamSize > 0 && myCount >= minTeamSize) {
    const mySpent = picks.reduce((s, pk) => s + (pk.cost ?? 0), 0)
    if (draft.config.coins - mySpent < minBid) return true
  }
  return false
}

async function endAuction(instanceId, draftInstanceId) {
  const room = rooms.get(instanceId)
  const draft = room?.drafts?.[draftInstanceId]
  if (!draft?.auctionState) return

  clearTimeout(auctionTimers.get(draftInstanceId))
  auctionTimers.delete(draftInstanceId)

  const { pokemonId, pokemonName, tier, currentBid, highestBidderId } = draft.auctionState
  draft.auctionState = null

  const pickIdx = draft.currentPickIndex
  draft.picks.push({ pokemonId, pokemonName, tier, userId: highestBidderId, pickOrder: pickIdx, cost: currentBid })

  const dbDraft = getDraftByInstance.get(draftInstanceId)
  if (dbDraft) {
    const teamRow = getTeamId.get(dbDraft.id, highestBidderId)
    if (teamRow) insertPick.run({ team_id: teamRow.id, pokemon_id: pokemonId, pokemon_name: pokemonName, tier: tier ?? null, cost: currentBid, pick_order: pickIdx + 1 })
  }

  // Advance snake, skipping players who are done (maxTeamSize OR broke with ≥ minTeamSize)
  let nextIdx = draft.currentPickIndex + 1
  const n = draft.pickOrder.length
  let allDone = false

  for (let attempts = 0; attempts <= n * 2; attempts++) {
    allDone = draft.pickOrder.every(p => isPlayerDone(draft, p.id))
    if (allDone) break
    const nextNomId = currentPickerId(draft.pickOrder, nextIdx)
    if (!isPlayerDone(draft, nextNomId)) break
    nextIdx++
  }

  draft.currentPickIndex = nextIdx

  if (allDone) {
    draft.phase = 'complete'
    updateDraftPhase.run('complete', draftInstanceId)
  } else {
    updatePickState.run({ phase: draft.phase, pick_order: JSON.stringify(draft.pickOrder), current_pick_index: draft.currentPickIndex, instance_id: draftInstanceId })
  }

  console.log(`Auction ended: ${pokemonName} won by ${highestBidderId} for ${currentBid}`)
  broadcastRoomState(instanceId)
  if (draft.phase === 'picking') {
    const nextNominator = currentPickerId(draft.pickOrder, draft.currentPickIndex)
    if (nextNominator && !(await isUserConnected(instanceId, nextNominator))) {
      await sendTurnDM(nextNominator, draft.config.name)
    }
  }
}

function broadcastRoomState(instanceId) {
  const room = rooms.get(instanceId)
  if (!room) return

  // Inject secsLeft into any active auction so clients avoid clock-skew on timerEnd
  const now = Date.now()
  const hasAuction = Object.values(room.drafts).some(d => d.auctionState)
  if (!hasAuction) {
    io.to(instanceId).emit("room-state", room)
    return
  }

  const drafts = Object.fromEntries(
    Object.entries(room.drafts).map(([id, draft]) => {
      if (!draft.auctionState) return [id, draft]
      return [id, {
        ...draft,
        auctionState: {
          ...draft.auctionState,
          secsLeft: Math.max(0, (draft.auctionState.timerEnd - now) / 1000),
        },
      }]
    })
  )
  io.to(instanceId).emit("room-state", { ...room, drafts })
}

async function isUserConnected(instanceId, userId) {
  const sockets = await io.in(instanceId).fetchSockets()
  return sockets.some(s => s.data.user?.id === userId)
}

async function sendTurnDM(userId, draftName) {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) return
  try {
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId }),
    })
    const { id: channelId } = await dmRes.json()
    if (!channelId) return
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `¡Es tu turno en el draft **${draftName}**! Entra a la actividad de Discord para hacer tu pick.`,
      }),
    })
    console.log(`Turn DM sent to ${userId} for draft "${draftName}"`)
  } catch (e) {
    console.error(`DM failed for user ${userId}:`, e.message)
  }
}

io.on("connection", socket => {
  // View-only: subscribes to broadcasts without joining a draft
  socket.on("view-room", ({ instanceId, user }) => {
    socket.join(instanceId)
    socket.data.instanceId = instanceId
    if (user) socket.data.user = user
    if (!rooms.has(instanceId)) {
      rooms.set(instanceId, { host: user?.id, drafts: {}, configuringUsers: [] })
      console.log(`Room created via lobby: ${instanceId}`)
    }
    const room = rooms.get(instanceId)
    if (room) socket.emit("room-state", room)
  })

  // Join a specific draft within the room
  socket.on("join-room", ({ instanceId, draftInstanceId, user }) => {
    socket.join(instanceId)
    socket.data.instanceId = instanceId
    socket.data.draftInstanceId = draftInstanceId
    socket.data.user = user

    if (!rooms.has(instanceId)) {
      rooms.set(instanceId, { host: user.id, drafts: {}, configuringUsers: [] })
    }
    const room = rooms.get(instanceId)
    const draft = room.drafts[draftInstanceId]

    // Only add to participants (and persist) if the draft is still in lobby phase
    if (draft && draft.phase === 'lobby' && !draft.participants.find(p => p.id === user.id)) {
      draft.participants.push(user)
      console.log(`${user.username} joined draft ${draftInstanceId}`)

      const dbDraft = getDraftByInstance.get(draftInstanceId)
      if (dbDraft) {
        upsertParticipant.run({ draft_id: dbDraft.id, user_id: user.id, username: user.username, global_name: user.global_name ?? null, avatar: user.avatar ?? null })
      }
    } else if (draft && draft.phase !== 'lobby') {
      console.log(`${user.username} joined draft ${draftInstanceId} as spectator`)
    }

    broadcastRoomState(instanceId)
  })

  socket.on("start-configuring", ({ instanceId, user }) => {
    const room = rooms.get(instanceId)
    if (!room || !user?.id) return
    socket.data.instanceId = instanceId
    socket.data.user = user
    socket.data.isConfiguring = true
    room.configuringUsers ??= []
    if (!room.configuringUsers.some(u => u.id === user.id)) {
      room.configuringUsers.push(user)
    }
    broadcastRoomState(instanceId)
  })

  socket.on("stop-configuring", ({ instanceId, userId }) => {
    const room = rooms.get(instanceId)
    if (!room) return
    room.configuringUsers = (room.configuringUsers ?? []).filter(u => u.id !== userId)
    socket.data.isConfiguring = false
    broadcastRoomState(instanceId)
  })

  socket.on("create-draft", ({ instanceId, draftInstanceId, config, user: eventUser }) => {
    const room = rooms.get(instanceId)
    if (!room) return
    const creatorId = eventUser?.id ?? socket.data.user?.id
    if (!creatorId) return
    if (eventUser && !socket.data.user) socket.data.user = eventUser

    room.drafts[draftInstanceId] = {
      config, phase: "lobby", participants: [], picks: [],
      readyPlayers: [creatorId],
      creatorId,
    }
    console.log(`Draft ${draftInstanceId} created in room ${instanceId}`)

    // For Puntos with preset: load and snapshot preset assignments
    let presetAssignments = null
    if (config.draftType === 'puntos' && config.presetId) {
      const preset = getPresetById.get(config.presetId)
      if (preset) {
        presetAssignments = JSON.parse(preset.assignments)
        config.presetAssignments = presetAssignments
      }
    }

    insertDraft.run({
      instance_id: draftInstanceId,
      discord_instance_id: instanceId,
      name: config.name,
      host_id: creatorId,
      team_size: config.teamSize,
      min_team_size: config.minTeamSize ?? 0,
      min_bid: config.minBid ?? 0,
      auction_timer: config.auctionTimer ?? 10,
      coins: config.coins,
      tier_slots: JSON.stringify(config.tierSlots ?? {}),
      max_megas: config.maxMegas ?? 0,
      type: config.draftType ?? 'clasico',
      tier_costs: JSON.stringify(config.tierCosts ?? {}),
      preset_id: config.presetId ?? null,
      preset_assignments: presetAssignments ? JSON.stringify(presetAssignments) : null,
      phase: 'lobby',
    })

    broadcastRoomState(instanceId)
  })

  socket.on("cancel-draft", ({ instanceId, draftInstanceId }) => {
    const room = rooms.get(instanceId)
    if (!room) return
    const draft = room.drafts[draftInstanceId]
    if (!draft) return
    if (draft.creatorId !== socket.data.user?.id) return

    clearTimeout(auctionTimers.get(draftInstanceId))
    auctionTimers.delete(draftInstanceId)
    delete room.drafts[draftInstanceId]
    deleteDraft.run(draftInstanceId, draft.creatorId)

    io.to(instanceId).emit('draft-cancelled', { draftInstanceId })
    broadcastRoomState(instanceId)
    console.log(`Draft ${draftInstanceId} cancelled by host in room ${instanceId}`)
  })

  socket.on("toggle-ready", ({ instanceId, draftInstanceId }) => {
    const draft = rooms.get(instanceId)?.drafts?.[draftInstanceId]
    if (!draft) return
    const userId = socket.data.user?.id
    if (!userId) return

    const idx = draft.readyPlayers.indexOf(userId)
    if (idx === -1) draft.readyPlayers.push(userId)
    else draft.readyPlayers.splice(idx, 1)

    broadcastRoomState(instanceId)
  })

  socket.on("start-picks", async ({ instanceId, draftInstanceId }) => {
    const room = rooms.get(instanceId)
    if (!room) return
    const draft = room.drafts[draftInstanceId]
    if (draft?.creatorId !== socket.data.user?.id) return
    if (!draft || draft.phase !== "lobby") return

    const shuffled = [...draft.participants].sort(() => Math.random() - 0.5)
    draft.pickOrder = shuffled
    draft.currentPickIndex = 0
    draft.phase = "picking"
    draft.readyPlayers = []

    console.log(`Picks started in draft ${draftInstanceId}: ${shuffled.map(p => p.username).join(" → ")}`)

    const dbDraft = getDraftByInstance.get(draftInstanceId)
    if (dbDraft) {
      updatePickState.run({ phase: "picking", pick_order: JSON.stringify(shuffled), current_pick_index: 0, instance_id: draftInstanceId })
      for (const p of shuffled) insertTeam.run(dbDraft.id, p.id)
    }

    broadcastRoomState(instanceId)
    const firstPicker = shuffled[0]
    if (firstPicker && !(await isUserConnected(instanceId, firstPicker.id))) {
      await sendTurnDM(firstPicker.id, draft.config.name)
    }
  })

  socket.on("pick-pokemon", async ({ instanceId, draftInstanceId, pokemonId, pokemonName, tier }) => {
    const draft = rooms.get(instanceId)?.drafts?.[draftInstanceId]
    if (!draft || draft.phase !== 'picking') return

    const userId = socket.data.user?.id
    if (!userId) return
    if (userId !== currentPickerId(draft.pickOrder, draft.currentPickIndex)) return
    if (draft.picks.some(pk => pk.pokemonId === pokemonId)) return

    // Tier slot restriction
    const tierSlots = draft.config?.tierSlots ?? {}
    if (Object.values(tierSlots).some(v => v > 0)) {
      const myPickTiers = draft.picks.filter(pk => pk.userId === userId && pk.tier).map(pk => pk.tier)
      if (!canPickTier(tier, myPickTiers, tierSlots)) return
    }

    // Mega restriction
    if (pokemonName.includes('-mega')) {
      const maxMegas = draft.config?.maxMegas ?? 0
      const myMegaCount = draft.picks.filter(pk => pk.userId === userId && pk.pokemonName?.includes('-mega')).length
      if (myMegaCount >= maxMegas) return
    }

    // Puntos: validate budget and eligibility
    let pickCost = null
    if (draft.config?.draftType === 'puntos') {
      const presetAssignments = draft.config?.presetAssignments
      if (presetAssignments) {
        // Preset-based: cost per pokémon
        const cost = presetAssignments[String(pokemonId)]
        if (cost === undefined) return // Pokémon not in preset
        pickCost = cost
      } else {
        // Tier-based fallback
        pickCost = (draft.config?.tierCosts ?? {})[tier] ?? 0
      }
      const spent = draft.picks.filter(pk => pk.userId === userId).reduce((s, pk) => s + (pk.cost ?? 0), 0)
      if (pickCost > (draft.config.coins ?? 0) - spent) return
    }

    const pickIdx = draft.currentPickIndex
    draft.picks.push({ pokemonId, pokemonName, tier, userId, pickOrder: pickIdx, cost: pickCost })
    draft.currentPickIndex++

    const dbDraft = getDraftByInstance.get(draftInstanceId)
    if (dbDraft) {
      const teamRow = getTeamId.get(dbDraft.id, userId)
      if (teamRow) insertPick.run({ team_id: teamRow.id, pokemon_id: pokemonId, pokemon_name: pokemonName, tier: tier ?? null, cost: null, pick_order: pickIdx + 1 })
      updatePickState.run({ phase: draft.phase, pick_order: JSON.stringify(draft.pickOrder), current_pick_index: draft.currentPickIndex, instance_id: draftInstanceId })
    }

    const totalPicks = draft.pickOrder.length * (draft.config?.teamSize ?? 6)
    if (draft.currentPickIndex >= totalPicks) {
      draft.phase = 'complete'
      updateDraftPhase.run('complete', draftInstanceId)
    }

    console.log(`${userId} picked ${pokemonName} in draft ${draftInstanceId} (pick #${pickIdx + 1})`)
    broadcastRoomState(instanceId)
    if (draft.phase === 'picking') {
      const nextPicker = currentPickerId(draft.pickOrder, draft.currentPickIndex)
      if (nextPicker && !(await isUserConnected(instanceId, nextPicker))) {
        await sendTurnDM(nextPicker, draft.config.name)
      }
    }
  })

  socket.on("nominate-pokemon", ({ instanceId, draftInstanceId, pokemonId, pokemonName, tier }) => {
    const room = rooms.get(instanceId)
    const draft = room?.drafts?.[draftInstanceId]
    if (!draft || draft.phase !== 'picking') return

    const userId = socket.data.user?.id
    if (!userId) return

    // Safety: skip any done players that endAuction may have missed and re-check for all-done
    {
      const n = draft.pickOrder.length
      let advanced = false
      for (let i = 0; i <= n * 2; i++) {
        if (draft.pickOrder.every(p => isPlayerDone(draft, p.id))) {
          draft.phase = 'complete'
          updateDraftPhase.run('complete', draftInstanceId)
          broadcastRoomState(instanceId)
          return
        }
        if (!isPlayerDone(draft, currentPickerId(draft.pickOrder, draft.currentPickIndex))) break
        draft.currentPickIndex++
        advanced = true
      }
      if (advanced) {
        updatePickState.run({ phase: draft.phase, pick_order: JSON.stringify(draft.pickOrder), current_pick_index: draft.currentPickIndex, instance_id: draftInstanceId })
        broadcastRoomState(instanceId)
        return
      }
    }

    if (userId !== currentPickerId(draft.pickOrder, draft.currentPickIndex)) return
    if (draft.auctionState) return
    if (draft.picks.some(pk => pk.pokemonId === pokemonId)) return

    const minBid = draft.config.minBid ?? 0
    const minTeamSize = draft.config.minTeamSize ?? draft.config.teamSize
    const myCount = draft.picks.filter(pk => pk.userId === userId).length
    const mySpent = draft.picks.filter(pk => pk.userId === userId).reduce((s, pk) => s + (pk.cost ?? 0), 0)
    const myCoins = draft.config.coins - mySpent
    const reserve = Math.max(0, minTeamSize - myCount - 1) * minBid
    if (myCoins < minBid + reserve) return

    const timerSeconds = draft.config.auctionTimer ?? 10
    const timerEnd = Date.now() + timerSeconds * 1000

    draft.auctionState = {
      pokemonId,
      pokemonName,
      tier: tier || null,
      currentBid: minBid,
      highestBidderId: userId,
      highestBidderName: socket.data.user.global_name || socket.data.user.username,
      nominatorId: userId,
      hasOtherBid: false,
      timerEnd,
    }

    const timerRef = setTimeout(() => endAuction(instanceId, draftInstanceId), timerSeconds * 1000)
    auctionTimers.set(draftInstanceId, timerRef)

    console.log(`Auction started: ${pokemonName} in ${draftInstanceId} opening at ${minBid}`)
    broadcastRoomState(instanceId)
  })

  socket.on("place-bid", ({ instanceId, draftInstanceId, amount }) => {
    const room = rooms.get(instanceId)
    const draft = room?.drafts?.[draftInstanceId]
    if (!draft?.auctionState) return

    const userId = socket.data.user?.id
    if (!userId) return

    const { auctionState } = draft
    const maxTeamSize = draft.config.teamSize
    const minBid = draft.config.minBid ?? 0
    const minTeamSize = draft.config.minTeamSize ?? maxTeamSize

    const myCount = draft.picks.filter(pk => pk.userId === userId).length
    if (myCount >= maxTeamSize) return
    if (userId === auctionState.highestBidderId) return
    if (userId === auctionState.nominatorId && !auctionState.hasOtherBid) return
    if (amount <= auctionState.currentBid) return

    const mySpent = draft.picks.filter(pk => pk.userId === userId).reduce((s, pk) => s + (pk.cost ?? 0), 0)
    const myCoins = draft.config.coins - mySpent
    const reserve = Math.max(0, minTeamSize - myCount - 1) * minBid
    if (myCoins < amount + reserve) return

    auctionState.currentBid = amount
    auctionState.highestBidderId = userId
    auctionState.highestBidderName = socket.data.user.global_name || socket.data.user.username
    if (userId !== auctionState.nominatorId) auctionState.hasOtherBid = true

    const timerSeconds = draft.config.auctionTimer ?? 10
    auctionState.timerEnd = Date.now() + timerSeconds * 1000
    clearTimeout(auctionTimers.get(draftInstanceId))
    auctionTimers.set(draftInstanceId, setTimeout(() => endAuction(instanceId, draftInstanceId), timerSeconds * 1000))

    console.log(`Bid: ${userId} → ${amount} on ${auctionState.pokemonName}`)
    broadcastRoomState(instanceId)
  })

  socket.on("send-turn-dm", async ({ instanceId, draftInstanceId, targetUserId }) => {
    const room = rooms.get(instanceId)
    const draft = room?.drafts?.[draftInstanceId]
    if (!draft) return
    if (draft.creatorId !== socket.data.user?.id) return
    await sendTurnDM(targetUserId, draft.config.name)
  })

  socket.on("disconnect", () => {
    const { instanceId, draftInstanceId, user } = socket.data
    if (!instanceId || !user) return

    const room = rooms.get(instanceId)
    if (!room) return

    if (draftInstanceId && room.drafts[draftInstanceId]) {
      room.drafts[draftInstanceId].participants = room.drafts[draftInstanceId].participants.filter(p => p.id !== user.id)
    }
    if (room.configuringUsers) {
      room.configuringUsers = room.configuringUsers.filter(u => u.id !== user.id)
    }

    const allParticipants = Object.values(room.drafts).flatMap(d => d.participants)
    if (allParticipants.length === 0) {
      rooms.delete(instanceId)
      console.log(`Room ${instanceId} deleted (empty)`)
      return
    }

    if (room.host === user.id) {
      room.host = allParticipants[0].id
      console.log(`Host transferred in room ${instanceId}`)
    }

    broadcastRoomState(instanceId)
  })
});

// ── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
