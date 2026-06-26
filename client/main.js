import './style.css'
import { initDiscord } from './discord.js'
import { init as initLobby } from './lobby.js'
import { init as initDraftLobby } from './draft-lobby.js'
import { init as initPokemonTable } from './pokemon-table.js'

let discordCtx = null

async function bootstrap() {
  document.querySelector('#app').innerHTML = `<p class="loading">Conectando...</p>`
  try {
    discordCtx = await initDiscord()
  } catch (err) {
    document.querySelector('#app').innerHTML = `
      <p style="color:#ff6b6b">Error al conectar con Discord: ${err.message}</p>
    `
    return
  }
  handleRoute()
}

function handleRoute() {
  const page = location.hash.replace('#', '') || 'lobby'
  if (page === 'lobby')             initLobby(discordCtx)
  else if (page === 'create-draft') initDraftLobby(discordCtx)
  else if (page === 'pokemon-table') initPokemonTable(discordCtx)
  else if (page === 'join-draft')   renderJoinDraft()
  else initLobby(discordCtx)
}

function renderJoinDraft() {
  document.querySelector('#app').innerHTML = `
    <div class="back-bar"><a class="back-link" href="#lobby">← Volver</a></div>
    <h1>Pokémon Draft</h1>
    <p style="opacity:0.5">Unirse a un draft — próximamente</p>
  `
}

window.addEventListener('hashchange', handleRoute)
bootstrap()
