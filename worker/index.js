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
  'Access-Control-Expose-Headers': 'x-metro-used',
}

// 서울 실시간 API는 키 하나에 하루(KST) 1000건이다. 워커가 직접 센다.
// 기기 카운터만 있으면 토큰이 샜을 때 남이 한도를 다 써도 모른다. 950건에서 막고 남은 50건은 여유로 둔다.
const DAILY_CAP = 950
const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
async function usedToday(env) {
  if (!env.DB) return 0
  const row = await env.DB.prepare('SELECT n FROM usage WHERE day = ?').bind(kstDay()).first().catch(() => null)
  return row?.n ?? 0
}
async function countCall(env) {
  if (!env.DB) return 0
  const row = await env.DB.prepare('INSERT INTO usage (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(kstDay()).first().catch(() => null)
  return row?.n ?? 0
}

// 앱이 쓰는 필드만 남긴다. 위치 응답은 노선 전체라 크다. train을 주면 그 열차만.
const POS_FIELDS = ['subwayId', 'statnNm', 'trainNo', 'trainSttus', 'recptnDt', 'directAt', 'statnTnm']
function slimPositions(body, train) {
  let j
  try { j = JSON.parse(body) } catch { return body }
  const list = j.realtimePositionList
  if (!Array.isArray(list)) return body
  const kept = (train ? list.filter(r => r.trainNo === train) : list)
    .map(r => Object.fromEntries(POS_FIELDS.map(k => [k, r[k]])))
  return JSON.stringify({ realtimePositionList: kept })
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
    const before = await usedToday(env)
    if (before >= DAILY_CAP) {
      console.log('[quota] cap reached', before)
      return reply(JSON.stringify({ errorMessage: { code: 'ERROR-337', message: '오늘 조회 한도' } }), 429,
        { 'Content-Type': 'application/json; charset=utf-8', 'x-metro-used': String(before) })
    }
    let res
    try {
      // 같은 요청이 몇 초 안에 겹치면 상류를 다시 때리지 않는다(서울 API 하루 1000건).
      // 5초로 둔다. 20초였을 때 15초 폴링의 절반이 최대 20초 묵은 응답을 받았다(2026-09-29).
      res = await fetch(upstream, { cf: { cacheTtl: 5, cacheEverything: true } })
    } catch {
      return reply('upstream unreachable', 502)
    }
    const raw = await res.text()
    // 캐시에서 나온 응답은 서울 API를 부르지 않았다. 실제로 부른 것만 센다.
    const hit = res.headers.get('cf-cache-status') === 'HIT'
    const used = hit ? before : await countCall(env)
    // 한도 소진은 HTTP 200으로 온다. tail에서 바로 보이게 남긴다.
    if (raw.includes('ERROR-337')) console.log('[quota] 일일 1000건 한도 소진')
    const body = kind === 'position' ? slimPositions(raw, url.searchParams.get('train')) : raw
    return reply(body, res.status, { 'Content-Type': 'application/json; charset=utf-8', 'x-metro-used': String(used) })
  },
}
