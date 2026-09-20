import { lineName } from './stations.ts'

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

// "2026-09-20 18:38:29" -> epoch ms. 기기와 서버가 같은 KST를 쓴다고 본다.
const toMs = (s: string): number => {
  const t = Date.parse(String(s).replace(' ', 'T'))
  return Number.isFinite(t) ? t : Date.now()
}

const rows = (body: unknown, key: string): Record<string, string>[] => {
  const list = (body as Record<string, unknown> | null)?.[key]
  return Array.isArray(list) ? (list as Record<string, string>[]) : []
}

export function parsePositions(body: unknown): TrainPos[] {
  return rows(body, 'realtimePositionList').map((r): TrainPos => ({
    trainNo: String(r.trainNo ?? ''),
    station: String(r.statnNm ?? ''),
    status: Number(r.trainSttus ?? 0),
    express: r.directAt === '1',
    terminal: String(r.statnTnm ?? ''),
    at: toMs(r.recptnDt),
  }))
}

export function parseArrivals(body: unknown): Arrival[] {
  return rows(body, 'realtimeArrivalList').map((r): Arrival => ({
    trainNo: String(r.btrainNo ?? ''),
    station: String(r.statnNm ?? ''),
    line: lineName(String(r.subwayId ?? '')),
    etaSec: Number(r.barvlDt ?? 0),
    msg: String(r.arvlMsg2 ?? ''),
    toward: towardOf(String(r.trainLineNm ?? '')),
    dest: destOf(String(r.trainLineNm ?? '')),
    express: String(r.btrainSttus ?? '').includes('급행'),
  }))
}

const get = async (path: string): Promise<unknown> => {
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-metro-token': TOKEN } })
  if (res.status === 403) throw new Error('앱 설정이 서버와 맞지 않습니다')
  if (!res.ok) throw new Error(`서버 ${res.status}`)
  return res.json()
}

export const positions = async (line: string): Promise<TrainPos[]> =>
  parsePositions(await get(`/position/${encodeURIComponent(line)}`))

export const arrivals = async (station: string): Promise<Arrival[]> =>
  parseArrivals(await get(`/arrival/${encodeURIComponent(station)}`))
