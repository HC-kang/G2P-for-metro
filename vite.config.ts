import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// app.json이 버전의 유일한 출처다. 화면에 보이는 값과 패키징되는 값이 어긋나면 안 된다.
const { name, version } = JSON.parse(readFileSync('app.json', 'utf8'))

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
  define: {
    'import.meta.env.VITE_APP_NAME': JSON.stringify(name),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
  },
  // HMR을 끈다. 편집을 밀어넣을 때마다 안경에 떠 있는 페이지가 통째로 다시 시작됐고,
  // 13번 재시작 뒤 안경이 화면 재구성을 전부 거부했다(2026-09-23 로그). 
  // 시험 중인 사람의 세션을 내가 깨면 안 된다. 새 코드는 사용자가 QR을 다시 찍을 때 받는다.
  server: { host: true, port: 5173, hmr: false },
  build: { target: 'esnext' },
})
