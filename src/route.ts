import { neighbors, nodesOf, stationAt, node } from './stations.ts'

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

// 한 노선만 타고 from에서 닿는 모든 역과 그 사이 역 목록(너비 우선, 같은 노선 간선만). 순환선은 짧은 쪽이 나온다.
function reachOn(line: string, from: string): Map<string, string[]> {
  const out = new Map<string, string[]>([[from, [from]]])
  const queue = [from]
  while (queue.length) {
    const cur = queue.shift()!
    for (const e of neighbors(node(line, cur))) {
      const st = stationAt(e.to)
      if (e.w !== 1 || !st || st.line !== line || out.has(st.name)) continue
      out.set(st.name, [...out.get(cur)!, st.name])
      queue.push(st.name)
    }
  }
  return out
}

// 환승 2번까지의 경로를 모두 찾는다. 선택지에 '환승역이 다른 길'을 내놓기 위해서다.
// 방면별 최선 하나만 보였더니, 사용자가 실제로 타는 길(하계→태릉입구 6호선→신당 2호선→홍대입구)이 선택지에 없었다(10-01).
// 같은 노선 순서·같은 환승역이면 하나로 친다. 정렬과 가지치기는 부르는 쪽이 한다.
export function alternatives(from: string, to: string): Plan[] {
  if (from === to) return []
  const cache = new Map<string, Map<string, string[]>>()
  const reach = (line: string, st: string) => {
    const k = node(line, st)
    if (!cache.has(k)) cache.set(k, reachOn(line, st))
    return cache.get(k)!
  }
  // 그 노선 승강장에서 갈아탈 수 있는 (노선, 역). 역 이름이 다른 환승(지상 연결)도 그래프에 있으면 따른다.
  const xfers = (line: string, st: string) => neighbors(node(line, st)).filter(e => e.w !== 1)
    .map(e => stationAt(e.to)).filter((x): x is NonNullable<typeof x> => !!x && x.line !== line)
  const best = new Map<string, Plan>()
  const size = (p: Plan) => p.legs.reduce((n, l) => n + l.stops.length - 1, 0)
  const add = (legs: Leg[]) => {
    if (legs.some(l => l.stops.length < 2)) return
    const p = { from, to, legs }
    const key = legs.map(l => `${l.line}@${l.stops[0]}`).join('>')
    const old = best.get(key)
    if (!old || size(p) < size(old)) best.set(key, p)
  }
  for (const n0 of nodesOf(from)) {
    const l1 = stationAt(n0)?.line
    if (!l1) continue
    const r1 = reach(l1, from)
    if (r1.has(to)) add([{ line: l1, stops: r1.get(to)! }])
    for (const [t1, s1] of r1) {
      if (t1 === from || s1.includes(to)) continue   // 도착지를 지나쳐 갈아타는 길은 내놓지 않는다
      for (const x2 of xfers(l1, t1)) {
        const r2 = reach(x2.line, x2.name)
        if (r2.has(to)) add([{ line: l1, stops: s1 }, { line: x2.line, stops: r2.get(to)! }])
        for (const [t2, s2] of r2) {
          if (t2 === x2.name || t2 === from || s2.includes(to)) continue
          for (const x3 of xfers(x2.line, t2)) {
            if (x3.line === l1) continue   // 탔던 노선으로 되돌아가는 길은 내놓지 않는다
            const r3 = reach(x3.line, x3.name)
            if (r3.has(to)) add([{ line: l1, stops: s1 }, { line: x2.line, stops: s2 }, { line: x3.line, stops: r3.get(to)! }])
          }
        }
      }
    }
  }
  return [...best.values()]
}

