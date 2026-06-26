import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import fetch from "node-fetch";
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
          .then(d => ({
            id: d.id,
            name: d.name,
            types: d.types.map(t => t.type.name),
            stats: {
              hp:      d.stats[0].base_stat,
              attack:  d.stats[1].base_stat,
              defense: d.stats[2].base_stat,
              spa:     d.stats[3].base_stat,
              spd:     d.stats[4].base_stat,
              speed:   d.stats[5].base_stat,
            },
          }))
      )
    );
    results.push(...batchResults);
    console.log(`Pokemon details: ${Math.min(i + batchSize, urls.length)}/${urls.length}`);
  }
  return results;
}

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
      return id >= 1 && id <= 1025;
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
  });

  console.log(`Cache ready: ${pokemonCache.length} Pokemon`);
  res.json(pokemonCache);
});

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

// ── Draft rooms ──────────────────────────────────────────────────────────────

// rooms: Map<instanceId, { host: userId, participants: User[], draft: Draft|null }>
const rooms = new Map();

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

    broadcastRoomState(instanceId);
  });

  socket.on("create-draft", ({ instanceId, config }) => {
    const room = rooms.get(instanceId);
    if (!room) return;
    if (room.draft) return; // draft already exists
    if (room.host !== socket.data.user?.id) return; // only host can create

    room.draft = { config, phase: "lobby", picks: [] };
    console.log(`Draft created in room ${instanceId}`);
    broadcastRoomState(instanceId);
  });

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
