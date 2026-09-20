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
  'Access-Control-Allow-Headers': 'x-metro-token, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const reply = (body, status, extra = {}) =>
  new Response(body, { status, headers: { ...cors, ...extra } })

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return reply(null, 204)

    // 기기 로그. dev 서버는 같은 Wi-Fi에서만 받는다. 지하철에 타면 끊긴다.
    // 여기로 보내면 `npx wrangler tail`로 어디서든 본다. 저장하지 않는다.
    if (request.method === 'POST' && new URL(request.url).pathname === '/log') {
      if (request.headers.get('x-metro-token') !== env.METRO_TOKEN) return reply('forbidden', 403)
      console.log('[device]', (await request.text()).slice(0, 500))
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
      res = await fetch(upstream, { cf: { cacheTtl: 5, cacheEverything: true } })
    } catch {
      return reply('upstream unreachable', 502)
    }
    const body = await res.text()
    return reply(body, res.status, { 'Content-Type': 'application/json; charset=utf-8' })
  },
}
