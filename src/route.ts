import { neighbors, nodesOf, stationAt } from './stations.ts'

export type Leg = { line: string; stops: string[] }   // stops[0] 승차역, 마지막이 하차역
export type Plan = { from: string; to: string; legs: Leg[] }

// 다익스트라. 주어진 시작 노드들에서 도착 이름의 아무 노선 노드에 닿는다.
// ponytail: 배열을 정렬해 최소값을 꺼낸다. 노드가 700개대라 힙이 필요 없다.
function search(starts: [string, number][], to: string, from: string, banned?: Set<string>): Plan | null {
  const goals = new Set(nodesOf(to))
  if (!starts.length || !goals.size) return null

  const dist = new Map<string, number>()
  const prev = new Map<string, string | null>()
  const queue: [number, string][] = []
  for (const [s, d] of starts) {
    dist.set(s, d)
    prev.set(s, null)
    queue.push([d, s])
  }

  let end: string | null = null
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0])
    const [d, cur] = queue.shift()!
    if (d > (dist.get(cur) ?? Infinity)) continue
    if (goals.has(cur)) { end = cur; break }
    for (const e of neighbors(cur)) {
      if (banned?.has(e.to)) continue
      const next = d + e.w
      if (next < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, next)
        prev.set(e.to, cur)
        queue.push([next, e.to])
      }
    }
  }
  if (!end) return null

  const nodes: string[] = []
  for (let c: string | null | undefined = end; c; c = prev.get(c)) nodes.push(c)
  nodes.reverse()

  const legs: Leg[] = []
  for (const n of nodes) {
    const bar = n.indexOf('|')
    const [line, name] = [n.slice(0, bar), n.slice(bar + 1)]
    const last = legs[legs.length - 1]
    // 환승역은 노드 두 개로 온다(2호선|을지로3가 다음에 3호선|을지로3가).
    // 그래서 앞 구간은 이미 환승역으로 끝난다. 여기서 다시 넣으면 안 된다.
    if (last && last.line === line) last.stops.push(name)
    else legs.push({ line, stops: [name] })
  }
  // 환승역 하나만 남은 꼬리 구간은 버린다 (도착지가 환승역일 때 생긴다)
  const kept = legs.filter(l => l.stops.length > 1)
  return kept.length ? { from, to, legs: kept } : null
}

export function plan(from: string, to: string): Plan | null {
  if (from === to) return null
  return search(nodesOf(from).map(n => [n, 0] as [string, number]), to, from)
}

// 첫 한 정거장을 지정해 떠나는 경로. 선택지의 단위는 노선이 아니라 (노선, 방면)이다.
// 노선만 지정하면 양쪽 방향이 한 후보로 뭉개져 빠른 쪽만 남는다.
// 하계에는 7호선 하나뿐인데 중계 방면과 공릉 방면은 전혀 다른 여정이다.
export function planHop(from: string, to: string, line: string, next: string): Plan | null {
  if (from === to) return null
  const hop = `${line}|${next}`
  const ok = neighbors(`${line}|${from}`).some(e => e.w === 1 && e.to === hop)
  if (!ok) return null
  // 바로 옆 역이 목적지면 한 구간으로 끝난다
  if (nodesOf(to).includes(hop)) return { from, to, legs: [{ line, stops: [from, to] }] }
  // 출발역으로 되돌아가지 못하게 탐색 단계에서 막는다.
  // 사후에 버리면 진짜 그 방향 경로를 함께 잃는다.
  // 하계에서 공릉 방면을 고르면 다익스트라는 하계로 되돌아 4호선 타는 길이 짧다고 본다.
  const p = search([[hop, 1]], to, from, new Set(nodesOf(from)))
  if (!p || p.legs[0].line !== line || p.legs[0].stops[0] !== next) return null
  p.legs[0].stops.unshift(from)
  return p
}

// 출발역에서 갈 수 있는 모든 (노선, 방면). 화면의 선택지를 만들 때 쓴다.
export function departures(from: string): { line: string; next: string }[] {
  const out: { line: string; next: string }[] = []
  for (const node of nodesOf(from)) {
    const line = node.slice(0, node.indexOf('|'))
    for (const e of neighbors(node)) {
      if (e.w !== 1 || !e.to.startsWith(`${line}|`)) continue
      out.push({ line, next: e.to.slice(e.to.indexOf('|') + 1) })
    }
  }
  return out
}

export function stopsLeft(stops: string[], current: string): number {
  const i = stops.indexOf(current)
  return i < 0 ? -1 : stops.length - 1 - i
}

export type Fix = { station: string; at: number }   // at = epoch ms

// 관측이 부족할 때 쓴다. 수도권 평균 역간 소요시간이 대략 2분이다.
export const DEFAULT_PACE_MS = 120_000
// 마지막 관측이 이만큼 오래되면 추정을 멈춘다. 추정이 길수록 틀릴 확률이 커진다.
export const STALE_MS = 180_000

