// 서울 실시간 지하철 API 프록시.
// 두 가지를 푼다.
//   (1) 원 API가 http 전용이라 https 페이지에서 부를 수 없다.
//   (2) 실시간 키를 클라이언트에 두지 않는다.
// 경로는 둘뿐이다. 임의 URL을 중계하지 않는다.
const BASE = 'http://swopenapi.seoul.go.kr/api/subway'

const ROUTES = {
  position: arg => `realtimePosition/0/200/${encodeURIComponent(arg)}`,
  arrival: arg => `realtimeStationArrival/0/40/${encodeURIComponent(arg)}`,
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-metro-token, content-type, x-metro-kind, x-metro-session',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const reply = (body, status, extra = {}) =>
  new Response(body, { status, headers: { ...cors, ...extra } })

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return reply(null, 204)

    // 기기 로그. dev 서버는 같은 Wi-Fi에서만 받는다. 지하철에 타면 끊긴다.
    // 받은 묶음은 D1에 저장한다(개발 기간). tail이 끊겨 있던 사이의 기록을 놓친 적이 있다(2026-09-26).
    //   x-metro-kind: live(10초 묶음) | trail("서버로 보내기")   x-metro-session: 앱버전-실행ID
    if (request.method === 'POST' && new URL(request.url).pathname === '/log') {
      if (request.headers.get('x-metro-token') !== env.METRO_TOKEN) return reply('forbidden', 403)
      const text = (await request.text()).slice(-30000)
      if (env.DB && text.trim()) {
        const kind = request.headers.get('x-metro-kind') === 'trail' ? 'trail' : 'live'
        const session = (request.headers.get('x-metro-session') ?? '').slice(0, 40)
        // 저장이 실패해도 앱에는 성공으로 답한다. 로그 때문에 앱이 재시도를 쌓으면 안 된다.
        try {
          await env.DB.prepare('INSERT INTO logs (session, kind, body) VALUES (?, ?, ?)').bind(session, kind, text).run()
        } catch (e) {
          console.log('[log] d1 insert failed', String(e))
        }
        // 14일 지난 것을 가끔 지운다. 백 번에 한 번이면 충분하다.
        if (Math.random() < 0.01) {
          ctx.waitUntil(env.DB.prepare("DELETE FROM logs WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-14 days')").run().catch(() => {}))
        }
      }
      // 한 줄이 길면 대시보드에서 잘리므로 줄 단위로 나눠 찍는다.
      for (const line of text.split('\n')) if (line.trim()) console.log('[device]', line.slice(0, 600))
      return reply(null, 204)
    }

    if (request.method !== 'GET') return reply('method not allowed', 405)

    const url = new URL(request.url)
    const [, kind, ...rest] = url.pathname.split('/')
    const arg = decodeURIComponent(rest.join('/'))
    const build = ROUTES[kind]
    if (!build || !arg) return reply('not found', 404)

    // 토큰은 앱 번들 안에 있으므로 꺼낼 수 있다.
    // 우연한 남용을 막는 장치이지 인증이 아니다. 개인용이라 이 수준으로 충분하다.
    if (request.headers.get('x-metro-token') !== env.METRO_TOKEN) return reply('forbidden', 403)

    const upstream = `${BASE}/${env.SEOUL_RT_KEY}/json/${build(arg)}`
    let res
    try {
      // 같은 역을 여러 번 열어도 상류를 다시 때리지 않는다. 5초면 10초 polling에 안전하다.
      // 서울 API는 하루 1000건이 한도다(ERROR-337). 캐시로 상류 호출을 아낀다.
      // 20초면 열차 위치가 의미 있게 바뀌지 않는다.
      res = await fetch(upstream, { cf: { cacheTtl: 20, cacheEverything: true } })
    } catch {
      return reply('upstream unreachable', 502)
    }
    const body = await res.text()
    // 한도 소진은 HTTP 200으로 온다. tail에서 바로 보이게 남긴다.
    if (body.includes('ERROR-337')) console.log('[quota] 일일 1000건 한도 소진')
    return reply(body, res.status, { 'Content-Type': 'application/json; charset=utf-8' })
  },
}