// 주행 중에 여정을 나와, 타던 구간 위의 역(at)에서 같은 도착지로 다시 고른 경우에 실제로 탄 길.
// 옛 여정의 지나온 부분에 새 여정을 잇는다. 이을 수 없으면 null.
// 10-01·10-02: 사용자는 ★(상봉·왕십리)를 고르고 태릉입구에서 나와 6호선으로 다시 골랐다. ★가 실제로 타는 길이 아니었다.
export function continued(old: Plan, legIndex: number, at: string, next: Plan): Plan | null {
  const cur = old.legs[legIndex]
  const cut = cur ? cur.stops.indexOf(at) : -1
  if (cut < 1 || old.to !== next.to || next.from !== at) return null
  const part = { line: cur.line, stops: cur.stops.slice(0, cut + 1) }
  const head = old.legs.slice(0, legIndex)
  // 같은 노선으로 계속 가면 한 구간으로 합친다
  const legs = next.legs[0].line === part.line
    ? [...head, { line: part.line, stops: [...part.stops, ...next.legs[0].stops.slice(1)] }, ...next.legs.slice(1)]
    : [...head, part, ...next.legs]
  return { from: old.from, to: old.to, legs }
}

// 화면에 내놓을 길. 가장 빠른 길(다익스트라), 방면별 가장 빠른 길, 환승역이 다른 길을 모은다.
// key: 같은 길인지 가르는 값. minutes: 걸리는 시간. liked: 지난번에 고른 길의 key(맨 위에 두고, 가지치기에서 빼지 않는다).
export function routeChoices(from: string, to: string, o: { key: (p: Plan) => string; minutes: (p: Plan) => number; liked?: string; max?: number }): Plan[] {
  // 최선 경로를 먼저 넣는다. 방면별 탐색만 돌리면 최선이 빠지는 경우가 있다.
  // 실측: 1637개 경로 중 10건에서 가장 빠른 길이 선택지에 없었다.
  const best = plan(from, to)
  if (!best) return []
  const seen = new Set([o.key(best)])
  const out = [best]
  // 선택지의 단위는 노선이 아니라 (노선, 방면)이다. 노선만 보면 양쪽 방향이 한 후보로 뭉개져 빠른 쪽만 남는다.
  // 하계에는 7호선뿐이지만 중계 방면과 공릉 방면은 전혀 다른 여정이다.
  for (const d of departures(from)) {
    const p = planHop(from, to, d.line, d.next)
    if (!p || seen.has(o.key(p))) continue
    seen.add(o.key(p))
    out.push(p)
  }
  // 아무도 고르지 않을 선택지는 뺀다. 환승 3~4번짜리를 내밀면 목록이 쓸모없어진다.
  // 실측으로 정한 경계다(쓸모없는 선택지 131건 → 46건, 최선은 하나도 잃지 않음).
  const legCap = best.legs.length + 1
  // 짧은 구간에서는 '15분 더'가 너무 후하다. 2분짜리 직통에 14·16분짜리 우회가 붙었다(10-02 공덕→홍대입구).
  // 가장 빠른 길의 1.5배(적어도 6분 더)까지, 그래도 15분은 넘지 않게.
  const cap = (base: number, most: number) => Math.min(base + most, Math.max(base * 1.5, base + 6))
  const kept = out.filter((p, i) => i === 0 || (p.legs.length <= legCap && o.minutes(p) <= cap(o.minutes(best), 15)))
  // 환승역이 다른 길도 내놓는다. 방면별 최선만 보였더니 사용자가 실제로 타는 길이 선택지에 없었다
  // (10-01: 하계→홍대입구에 '태릉입구 6호선 → 신당 2호선'이 없었다). 가장 빠른 길보다 10분 안쪽까지.
  const fastest = Math.min(...kept.map(p => o.minutes(p)))
  for (const p of alternatives(from, to).sort((a, b) => o.minutes(a) - o.minutes(b))) {
    const k = o.key(p)
    if (seen.has(k)) continue
    if (k !== o.liked && (o.minutes(p) > cap(fastest, 10) || p.legs.length > legCap)) continue
    seen.add(k)
    kept.push(p)
  }
  // 빠른 것부터, 같으면 환승이 적은 것부터
  kept.sort((a, b) => o.minutes(a) - o.minutes(b) || a.legs.length - b.legs.length)
  // 지난번에 고른 길이 있으면 맨 위로 올린다. 바꾸고 싶으면 아래를 고르면 된다.
  const i = o.liked ? kept.findIndex(p => o.key(p) === o.liked) : -1
  if (i > 0) kept.unshift(...kept.splice(i, 1))
  // 안경 목록에서 스크롤은 비싸다. 여섯 개까지만(지난번에 고른 길은 맨 위라 늘 남는다)
  return kept.slice(0, o.max ?? 6)
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

// 고른 열차가 고르기 전에 이미 출발역을 떠났는가. 떠났으면 사용자는 그 열차에 타고 있지 않다.
// 10-01 출근: 도착 정보가 3~4분 묵어서 앞서 간 열차를 태웠고, 전 구간이 실제보다 앞서 나갔다.
// obs는 탑승 뒤 그 열차를 경로 위에서 처음 본 기록. 출발역을 떠난 때를 어림한다(다음 역들에 있으면 역당 60초, 도착이면 +15초).
// 떠난 지 60초 안이면 '타자마자 고른 것'일 수 있어 그대로 둔다(출발 뒤 2분 탭 복구가 맡는다).
export function leftBefore(stops: string[], obs: { station: string; status: number; at: number }, pickedAt: number): boolean {
  const i = stops.indexOf(obs.station)
  if (i < 0 || (i === 0 && obs.status !== 2)) return false
  const left = i === 0 ? obs.at : obs.at - i * 60_000 - (obs.status >= 1 ? 15_000 : 0)
  return left <= pickedAt - 60_000
}

export function stopsLeft(stops: string[], current: string): number {
  const i = stops.indexOf(current)
  return i < 0 ? -1 : stops.length - 1 - i
}

// at: 그 역에서 마지막 사건(진입·도착·출발)이 난 시각(피드의 recptnDt). seen: 그 상태를 마지막으로 다시 확인한 시각(폴링 시각).
// at: 그 역의 마지막 상태(진입→도착→출발)가 바뀐 사건 시각. arr: 그 역을 처음 본 사건 시각(바뀌지 않는다).
// first: 그 역을 처음 봤을 때의 상태(0 진입, 1 도착, 2 출발). stop: 그 역에 선(도착) 사건 시각. 달린 시간·정차 시간을 재는 데 쓴다.
export type Fix = { station: string; at: number; seen?: number; status?: number; arr?: number; first?: number; stop?: number }   // epoch ms
// 그 역에 선 때. 도착 기록을 봤으면 그 시각, 진입만 봤으면 곧(15초 뒤) 선 것으로 본다. 출발부터 봤으면 모른다.
const ENTER_MS = 15_000
const stoppedAt = (f: Fix): number | null =>
  f.stop ?? (f.status === 1 ? f.at : f.first === 2 ? null : f.first === 0 || f.status === 0 ? (f.arr ?? f.at) + ENTER_MS : (f.arr ?? f.at))

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
  // 서울 지하철 역간은 1~3분이다. 급행이 역을 건너뛰어도 한 역에 40초 밑으로는 안 내려간다.
  // 관측이 몇 역을 건너뛴 채 짧은 간격으로 들어오면 3초/역 같은 값이 나와 도착을 앞당겼다(09-29 시뮬레이터).
  // 역에 닿은 시각(arr)끼리 잰다. at은 마지막 상태(출발) 시각이라 정차가 섞여 속도가 부풀었다(09-30 퇴근: 149~166초/역).
  const t = (f: Fix) => f.arr ?? f.at
  return Math.min(MAX_PACE_MS, Math.max(MIN_PACE_MS, Math.round((t(last) - t(first)) / n)))
}

