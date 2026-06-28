import './style.css'
import { initDiscord } from './discord.js'
import { init as initLobby } from './lobby.js'
import { init as initDraftLobby } from './draft-lobby.js'
import { init as initJoinDraft } from './join-draft.js'
import { init as initPokemonTable } from './pokemon-table.js'
import { init as initDraftHistory } from './draft-history.js'
import { init as initPresets } from './presets.js'
import { init as initPresetEditor } from './preset-editor.js'

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
  const hash = location.hash.replace('#', '') || 'lobby'
  if (hash === 'lobby')              initLobby(discordCtx)
  else if (hash === 'create-draft')  initDraftLobby(discordCtx)
  else if (hash === 'pokemon-table') initPokemonTable(discordCtx)
  else if (hash === 'draft-history') initDraftHistory(discordCtx)
  else if (hash.startsWith('join-draft/')) {
    const draftInstanceId = hash.slice('join-draft/'.length)
    initJoinDraft(discordCtx, draftInstanceId)
  }
  else if (hash === 'presets')          initPresets(discordCtx)
  else if (hash.startsWith('preset/')) {
    const presetId = hash.slice('preset/'.length)
    initPresetEditor(discordCtx, presetId)
  }
  else initLobby(discordCtx)
}

window.addEventListener('hashchange', handleRoute)
bootstrap()
