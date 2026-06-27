import { DiscordSDK, DiscordSDKMock, patchUrlMappings } from '@discord/embedded-app-sdk'

const isEmbedded = window.parent !== window

let mockUserId = sessionStorage.getItem('mock-user-id')
if (!mockUserId) {
  mockUserId = 'local-' + Math.random().toString(36).slice(2, 8)
  sessionStorage.setItem('mock-user-id', mockUserId)
}

// SDK must be instantiated synchronously at module load so the postMessage
// listener is registered before Discord sends the HANDSHAKE message
if (isEmbedded) {
  patchUrlMappings([{ prefix: '/api', target: 'localhost:3001' }])
}

const discordSdk = isEmbedded
  ? new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID)
  : new DiscordSDKMock(import.meta.env.VITE_DISCORD_CLIENT_ID, 'mock-guild-id', 'mock-channel-id', null)

export async function initDiscord() {
  if (!isEmbedded) {
    await discordSdk.ready()
    return {
      sdk: discordSdk,
      user: {
        id: mockUserId,
        username: 'Usuario_' + mockUserId.slice(-4),
        discriminator: '0',
        avatar: null,
        global_name: 'Usuario ' + mockUserId.slice(-4),
      },
    }
  }

  await discordSdk.ready()

  const { code } = await discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  })

  const { access_token } = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }).then(r => r.json())

  const auth = await discordSdk.commands.authenticate({ access_token })
  return { sdk: discordSdk, user: auth.user }
}