// 출발에서 다음 역에 닿기까지(달리는 시간). 이 열차가 이번 주행에서 낸 값의 중앙값을 쓴다.
// 09-30 퇴근(7호선 강남구청→하계): 출발→다음 역 진입 24~90초(중앙값 약 35초), 도착까지 39~109초.
export const TRAVEL_MS = 45_000
export function travelMs(stops: string[], fixes: Fix[]): number {
  const on = fixes.filter(f => stops.includes(f.station))
  const hops: number[] = []
  for (let i = 1; i < on.length; i++) {
    const a = on[i - 1], b = on[i]
    // 다음 역에 선 때까지. '출발'로 처음 본 역은 선 때를 모르니 뺀다.
    const stop = stoppedAt(b)
    if (a.station !== b.station && a.status === 2 && stop != null && stop > a.at) hops.push(stop - a.at)
  }
  if (!hops.length) return TRAVEL_MS
  return Math.min(120_000, Math.max(25_000, median(hops)))
}
const median = (xs: number[]): number => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]

// 역에 서 있는 시간(닿음→출발). 이 열차의 이번 주행 중앙값. 닿는 것을 못 보고 '출발'부터 본 역은 뺀다.
// 실측: 09-30 출근 7호선 약 60초, 퇴근 61~94초, 10-01 출근 6호선 64~72초.
export function dwellMs(stops: string[], fixes: Fix[]): number {
  const d = fixes.filter(f => stops.includes(f.station) && f.status === 2 && stoppedAt({ ...f, status: undefined }) != null)
    .map(f => f.at - stoppedAt({ ...f, status: undefined })!).filter(x => x > 0)
  return d.length ? Math.min(120_000, Math.max(20_000, median(d))) : DWELL_MS
}
export const MIN_PACE_MS = 40_000
export const MAX_PACE_MS = 300_000

