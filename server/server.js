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
} from "./db.js";
dotenv.config({ path: "../.env" });

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

// Restore active drafts from DB on startup so data survives server restarts
for (const d of getActiveDrafts.all()) {
  const participants = getParticipants.all(d.id).map(p => ({
    id: p.user_id,
    username: p.username,
    global_name: p.global_name,
    avatar: p.avatar,
    discriminator: '0',
  }))
  rooms.set(d.instance_id, {
    host: d.host_id,
    participants,
    draft: {
      config: {
        name: d.name,
        teamSize: d.team_size,
        coins: d.coins,
        tierSlots: JSON.parse(d.tier_slots),
        maxMegas: d.max_megas ?? 0,
      },
      phase: d.phase,
      pickOrder: d.pick_order ? JSON.parse(d.pick_order) : [],
      currentPickIndex: d.current_pick_index ?? 0,
      picks: getAllPicksForDraft.all(d.id),
    },
  })
}
console.log(`Restored ${rooms.size} active draft(s) from DB`)

function broadcastRoomState(instanceId) {
  const room = rooms.get(instanceId);
  if (room) io.to(instanceId).emit("room-state", room);
}

io.on("connection", socket => {
  socket.on("join-room", ({ instanceId, user }) => {
    socket.join(instanceId);
    socket.data.instanceId = instanceId;
    socket.data.user = user;

    if (!rooms.has(instanceId)) {
      rooms.set(instanceId, { host: user.id, participants: [], draft: null });
      console.log(`Room created: ${instanceId} by ${user.username}`);
    }

    const room = rooms.get(instanceId);
    if (!room.participants.find(p => p.id === user.id)) {
      room.participants.push(user);
      console.log(`${user.username} joined room ${instanceId}`);
    }

    // If a draft already exists in DB for this instance, persist the participant
    const dbDraft = getDraftByInstance.get(instanceId)
    if (dbDraft) {
      upsertParticipant.run({ draft_id: dbDraft.id, user_id: user.id, username: user.username, global_name: user.global_name ?? null, avatar: user.avatar ?? null })
    }

    broadcastRoomState(instanceId);
  });

  socket.on("create-draft", ({ instanceId, config }) => {
    const room = rooms.get(instanceId);
    if (!room) return;
    if (room.draft) return; // draft already exists
    if (room.host !== socket.data.user?.id) return; // only host can create

    room.draft = { config, phase: "lobby", picks: [] };
    console.log(`Draft created in room ${instanceId}`);

    // Persist draft to DB
    const { lastInsertRowid: draftId } = insertDraft.run({
      instance_id: instanceId,
      name: config.name,
      host_id: room.host,
      team_size: config.teamSize,
      coins: config.coins,
      tier_slots: JSON.stringify(config.tierSlots),
      max_megas: config.maxMegas ?? 0,
      phase: 'lobby',
    })

    // Persist current participants
    for (const p of room.participants) {
      upsertParticipant.run({ draft_id: draftId, user_id: p.id, username: p.username, global_name: p.global_name ?? null, avatar: p.avatar ?? null })
    }

    broadcastRoomState(instanceId);
  });

  socket.on("toggle-ready", ({ instanceId }) => {
    const room = rooms.get(instanceId)
    if (!room?.draft) return
    const userId = socket.data.user?.id
    if (!userId) return

    if (!room.draft.readyPlayers) room.draft.readyPlayers = []
    const idx = room.draft.readyPlayers.indexOf(userId)
    if (idx === -1) room.draft.readyPlayers.push(userId)
    else room.draft.readyPlayers.splice(idx, 1)

    broadcastRoomState(instanceId)
  })

  socket.on("start-picks", ({ instanceId }) => {
    const room = rooms.get(instanceId);
    if (!room) return;
    if (room.host !== socket.data.user?.id) return;
    if (!room.draft || room.draft.phase !== "lobby") return;

    // Shuffle participants randomly to determine pick order
    const shuffled = [...room.participants].sort(() => Math.random() - 0.5);
    room.draft.pickOrder = shuffled;
    room.draft.currentPickIndex = 0;
    room.draft.phase = "picking";
    room.draft.readyPlayers = [];

    console.log(`Picks started in room ${instanceId}, order: ${shuffled.map(p => p.username).join(" → ")}`);

    const dbDraft = getDraftByInstance.get(instanceId);
    if (dbDraft) {
      updatePickState.run({
        phase: "picking",
        pick_order: JSON.stringify(shuffled),
        current_pick_index: 0,
        instance_id: instanceId,
      });
      for (const p of shuffled) {
        insertTeam.run(dbDraft.id, p.id);
      }
    }

    broadcastRoomState(instanceId);
  });

  socket.on("pick-pokemon", ({ instanceId, pokemonId, pokemonName, tier }) => {
    const room = rooms.get(instanceId)
    if (!room?.draft || room.draft.phase !== 'picking') return

    const userId = socket.data.user?.id
    if (!userId) return

    // Verify it's this player's turn
    if (userId !== currentPickerId(room.draft.pickOrder, room.draft.currentPickIndex)) return

    // Reject if already picked
    if (!room.draft.picks) room.draft.picks = []
    if (room.draft.picks.some(pk => pk.pokemonId === pokemonId)) return

    // Validate tier slot restriction
    const tierSlots = room.draft.config?.tierSlots ?? {}
    if (tier && tierSlots[tier] !== undefined) {
      const myTierCount = room.draft.picks.filter(pk => pk.userId === userId && pk.tier === tier).length
      if (myTierCount >= tierSlots[tier]) return
    }

    // Validate mega restriction
    if (pokemonName.includes('-mega')) {
      const maxMegas = room.draft.config?.maxMegas ?? 0
      const myMegaCount = room.draft.picks.filter(pk => pk.userId === userId && pk.pokemonName?.includes('-mega')).length
      if (myMegaCount >= maxMegas) return
    }

    const pickIdx = room.draft.currentPickIndex
    room.draft.picks.push({ pokemonId, pokemonName, tier, userId, pickOrder: pickIdx })
    room.draft.currentPickIndex++

    // Persist pick and updated index to DB
    const dbDraft = getDraftByInstance.get(instanceId)
    if (dbDraft) {
      const teamRow = getTeamId.get(dbDraft.id, userId)
      if (teamRow) {
        insertPick.run({ team_id: teamRow.id, pokemon_id: pokemonId, pokemon_name: pokemonName, tier: tier ?? null, cost: null, pick_order: pickIdx + 1 })
      }
      updatePickState.run({ phase: room.draft.phase, pick_order: JSON.stringify(room.draft.pickOrder), current_pick_index: room.draft.currentPickIndex, instance_id: instanceId })
    }

    // Check draft completion
    const totalPicks = room.draft.pickOrder.length * (room.draft.config?.teamSize ?? 6)
    if (room.draft.currentPickIndex >= totalPicks) {
      room.draft.phase = 'complete'
      updateDraftPhase.run('complete', instanceId)
    }

    console.log(`${userId} picked ${pokemonName} in room ${instanceId} (pick #${pickIdx + 1})`)
    broadcastRoomState(instanceId)
  })

  socket.on("disconnect", () => {
    const { instanceId, user } = socket.data;
    if (!instanceId || !user) return;

    const room = rooms.get(instanceId);
    if (!room) return;

    room.participants = room.participants.filter(p => p.id !== user.id);
    console.log(`${user.username} left room ${instanceId}`);

    if (room.participants.length === 0) {
      rooms.delete(instanceId);
      console.log(`Room ${instanceId} deleted (empty)`);
    } else {
      // Transfer host if the host left
      if (room.host === user.id) {
        room.host = room.participants[0].id;
        console.log(`Host transferred to ${room.participants[0].username}`);
      }
      broadcastRoomState(instanceId);
    }
  });
});

// ── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
