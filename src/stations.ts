import data from './stations.json' with { type: 'json' }

export type Station = { name: string; line: string; branch: string; order: number; fr: string }
export type Edge = { to: string; w: number }
export type Coord = { name: string; lat: number; lon: number }

// 환승 1회를 몇 정거장으로 칠지. 경로 결과를 바꾸는 조정 손잡이다.
export const TRANSFER_COST = 5
// 2호선은 순환한다. 본선의 끝과 처음을 잇는다.
const CIRCULAR = new Set(['2호선'])

export const node = (line: string, name: string): string => `${line}|${name}`

const byId = new Map<string, string>(
  (data.lines as { id: string; name: string }[]).map(l => [l.id, l.name]),
)
const LIVE = new Set(byId.values())

// 실시간 API가 지원하지 않는 노선(인천·김포·용인·의정부 자체 노선, 역 100개)을 뺀다.
// 남겨 두면 경로가 추적 불가 구간을 지나고, 그때 안내가 조용히 멈춘다.
// lines가 비어 있으면(실시간 키 없이 빌드한 경우) 거르지 않는다.
export const supported = (line: string): boolean => LIVE.size === 0 || LIVE.has(line)

const STATIONS = (data.stations as Station[]).filter(s => supported(s.line))
const LIVE_NAMES = new Set(STATIONS.map(s => s.name))
// 추적할 수 없는 역은 GPS 후보로도 내놓지 않는다.
export const COORDS: readonly Coord[] = (data.coords as Coord[]).filter(c => LIVE_NAMES.has(c.name))

const byNode = new Map<string, Station>(STATIONS.map(s => [node(s.line, s.name), s]))
const byLine = new Map<string, Station[]>()
const byName = new Map<string, Station[]>()
for (const s of STATIONS) {
  ;(byLine.get(s.line) ?? byLine.set(s.line, []).get(s.line)!).push(s)
  ;(byName.get(s.name) ?? byName.set(s.name, []).get(s.name)!).push(s)
}
for (const list of byLine.values()) {
  list.sort((a, b) => a.branch.localeCompare(b.branch) || a.order - b.order)
}

const adj = new Map<string, Edge[]>()
for (const s of STATIONS) adj.set(node(s.line, s.name), [])
const link = (a?: Station, b?: Station, w = 1): void => {
  if (!a || !b) return
  const [x, y] = [node(a.line, a.name), node(b.line, b.name)]
  if (x === y || !adj.has(x) || !adj.has(y)) return
  adj.get(x)!.push({ to: y, w })
  adj.get(y)!.push({ to: x, w })
}

// 1) 같은 line + branch에서 order가 연속인 역끼리 잇는다
const groups = new Map<string, Station[]>()
for (const s of STATIONS) {
  const k = `${s.line}|${s.branch}`
  ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(s)
}
for (const g of groups.values()) {
  g.sort((a, b) => a.order - b.order)
  for (let i = 1; i < g.length; i++) link(g[i - 1], g[i])
}

const byFr = new Map<string, Station>(STATIONS.map(s => [`${s.line}|${s.fr}`, s]))

for (const g of groups.values()) {
  const head = g[0]
  // 2) "NNN-" 지선의 첫 역을 FR_CODE가 "NNN"인 역에 잇는다 (성수지선 -> 성수)
  const base = head.branch.endsWith('-') ? head.branch.slice(0, -1) : null
  if (base) link(byFr.get(`${head.line}|${base}`), head)
  // 3) "P" 같은 알파벳 분기의 첫 역을 숫자 order-1 역에 잇는다 (P142 -> 141 구로)
  else if (head.branch) link(byFr.get(`${head.line}|${head.order - 1}`), head)
}

// 4) 순환 노선은 본선의 끝과 처음을 잇는다
for (const [k, g] of groups) {
  const [line, branch] = k.split('|')
  if (CIRCULAR.has(line) && branch === '') link(g[g.length - 1], g[0])
}

// 5) 같은 이름 다른 노선을 잇는다 (환승).
// 이름만 같고 실제로는 떨어져 있는 역은 잇지 않는다. 빌드 때 좌표로 가려낸 목록이다.
// 양평은 중앙선과 5호선이 53km 떨어져 있다. 이어 두면 엉뚱한 경로가 나온다.
const NO_TRANSFER = new Set((data as { noTransfer?: string[] }).noTransfer ?? [])
for (const [name, g] of byName) {
  if (NO_TRANSFER.has(name)) continue
  for (let i = 0; i < g.length; i++) {
    for (let j = i + 1; j < g.length; j++) link(g[i], g[j], TRANSFER_COST)
  }
}

// 폰 설정 화면의 검증과 자동완성이 쓴다. 추적 가능한 역만 들어 있다.
export const NAMES: readonly string[] = [...new Set(STATIONS.map(s => s.name))].sort((a, b) => a.localeCompare(b, 'ko'))

export const neighbors = (n: string): Edge[] => adj.get(n) ?? []
export const nodesOf = (name: string): string[] => (byName.get(name) ?? []).map(s => node(s.line, s.name))
export const stationAt = (n: string): Station | undefined => byNode.get(n)
export const lineStations = (line: string): Station[] => byLine.get(line) ?? []
export const transferLines = (name: string): string[] => [...new Set((byName.get(name) ?? []).map(s => s.line))]
export const lineName = (subwayId: string): string => byId.get(subwayId) ?? ''

// 도착 API가 받는 역 표기. 빌드 때 실제 응답에서 배운 표다(추측이 아니다).
// 표에 없으면 그대로 쓴다. 그러면 도착 정보가 비고, 화면이 그렇게 말한다.
const apiNames = new Map<string, string>(Object.entries((data as { arrivalNames?: Record<string, string> }).arrivalNames ?? {}))
export const arrivalName = (station: string): string => apiNames.get(station) ?? station
// 빌드 때 실제 응답으로 확인한 이름인가. 확인된 이름이 빈 결과를 주면 열차가 없는 것이지 이름이 틀린 게 아니다.
export const hasArrivalName = (station: string): boolean => apiNames.has(station)

// 조회가 비었을 때 한 번 더 시도할 이름. 좌표표의 괄호 이름과 문장부호 변형이다.
// 4·19민주묘지를 도착 API는 4.19민주묘지로 쓴다.
const altMap = new Map<string, string>(Object.entries((data as { altNames?: Record<string, string> }).altNames ?? {}))
export function altArrivalNames(station: string): string[] {
  const out: string[] = []
  const alt = altMap.get(station)
  if (alt && alt !== arrivalName(station)) out.push(alt)
  const dotted = station.replace(/·/g, '.')
  if (dotted !== station) out.push(dotted)
  return out
}
