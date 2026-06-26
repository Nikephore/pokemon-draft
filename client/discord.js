import { DiscordSDK, DiscordSDKMock } from '@discord/embedded-app-sdk'

const isEmbedded = window.parent !== window

// Persistent mock user ID per browser tab session
let mockUserId = sessionStorage.getItem('mock-user-id')
if (!mockUserId) {
  mockUserId = 'local-' + Math.random().toString(36).slice(2, 8)
  sessionStorage.setItem('mock-user-id', mockUserId)
}

export async function initDiscord() {
  if (!isEmbedded) {
    const sdk = new DiscordSDKMock(
      import.meta.env.VITE_DISCORD_CLIENT_ID,
      'mock-guild-id',
      'mock-channel-id',
      null
    )
    await sdk.ready()
    return {
      sdk,
      user: {
        id: mockUserId,
        username: 'Usuario_' + mockUserId.slice(-4),
        discriminator: '0',
        avatar: null,
        global_name: 'Usuario ' + mockUserId.slice(-4),
      },
    }
  }

  const sdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID)
  await sdk.ready()

  const { code } = await sdk.commands.authorize({
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

  const auth = await sdk.commands.authenticate({ access_token })
  return { sdk, user: auth.user }
}
