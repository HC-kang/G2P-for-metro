import { lineName, liveName, arrivalName, altArrivalNames, hasArrivalName } from './stations.ts'

// 두 API가 같은 역을 다르게 쓴다. 위치는 '군자(능동)', 역 목록은 '군자'다.
// 비교할 때는 양쪽에서 괄호를 뗀다.
export const bare = (name: string): string => name.replace(/\(.*?\)/g, '').trim()

// 워커가 http 전용 원 API를 https로 중계한다. 실시간 키는 워커에 있다.
// import.meta.env는 Vite가 채운다. node --test에는 없으므로 ?.로 받는다.
const BASE = import.meta.env?.VITE_API_BASE ?? ''
const TOKEN = import.meta.env?.VITE_API_TOKEN ?? ''

export type TrainPos = {
  trainNo: string; station: string
  status: number; express: boolean; terminal: string; at: number
}

export type Arrival = {
  trainNo: string; station: string; line: string
  etaSec: number; msg: string; toward: string; dest: string; express: boolean
  last: boolean   // 막차(lstcarAt=1). 목록에 표시한다
  ageSec: number  // 이 기록이 만들어진 지 몇 초 됐는지(recptnDt). etaSec은 이미 이만큼 뺀 값이다
  code: number    // arvlCd: 0 진입, 1 도착, 2 출발, 3 전역출발, 4 전역진입, 5 전역도착, 99 운행 중. 2면 이미 떠났다
}

// "광운대행 - 시청방면"           -> "시청"
// "동인천행 - 구로방면 (급행)"     -> "구로"       ($ 앵커를 쓰면 (급행)에서 실패한다)
// "불암산행 - 총신대입구(이수)방면" -> "총신대입구"  (괄호 별칭을 떼야 역 목록과 맞는다)
export const towardOf = (trainLineNm: string): string => {
  const m = /-\s*(.+?)방면/.exec(trainLineNm ?? '')
  return m ? m[1].replace(/\(.*?\)/g, '').trim() : ''
}

// "광운대행 - 시청방면" -> "광운대". 승강장 전광판이 보여주는 행선지다.
export const destOf = (trainLineNm: string): string => {
  const m = /^\s*(.+?)행/.exec(trainLineNm ?? '')
  return m ? m[1].replace(/\(.*?\)/g, '').trim() : ''
}

// "2026-09-20 18:38:29" -> epoch ms. 서버는 KST로 준다.
// 기기 시간대가 KST가 아니면 몇 시간씩 어긋나 "3시간 전" 같은 거짓말이 나온다.
// 10분 넘게 어긋나면 파싱을 믿지 않고 받은 시각을 쓴다.
const SANE_MS = 10 * 60_000
const toMs = (s: string): number => {
  const t = Date.parse(String(s).replace(' ', 'T'))
  const now = Date.now()
  return Number.isFinite(t) && Math.abs(now - t) < SANE_MS ? t : now
}

// 서울 API는 오류도 HTTP 200에 본문으로 준다. 목록이 없다고 빈 배열로 넘기면
// "도착 정보가 없습니다"로 둔갑해 원인을 숨긴다. 코드를 읽고 말해 준다.
// 생성자 파라미터 프로퍼티는 node --test의 타입 제거 모드가 거부한다. 평범한 필드로 둔다.
// 워커가 토큰을 거부했다(403). 기다려도 낫지 않는다. 재시도하지 말고 원인을 말한다(리뷰 3라운드).
export class ConfigError extends Error {}

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const CODE_MESSAGE: Record<string, string> = {
  'ERROR-337': '서울 API 하루 한도를 다 썼습니다',
  'ERROR-338': 'API key가 실시간 서비스를 쓸 수 없습니다',
  'ERROR-336': '요청 건수가 한도를 넘었습니다',
  'ERROR-335': '샘플 key로는 5건만 볼 수 있습니다',
  'ERROR-300': '필수 값이 빠졌습니다',
  'ERROR-500': '서울 API 서버 오류입니다',
  'ERROR-600': '서울 API 서버 오류입니다',
}

const rows = (body: unknown, key: string): Record<string, string>[] => {
  const b = body as Record<string, unknown> | null
  const list = b?.[key]
  if (Array.isArray(list)) return list as Record<string, string>[]
  // INFO-200은 "지금 그 역에 올 열차가 없다"는 뜻이다. 오류가 아니다.
  const err = (b?.errorMessage ?? b) as Record<string, string> | undefined
  const code = String(err?.code ?? '')
  if (code.startsWith('ERROR-')) {
    throw new ApiError(code, CODE_MESSAGE[code] ?? `서울 API ${code}`)
  }
  return []
}