export type Guess = { index: number; estimated: number; stale: boolean }

// 이만큼 안에 다시 확인한 관측은 지금 위치로 믿고 밀지 않는다. 폴링(15초)이 한두 번 비어도 버틴다.
export const FRESH_MS = 45_000

// 도착해서 떠날 때까지 서 있는 시간. 역당 시간(pace)의 나머지가 달리는 시간이다.
// 09-30 출근 실측(7호선 중계, 두 열차): 정차 약 60초, 출발→다음 역 도착 55~65초, 역당 약 115초. 한산할 때를 생각해 50초로 둔다.
export const DWELL_MS = 50_000
// 대기 화면: 열차가 n정거장 앞 역에서 이 상태로 관측됐을 때 출발역 도착까지. 역당 시간(도착→다음 역 도착)은 HOP_MS다.
export const HOP_MS = 110_000
export function approachEta(at: number, status: number, n: number, atOrigin: boolean): number {
  // 0 진입: 곧 멈춘다(+20초). 1 도착: 역당 시간 그대로. 2 출발: 정차를 이미 마쳤다(-정차).
  // 3 전역출발: 앞 역을 막 떠났다(+달리는 시간). 출발역의 전역출발은 달리는 시간만 남았다.
  if (status === 3) return atOrigin ? at + (HOP_MS - DWELL_MS) : at + n * HOP_MS + (HOP_MS - DWELL_MS)
  return at + n * HOP_MS + (status === 0 ? 20_000 : status === 2 ? -DWELL_MS : 0)
}

