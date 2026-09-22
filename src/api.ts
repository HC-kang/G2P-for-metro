import { lineName, arrivalName, altArrivalNames } from './stations.ts'

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
export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const CODE_MESSAGE: Record<string, string> = {
  'ERROR-337': '오늘 조회 한도(1000건)를 다 썼습니다',
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
    station: bare(String(r.statnNm ?? '')),
    status: Number(r.trainSttus ?? 0),
    express: r.directAt === '1',
    terminal: String(r.statnTnm ?? ''),
    at: toMs(r.recptnDt),
  }))
}

export function parseArrivals(body: unknown): Arrival[] {
  return rows(body, 'realtimeArrivalList').map((r): Arrival => ({
    trainNo: String(r.btrainNo ?? ''),
    station: bare(String(r.statnNm ?? '')),
    line: lineName(String(r.subwayId ?? '')),
    etaSec: Number(r.barvlDt ?? 0),
    msg: String(r.arvlMsg2 ?? ''),
    toward: towardOf(String(r.trainLineNm ?? '')),
    dest: destOf(String(r.trainLineNm ?? '')),
    express: String(r.btrainSttus ?? '').includes('급행'),
  }))
}

// 기기 로그. dev 서버는 같은 Wi-Fi에서만 받으므로 지하철에서는 끊긴다.
// 워커로 보내면 `npx wrangler tail`로 어디서든 본다. 실패해도 앱을 방해하지 않는다.
export const remoteLog = (msg: string): void => {
  if (!BASE) return
  void fetch(`${BASE}/log`, {
    method: 'POST',
    headers: { 'x-metro-token': TOKEN, 'Content-Type': 'text/plain' },
    body: msg.slice(0, 500),
    keepalive: true,
  }).catch(() => {})
}

// 기록 묶음을 보낸다. 성공 여부를 돌려주므로 화면이 사실대로 말할 수 있다.
export async function sendTrail(text: string): Promise<boolean> {
  if (!BASE) return false
  try {
    const res = await fetch(`${BASE}/log`, {
      method: 'POST',
      headers: { 'x-metro-token': TOKEN, 'Content-Type': 'text/plain' },
      body: text.slice(0, 8000),
    })
    return res.ok
  } catch {
    return false
  }
}

// 실제 요청마다 부른다. 한도와 폭주를 여기서 막아야 재시도까지 빠짐없이 센다.
// 논리 호출 단위로 세면 도착 조회의 예비 이름 재시도(최대 3번)가 1번으로 보인다.
let beforeRequest: (path: string) => void = () => {}
export const setRequestGuard = (fn: (path: string) => void): void => { beforeRequest = fn }

const get = async (path: string): Promise<unknown> => {
  beforeRequest(path)
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-metro-token': TOKEN } })
  if (res.status === 403) throw new Error('앱 설정이 서버와 맞지 않습니다')
  if (!res.ok) throw new Error(`서버 ${res.status}`)
  return res.json()
}

export const positions = async (line: string): Promise<TrainPos[]> =>
  parsePositions(await get(`/position/${encodeURIComponent(line)}`))

// 도착 API는 자기 표기로만 받는다. '공릉'은 데이터 없음, '공릉(서울산업대입구)'는 정상이다.
// 빌드 때 만든 표에 없으면 예비 이름으로 한 번 더 시도한다.
// 한도가 아까우므로 비었을 때만, 그것도 한 번만 더 부른다.
export async function arrivals(station: string): Promise<Arrival[]> {
  const first = parseArrivals(await get(`/arrival/${encodeURIComponent(arrivalName(station))}`))
  if (first.length) return first
  for (const alt of altArrivalNames(station)) {
    const retry = parseArrivals(await get(`/arrival/${encodeURIComponent(alt)}`))
    if (retry.length) return retry
  }
  return first
}