export function parsePositions(body: unknown): TrainPos[] {
  return rows(body, 'realtimePositionList').map((r): TrainPos => ({
    trainNo: String(r.trainNo ?? ''),
    // 경로 데이터 이름으로 바꾼다. '뚝섬유원지'를 모르는 역으로 읽어 7호선 주행마다 판단 보류가 났다.
    station: liveName(lineName(String(r.subwayId ?? '')), bare(String(r.statnNm ?? ''))),
    status: Number(r.trainSttus ?? 0),
    express: r.directAt === '1',
    terminal: String(r.statnTnm ?? ''),
    at: toMs(r.recptnDt),
  }))
}

// 남은 초(barvlDt)는 '지금부터'가 아니라 기록이 만들어진 때(recptnDt)부터다. 그 기록은 평소 약 1분, 붐빌 때는 3~4분 묵어서 온다.
// 그대로 '지금부터'로 읽어서 이미 떠난 열차를 '2분 뒤 도착'이라고 태웠다(10-01 출근: 7085·7087·6074).
// 그래서 기록의 나이를 뺀다. 음수면 이미 왔거나 지나갔다는 뜻이다.
export function parseArrivals(body: unknown, now = Date.now()): Arrival[] {
  return rows(body, 'realtimeArrivalList').map((r): Arrival => {
    const made = Date.parse(String(r.recptnDt ?? '').replace(' ', 'T'))
    const ageSec = Number.isFinite(made) ? Math.max(0, Math.round((now - made) / 1000)) : 0
    const code = r.arvlCd == null || r.arvlCd === '' ? -1 : Number(r.arvlCd)
    // 공항철도·경의중앙선 등은 남은 초를 주지 않는다(늘 0). '[2]번째 전역 (서울)' 같은 문구와 상태 코드뿐이다.
    // 0을 그대로 쓰고 나이를 빼면 전부 음수가 되어 후보에서 사라졌다(10-02 공덕 공항철도: 6분 동안 후보 0대).
    const given = Number(r.barvlDt ?? 0)
    const base = given > 0 ? given : etaFromMessage(code, String(r.arvlMsg2 ?? ''))
    return {
    trainNo: String(r.btrainNo ?? ''),
    station: bare(String(r.statnNm ?? '')),
    line: lineName(String(r.subwayId ?? '')),
    etaSec: base - ageSec,
    ageSec,
    msg: String(r.arvlMsg2 ?? ''),
    // 방면도 경로 이름으로 바꾼다. 안 바꾸면 '뚝섬유원지방면'이 다음 역 '자양'과 어긋나 방향 거르기가 풀린다.
    toward: liveName(lineName(String(r.subwayId ?? '')), towardOf(String(r.trainLineNm ?? ''))),
    dest: destOf(String(r.trainLineNm ?? '')),
    express: String(r.btrainSttus ?? '').includes('급행'),
    last: String(r.lstcarAt ?? '') === '1',
    code,
    }
  })
}
// 남은 초가 없을 때 상태 코드와 문구로 어림한다. 역당 110초.
// 0 진입, 1 도착, 2 출발(이 역), 3 전역출발, 4 전역진입, 5 전역도착, 99 운행 중('[N]번째 전역').
export function etaFromMessage(code: number, msg: string): number {
  if (code === 0) return 15
  if (code === 1 || code === 2) return 0
  if (code === 3) return 60
  if (code === 4) return 125
  if (code === 5) return 110
  const n = /\[(\d+)\]번째 전역/.exec(msg)
  return n ? Number(n[1]) * 110 : 0
}

// 기기 로그를 모아 보낸다. 한 줄마다 fetch를 보냈더니 폴링 폭증 때 초당 수십 건이 나가
// 앱을 더 무겁게 만들었다(09-25 실측). 10초마다 한 번 보내고, 분당 줄 수를 넘으면 버린 줄 수만 남긴다.
// schedule은 테스트에서 바꿔 끼운다. 한 번짜리 타이머가 두 번 불려도 두 번째는 빈 버퍼라 아무것도 보내지 않는다.
// send가 false로 끝나면(전송 실패) 그 묶음을 버퍼 앞에 되돌린다. 지하 구간에서 끊긴 동안의 기록이
// 가장 쓸모 있다. 되돌린 것이 keepChars를 넘으면 오래된 것부터 버리고 버린 사실을 남긴다.
export function batcher(
  send: (text: string) => void | Promise<boolean>,
  { now = Date.now, everyMs = 10_000, perMin = 200, maxChars = 7000, keepChars = 20_000,
    schedule = (fn: () => void, ms: number): unknown => setTimeout(fn, ms) } = {},
) {
  let buf: string[] = [], size = 0, dropped = 0, windowAt = -Infinity, inWindow = 0, pending = false, lost = 0
  const later = () => { if (!pending) { pending = true; schedule(flush, everyMs) } }
  // 줄 단위로 되돌린다. 한 덩어리로 넣으면 한도를 넘어도 버릴 단위가 없어 끝없이 커졌다.
  const requeue = (text: string): void => {
    const lines = text.split('\n')
    buf.unshift(...lines); size += text.length + 1
    while (size > keepChars && buf.length) { size -= buf.shift()!.length + 1; lost++ }
    later()
  }
  function flush(): void {
    pending = false
    if (lost) { buf.unshift(`(전송 실패로 로그 ${lost}줄 버림)`); lost = 0 }
    if (dropped) { buf.push(`(로그 ${dropped}줄 버림: 분당 ${perMin}줄 초과)`); dropped = 0 }
    if (!buf.length) return
    const text = buf.join('\n')
    buf = []; size = 0
    void Promise.resolve(send(text)).then(ok => { if (ok === false) requeue(text) })
  }
  const push = (line: string): void => {
    const t = now()
    if (t - windowAt >= 60_000) { windowAt = t; inWindow = 0 }
    if (++inWindow > perMin) { dropped++; return }
    const l = line.slice(0, 500)
    buf.push(l); size += l.length + 1
    if (size >= maxChars) return flush()
    later()
  }
  return { push, flush }
}