// 열차 고르기: 후보 열차가 출발역에 닿기까지 남은 초를 위치 피드로 센다. 이미 떠났으면 'gone', 알 수 없으면 null.
// 도착 API의 남은 초는 몇 분씩 틀린다(10-02 태릉입구 6098: '228초 뒤'라고 했는데 5초 전에 이미 도착해 있었다).
// 공항철도·경의중앙선은 아예 주지 않는다. 위치 피드의 사건 시각으로 세는 편이 맞다.
export function etaFromPosition(line: string, stops: string[], pos: { station: string; status: number; at: number }, now: number): number | 'gone' | null {
  const i = stops.indexOf(pos.station)
  if (i >= 1) return 'gone'                                   // 이미 다음 역들에 있다
  if (i === 0) {
    if (pos.status === 2) return 'gone'                       // 출발역을 떠났다
    if (pos.status === 3) return Math.round((approachEta(pos.at, 3, 0, true) - now) / 1000)
    // 승강장에 들어왔거나 서 있다. 2분이 넘었으면 떠났다고 본다(피드가 늦다)
    return now - pos.at > 120_000 ? 'gone' : 0
  }
  const n = hops(line, pos.station, stops[0], 60)
  if (n < 1) return null
  // 계산상 이미 왔어야 하는 열차는 곧 도착으로 둔다(피드가 늦을 뿐이다). 정말 떠났으면 탑승 뒤 검증이 바꾼다.
  return Math.max(-30, Math.round((approachEta(pos.at, pos.status, n, false) - now) / 1000))
}

const lastOn = (stops: string[], fixes: Fix[]) => [...fixes].reverse().find(f => stops.includes(f.station))

// 서울 피드는 '실시간'이지만 실제보다 늦다. 사건 시각에서 앱이 그 기록을 보기까지 09-30에는 16~59초(평균 38초),
// 10-01 출근에는 65~98초였다. 화면이 본 기록을 그대로 '지금'으로 보이면 늘 한 역쯤 뒤처진다(실사용 지적).
// 그래서 기록의 사건 시각을 기준으로 '지금쯤 어디일지'를 센다: 역에 선 때 + 정차 + 달리는 시간 = 다음 역.
// 정차·달리는 시간·역당 시간은 이 열차가 이번 주행에서 낸 값이고, 지연(lagMs)은 앱이 직접 잰 값이다.
export const LAG_MS = 40_000     // 잰 값이 없을 때의 피드 지연
const SLACK_MS = 20_000
// 역에 선 때, 떠날(떠난) 때, 다음 역에 닿을 때
function timeline(stops: string[], fixes: Fix[], last: Fix) {
  const pace = paceMs(stops, fixes), run = travelMs(stops, fixes)
  // next는 다음 역에 '들어서는' 때다(서는 때보다 15초 앞). 늦게 넘기면 '도착했는데 이전 역'이 되고,
  // 조금 일찍 넘기는 것은 해롭지 않다(09-30 기록: 역마다 13~20초 늦게 넘어갔다).
  const enter = Math.max(run - ENTER_MS, 15_000)
  if (last.status === 2) return { stopAt: last.at, dep: last.at, next: last.at + enter, pace }
  const stopAt = stoppedAt(last) ?? last.at
  const dep = stopAt + dwellMs(stops, fixes)
  return { stopAt, dep, next: dep + enter, pace }
}
// 떠났어야 할 때가 한참 지났는데 피드에 다음 역이 안 보인다. 열차가 서 있는 것이다(지연). 앞으로 밀지 않는다.
// 다음 역 도착 기록은 '역에 선 때 + 역당 시간 + 피드 지연' 무렵이면 보여야 한다.
// 지연은 방금 잰 값보다 클 수 있다(10-01: 43초로 재던 중에 실제는 94초였다). 넉넉히 기다린 뒤에만 '서 있다'고 본다.
const held = (last: Fix, t: { stopAt: number; next: number; pace: number }, now: number, lagMs: number): boolean =>
  last.status !== 2 && now > Math.max(t.next, t.stopAt + t.pace) + Math.max(lagMs, 60_000) * 1.5 + SLACK_MS

