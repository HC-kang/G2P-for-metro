import { defineConfig } from 'vite'

export default defineConfig({
  // 실기기 WebView에는 볼 수 있는 콘솔이 없다. POST /__log가 dev server 터미널에 찍는다.
  plugins: [{
    name: 'device-log',
    configureServer(server) {
      server.middlewares.use('/__log', (req, res) => {
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => { console.log('[device]', body); res.end() })
      })
    },
  }],
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
})