// 개발 기간 자동 보고. 빌드 설정 VITE_LOG_REPORT=1일 때만 켜진다. 없으면 꺼진다(공개 빌드에 실수로 들어가지 않게).
// 워커가 묶음을 D1에 저장한다. 사용자가 버튼을 누르지 않아도, 내 Mac이 꺼져 있어도 기록이 남는다.
// 로그에는 GPS 좌표가 들어간다. 폰 설정 화면에 자동 보고 중임을 표시한다.
export const REPORTING = !!BASE && import.meta.env?.VITE_LOG_REPORT === '1'
// 실행마다 다른 이름. 여러 번 켜고 끈 기록을 가를 수 있다. 개발 서버에서 돈 것은 dev-로 시작한다.
export const SESSION = `${import.meta.env?.DEV ? 'dev-' : ''}${import.meta.env?.VITE_APP_VERSION ?? ''}-${Math.random().toString(36).slice(2, 8)}`
const post = (text: string, kind: 'live' | 'trail', keepalive: boolean): Promise<boolean> =>
  fetch(`${BASE}/log`, {
    method: 'POST',
    headers: { 'x-metro-token': TOKEN, 'Content-Type': 'text/plain', 'x-metro-kind': kind, 'x-metro-session': SESSION },
    body: text,
    keepalive,
  }).then(r => r.ok, () => false)
// 주행 중에는 폴링 직후에 보낸다(flushLog). 예비 타이머는 60초라, 매분 기록이 통신을 따로 깨우는 일이 드물다(리뷰 2라운드).
const logs = REPORTING ? batcher(text => post(text, 'live', true), { everyMs: 60_000 }) : null
let ended = false
// 폰 설정의 '진단 기록 자동 보고' 스위치. 꺼져 있으면 모으지도 보내지도 않는다.
let reportOn = true
export const setReporting = (on: boolean): void => { reportOn = on }
export const remoteLog = (msg: string): void => { if (!ended && reportOn) logs?.push(msg) }
// 화면이 꺼지거나 앱이 끝날 때 남은 것을 바로 보낸다.
export const flushLog = (): void => logs?.flush()
// 앱이 끝나면 남은 것을 보내고 멈춘다. 종료 뒤에도 WebView가 몇 시간 살아 1분마다 기록을 보냈다(09-28).
export const endLog = (): void => { logs?.flush(); ended = true }

// 기록 묶음을 보낸다. 성공 여부를 돌려주므로 화면이 사실대로 말할 수 있다.
export async function sendTrail(text: string): Promise<boolean> {
  // 자동 보고와 상관없이 사용자가 누르면 보낸다. 워커가 D1에 kind=trail로 저장한다.
  if (!BASE) return false
  return post(text.slice(-30000), 'trail', false)
}

// 실제 요청마다 부른다. 한도와 폭주를 여기서 막아야 재시도까지 빠짐없이 센다.
// 논리 호출 단위로 세면 도착 조회의 예비 이름 재시도(최대 3번)가 1번으로 보인다.
let beforeRequest: (path: string) => void = () => {}
export const setRequestGuard = (fn: (path: string) => void): void => { beforeRequest = fn }

// 개발 모드 ?api=dev 이면 워커 대신 dev 서버의 모사 피드를 읽는다. 배포본은 타지 않는다.
const DEV_API = !!import.meta.env?.DEV && typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('api') === 'dev'