export function locate(stops: string[], fixes: Fix[], now: number, lagMs = LAG_MS): Guess | null {
  const last = lastOn(stops, fixes)
  if (!last) return null
  const base = stops.indexOf(last.station)
  const seen = last.seen ?? last.at
  // 신호 끊김은 확인이 끊긴 때부터 센다. 조회는 되는데 열차가 서 있는 것을 끊김으로 부르지 않는다.
  const stale = now - seen > STALE_MS
  const fresh = now - seen < FRESH_MS
  const t = timeline(stops, fixes, last)
  let pushed = 0
  if (fresh) {
    // 피드가 살아 있다. 다음 역에 닿을 때가 됐으면 한 역 앞선다(피드가 따라오기 전까지). 한 역까지만.
    if (now >= t.next && !held(last, t, now, lagMs)) pushed = 1
  } else {
    // 조회가 끊겼다. 마지막으로 확인한 때까지는 떠나지 않았다고 보고(지연 감안) 시각으로 계속 민다.
    const next = last.status === 2 ? t.next : Math.max(t.dep, seen - lagMs) + (t.next - t.dep)
    if (now >= next) pushed = 1 + Math.floor((now - next) / t.pace)
  }
  // 추정은 하차역 바로 앞까지만 민다. 하차역(환승역) 도착은 관측으로만 선언한다.
  // 추정으로 도착을 선언하면 폴링이 멈추거나, 열차가 앞 역에 있는데 환승 화면이 떴다.
  const cap = base >= stops.length - 1 ? base : stops.length - 2
  const index = Math.min(base + pushed, cap)
  return { index, estimated: index - base, stale }
}

// 이번 구간 끝(하차·환승역) 도착 예정 시각. 마지막 기록의 사건 시각에 고정한다.
// 현재시각에 남은 역×속도를 더하면 추정 칸이 넘어갈 때마다 최대 한 역 간격만큼 톱니처럼 흔들렸다(리뷰 1라운드).
export function legEta(stops: string[], fixes: Fix[], now: number, lagMs = LAG_MS): number {
  const last = lastOn(stops, fixes)
  if (!last) return now + (stops.length - 1) * paceMs(stops, fixes)
  const left = stops.length - 1 - stops.indexOf(last.station)
  if (left <= 0) return last.arr ?? last.at
  const t = timeline(stops, fixes, last)
  // 서 있는 열차(지연)는 피드가 본 때까지 다음 역에 닿지 않았다. 그때부터 센다
  const next = held(last, t, now, lagMs) ? Math.max(t.next, now - lagMs) : t.next
  return next + (left - 1) * t.pace
}

// 같은 노선 위 두 역 사이 정거장 수. 대기 화면의 '1정거장 전'에 쓴다. 모르면 -1.
export function hops(line: string, from: string, to: string, limit = 20): number {
  const start = node(line, from), goal = node(line, to)
  const dist = new Map([[start, 0]])
  const queue = [start]
  while (queue.length) {
    const cur = queue.shift()!
    const d = dist.get(cur)!
    if (cur === goal) return d
    if (d >= limit) continue
    for (const e of neighbors(cur)) {
      if (stationAt(e.to)?.line !== line || dist.has(e.to)) continue
      dist.set(e.to, d + 1)
      queue.push(e.to)
    }
  }
  return -1
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

// 이 열차가 하차역까지 가는가. 행선지(dest)가 하차역 앞에서 끝나거나 다른 지선이면 아니다(리뷰 3라운드:
// 신도림에서 인천 쪽으로 가는데 천안행을, 천호에서 마천 쪽으로 가는데 하남검단산행을 자동으로 태울 수 있었다).
// 모르는 이름이면 막지 않는다. 순환선(2호선)과 응암 루프(6호선)는 최단 거리로 방향을 가를 수 없어 행선지만 본다.
export function reaches(line: string, stops: string[], dest: string): boolean {
  const o = stops[0], x = stops[stops.length - 1]
  if (!dest || dest === x) return true
  if (stops.includes(dest)) return false   // 경로 위, 하차역 앞에서 끝난다
  if (line === '2호선' || line === '6호선') return true
  const od = hops(line, o, dest, 200), ox = hops(line, o, x, 200), xd = hops(line, x, dest, 200)
  return od < 0 || ox < 0 || xd < 0 || ox + xd === od
}