// 이 열차 자신이 실제로 낸 속도를 쓴다. 정적 소요시간표를 쓰지 않는다.
export function paceMs(stops: string[], fixes: Fix[]): number {
  const seen = fixes.filter(f => stops.includes(f.station))
  // polling이 10초마다 같은 역을 볼 수 있다. 연속 중복을 하나로 묶는다.
  const uniq = seen.filter((f, i) => i === 0 || f.station !== seen[i - 1].station)
  if (uniq.length < 2) return DEFAULT_PACE_MS
  const first = uniq[0]
  const last = uniq[uniq.length - 1]
  const n = Math.abs(stops.indexOf(last.station) - stops.indexOf(first.station))
  if (n < 1) return DEFAULT_PACE_MS
  return Math.round((last.at - first.at) / n)
}

export type Guess = { index: number; estimated: number; stale: boolean }

// 마지막 관측 이후 흐른 시간을 관측 속도로 나눠 위치를 앞으로 민다.
export function locate(stops: string[], fixes: Fix[], now: number): Guess | null {
  const last = [...fixes].reverse().find(f => stops.includes(f.station))
  if (!last) return null
  const base = stops.indexOf(last.station)
  const elapsed = now - last.at
  const pushed = Math.floor(Math.max(0, elapsed) / paceMs(stops, fixes))
  const index = Math.min(base + pushed, stops.length - 1)
  return { index, estimated: index - base, stale: elapsed > STALE_MS }
}

// ---------- 경로 이탈 판정 ----------

// 화면과 같은 잣대. 정거장 2분, 환승 4분.
export const tripMinutesOf = (p: Plan): number =>
  p.legs.reduce((n, l) => n + l.stops.length - 1, 0) * 2 + (p.legs.length - 1) * 4
// 이만큼 안에 들면 굳이 내리지 않는다. 2호선을 반대로 돌아도 한두 정거장 차이면 그냥 간다.
const STAY_SLACK_MIN = 6

export type Deviation =
  | { kind: 'on' }
  | { kind: 'continue'; plan: Plan }
  | { kind: 'getOff'; at: string; plan: Plan | null; reason: 'wrongWay' | 'missed' | 'diverted' }
  | { kind: 'unknown' }

// 타고 있는 열차가 현재 구간을 벗어났을 때 어떻게 할지 정한다.
//   seen   지금 관측된 역
//   prev   직전에 관측된 역(진행 방향을 잡는 데 쓴다). 모르면 null
//   status 0 진입, 1 도착, 2 출발. 역에 서 있으면 여기서 내릴 수 있다
//   dest   여정의 최종 목적지
export function deviation(leg: Leg, seen: string, prev: string | null, status: number, dest: string): Deviation {
  if (leg.stops.includes(seen)) return { kind: 'on' }
  const here = `${leg.line}|${seen}`
  if (!stationAt(here)) return { kind: 'unknown' }
  if (seen === dest) return { kind: 'getOff', at: seen, plan: null, reason: 'diverted' }

  // 진행 방향. seen의 같은 노선 이웃 중 '뒤'가 아닌 쪽이 앞이다.
  // 뒤 = 직전 관측 역이 이웃이면 그것, 아니면(폴링이 역을 건너뛴 경우) 경로 안에 있는 이웃.
  const around = neighbors(here)
    .filter(e => e.w === 1 && e.to.startsWith(`${leg.line}|`))
    .map(e => e.to.slice(e.to.indexOf('|') + 1))
  const behind = prev && around.includes(prev) ? prev : (around.find(n => leg.stops.includes(n)) ?? null)
  const ahead = behind ? around.filter(n => n !== behind) : around
  const forward = ahead.length === 1 ? ahead[0] : null   // 분기점이나 방향 미상이면 모른다

  // 사유. missed: 하차역 바로 다음 역이 관측됐고 직전 관측이 경로 안(폴링이 하차역을 건너뛰어도 잡힌다).
  // diverted: 다른 지선으로 갔다(출발역이 분기점이어도). wrongWay: 같은 지선에서 출발역 반대쪽.
  const last = leg.stops[leg.stops.length - 1]
  const branchOf = (name: string) => stationAt(`${leg.line}|${name}`)?.branch
  const onPath = prev != null && leg.stops.includes(prev)
  const sameBranch = prev != null && branchOf(prev) === branchOf(seen)
  const reason = around.includes(last) && onPath ? 'missed'
    : !sameBranch ? 'diverted'
    : prev === leg.stops[0] ? 'wrongWay' : 'diverted'

  // 이 열차를 계속 타도 되는가: 앞 역으로 떠나는 경로가 여기서의 최선과 비슷하면 그냥 간다.
  if (forward) {
    const stay = planHop(seen, dest, leg.line, forward)
    const best = plan(seen, dest)
    if (stay && best && tripMinutesOf(stay) <= tripMinutesOf(best) + STAY_SLACK_MIN) {
      return { kind: 'continue', plan: stay }
    }
  }
  // 내려야 한다. 역에 서 있으면(진입·도착) 여기서, 이미 떠났으면 다음 역에서.
  const at = status <= 1 || !forward ? seen : forward
  return { kind: 'getOff', at, plan: at === dest ? null : plan(at, dest), reason }
}