// 워커가 서울 API를 실제로 부른 오늘(KST) 횟수. 기기 카운터와 다를 수 있다(캐시, 다른 기기). 큰 쪽을 믿는다.
// 응답마다 부른다. 헤더가 없으면 -1('서버 집계 없음'). 한 번도 안 불렸으면 앱은 '확인 전'이라고 쓴다.
let onServerUsed: (n: number) => void = () => {}
export const setServerUsedListener = (fn: (n: number) => void): void => { onServerUsed = fn }
// 요청이 서버에 닿지도 못했다(오프라인). 기기 카운터에서 되돌린다. 긴 장애가 그날 한도를 거짓으로 채웠다(리뷰 3라운드).
let onUnsent: () => void = () => {}
export const setUnsentListener = (fn: () => void): void => { onUnsent = fn }
// 연속 실패가 시작된 시각(0이면 지금 정상). 실패가 10분 이어지면 앱이 재시도를 멈춘다(리뷰 3라운드).
// '마지막 정상 응답'부터 재면 한동안 조회가 없던 뒤의 첫 실패 한 번에 멈췄다. 정상은 읽을 수 있는 본문까지다
// (HTTP 200이어도 JSON이 아니거나 서울 API 일시 오류면 실패다, 리뷰 4라운드).
let failAt = 0
const FETCH_TIMEOUT_MS = 10_000
export const failingFor = (): number => (failAt ? Date.now() - failAt : 0)
const failed = (e: Error): Error => { failAt ||= Date.now(); return e }
// 서울 API가 HTTP 200 본문으로 주는 일시 오류. 기다리면 낫는다. 10분 상한 안에서 다시 시도한다.
const TRANSIENT = new Set(['ERROR-500', 'ERROR-600'])

const get = async (path: string): Promise<unknown> => {
  beforeRequest(path)
  let res: Response
  // 응답이 끝내 안 오면 폴링이 멈춘 채 남는다. 10초에 끊는다(리뷰 3라운드: fetch에 타임아웃이 없었다).
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS)
  try {
    res = await fetch(`${DEV_API ? '/__api' : BASE}${path}`, { headers: { 'x-metro-token': TOKEN }, signal: abort.signal })
  } catch (e) {
    // 끊겨서 서버에 닿지도 못했다면 기기 카운터에서 되돌린다. 시간 초과는 서버가 부른 뒤일 수 있어 그대로 센다.
    if ((e as Error)?.name !== 'AbortError') onUnsent()
    throw failed(e as Error)
  } finally {
    clearTimeout(timer)
  }
  const n = Number(res.headers?.get?.('x-metro-used'))
  if (n > 0) onServerUsed(n)
  else if (res.ok) onServerUsed(-1)
  if (res.status === 403) throw failed(new ConfigError('앱 설정이 서버와 맞지 않습니다'))
  // 워커가 오늘 한도 가까이 막았다. 토큰이 새도 남이 한도를 다 쓰지 못하게 하는 장치다.
  if (res.status === 429) throw new ApiError('ERROR-337', '오늘 조회 한도(950건)를 다 썼습니다')
  if (!res.ok) throw failed(new Error(`서버 ${res.status}`))
  let body: unknown
  try { body = await res.json() } catch { throw failed(new Error('서버 응답을 읽지 못했습니다')) }
  const b = body as { errorMessage?: { code?: string }; code?: string } | null
  const code = String(b?.errorMessage?.code ?? b?.code ?? '')
  if (TRANSIENT.has(code)) throw failed(new Error(`서울 API 일시 오류 ${code}`))
  failAt = 0
  return body
}

// train을 주면 워커가 그 열차 한 대만 돌려준다. 노선 전체(수십 대)를 받던 것을 줄인다(통신량).
export const positions = async (line: string, train?: string): Promise<TrainPos[]> =>
  parsePositions(await get(`/position/${encodeURIComponent(line)}${train ? `?train=${encodeURIComponent(train)}` : ''}`))

// 도착 API는 자기 표기로만 받는다. '공릉'은 데이터 없음, '공릉(서울산업대입구)'는 정상이다.
// 빌드 때 만든 표에 없으면 예비 이름으로 한 번 더 시도한다.
// 한도가 아까우므로 비었을 때만, 그것도 한 번만 더 부른다.
export async function arrivals(station: string): Promise<Arrival[]> {
  const first = parseArrivals(await get(`/arrival/${encodeURIComponent(arrivalName(station))}`))
  if (first.length) return first
  // 확인된 이름이 빈 결과를 주면 지금 올 열차가 없는 것이다. 예비 이름을 두 번 더 불러도 같다.
  // 그 두 번이 탭마다 쌓여 하루 한도와 폭주 가드를 갉아먹었다.
  if (hasArrivalName(station)) return first
  for (const alt of altArrivalNames(station)) {
    const retry = parseArrivals(await get(`/arrival/${encodeURIComponent(alt)}`))
    if (retry.length) return retry
  }
  return first
}
