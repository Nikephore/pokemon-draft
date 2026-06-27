import './style.css'
import { initDiscord } from './discord.js'
import { init as initLobby } from './lobby.js'
import { init as initDraftLobby } from './draft-lobby.js'
import { init as initJoinDraft } from './join-draft.js'
import { init as initPokemonTable } from './pokemon-table.js'
import { init as initDraftHistory } from './draft-history.js'

let discordCtx = null

async function bootstrap() {
  const app = document.querySelector('#app')
  app.innerHTML = `<p class="loading">Conectando con Discord...</p>`
  try {
    discordCtx = await initDiscord()
  } catch (err) {
    app.innerHTML = `<p class="error-msg">Error: ${err.message}</p>
                     <pre class="error-stack">${err.stack}</pre>`
    return
  }
  handleRoute()
}

function handleRoute() {
  const page = location.hash.replace('#', '') || 'lobby'
  if (page === 'lobby')             initLobby(discordCtx)
  else if (page === 'create-draft') initDraftLobby(discordCtx)
  else if (page === 'pokemon-table') initPokemonTable(discordCtx)
  else if (page === 'join-draft')    initJoinDraft(discordCtx)
  else if (page === 'draft-history') initDraftHistory(discordCtx)
  else initLobby(discordCtx)
}

window.addEventListener('hashchange', handleRoute)
bootstrap()
