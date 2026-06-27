import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../', '')
  const isDiscordMode = env.DISCORD_MODE === 'true'
  const tunnelHost = env.TUNNEL_HOST

  return {
    envDir: '../',
    server: {
      host: '127.0.0.1',
      allowedHosts: tunnelHost ? [tunnelHost] : [],
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
          ws: true,
        },
        '/socket.io': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          ws: true,
          configure: proxy => {
            proxy.on('error', err => {
              if (!['ECONNABORTED', 'ECONNRESET'].includes(err.code)) {
                console.error('socket.io proxy error:', err)
              }
            })
          },
        },
      },
      hmr: isDiscordMode ? false : true,
    },
  }
})
