import {defineConfig} from 'vite';

const isDiscordMode = process.env.DISCORD_MODE === 'true';

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '../',
  server: {
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
    hmr: isDiscordMode ? { clientPort: 443 } : true,
  },
});
