# 서울 지하철 G2 플러그인 구현 계획 (2차)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** G2 글래스에서 GPS로 출발역을 잡고, 저장한 도착지를 고르면, 탈 열차를 알려주고, 탑승 뒤 환승과 하차를 안내한다.

**Architecture:** Vite 웹앱이 Even Hub WebView에서 돈다. 서울 실시간 API는 Cloudflare Worker가 중계한다(http 전용 + 키 보관 문제를 동시에 푼다). 경로 계산, 거리 계산, 화면 문자열 생성은 순수 함수로 분리해 `node --test`로 검증한다. G2 SDK 호출은 `main.ts` 한 곳에 모은다.

**Tech Stack:** TypeScript, Vite 5, `@evenrealities/even_hub_sdk`, Cloudflare Workers, `node --test` (프레임워크 없음)

**Spec:** `docs/superpowers/specs/2026-09-20-seoul-metro-g2-design.md`

## 진행 상황

- Task 1 (프로젝트 뼈대): **완료**
- Task 2 (역 데이터 + 좌표 + 노선 ID + 별칭): **완료**
- `.env.local`에 `SEOUL_KEY`와 `SEOUL_RT_KEY` 모두 설정됨.
- 워커 도메인은 기본값(`*.workers.dev`)을 쓴다. 커스텀 도메인을 붙이지 않는다.

### 실측으로 확정된 사실 (Task 3 이후가 이것에 의존한다)

- `updnLine`은 **읽지 않는다.** 두 API의 표기가 다르고 2호선·9호선은 극성이 반대다.
  방향은 `trainLineNm`의 `"…방면"` 역이 `Leg.stops[1]`과 같은지로 정한다. 201건 중 201건이 파싱됐다.
- 노선명 별칭: `경의선 → 경의중앙선`, `우이신설경전철 → 우이신설선`. `fetch-stations.mjs`가 처리한다.
- **실시간 미지원 노선 5개**: 김포도시철도, 용인경전철, 의정부경전철, 인천선, 인천2호선.
  역 100개다. 그래프에서 제외한다. 안 그러면 경로가 추적 불가 구간을 지난다.
- 노선 ID 19개를 받았다. 역 699/799개가 추적 가능하다.

## Global Constraints

- 참고 구현은 `../tiro`다. 같은 SDK 패턴을 쓴다. 새로 발명하지 않는다.
- G2 바이트 한도 (tiro 실기기 실측, 한글 1자 = 3바이트):
  - `rebuildPageContainer` 페이지 전체: **950 UTF-8 바이트**
  - 목록 항목 1개: **62 바이트** / 목록 항목 수: **20개**
  - `textContainerUpgrade`: 약 2,000 바이트
- 화면은 576 x 288이다. 페이지당 비이미지 컨테이너는 8개까지다.
- `isEventCapture: 1`인 컨테이너가 페이지당 **정확히 1개** 있어야 한다.
- `CLICK_EVENT`는 값이 0이라 protobuf가 생략한다. `eventType`이 `undefined`면 클릭이다.
- 목록 첫 항목 클릭 시 하드웨어가 `currentSelectItemIndex`를 생략한다. `?? 0`을 쓴다.
- 루트 화면(`ORIGIN`)의 더블탭은 반드시 `bridge.shutDownPageContainer(1)`이다.
- `rebuildPageContainer`와 `textContainerUpgrade`의 반환값을 **항상 확인한다.**
- **모든 실패 화면에 탭 복구 경로를 둔다.** 예외는 없다.
- 저장은 `bridge.setLocalStorage`다. 브라우저 `localStorage`는 `.ehpk` 재시작 시 지워진다.
- 개발 로그는 `navigator.sendBeacon('/__log', msg)`이며 `import.meta.env.DEV`일 때만 보낸다.
- 키는 `.env.local`과 Worker secret에만 둔다. 소스, 커밋, 로그에 넣지 않는다.
- 쓰지 않는 import는 `noUnusedLocals` 때문에 빌드를 깬다. Task마다 그 Task가 쓰는 것만 가져온다.
- 커밋 메시지는 한국어로 쓴다. 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`를 넣는다.

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `scripts/fetch-stations.mjs` | 역 + 지선 + 좌표 + 노선 ID 수집 | 2 |
| `src/stations.json` | 정적 데이터 | 2 |
| `src/stations.ts` | 인접 그래프, 좌표, 환승, subwayId → 노선명 | 3 |
| `src/route.ts` | 다익스트라 경로, 방향, 남은 정거장, 속도, 추정 | 4, 5 |
| `src/geo.ts` | 하버사인 거리, 가까운 역 | 6 |
| `src/screen.ts` | 화면 문자열, 바이트 한도 | 7 |
| `worker/index.js`, `worker/wrangler.toml` | 프록시 | 8 |
| `src/api.ts` | 워커 호출, 응답 정규화 | 9 |
| `index.html` | 폰 설정 화면 (도착지) | 10 |
| `src/main.ts` | 상태 기계, SDK | 10~13 |
| `app.json` | 매니페스트 | 14 |

Task 3~7은 실시간 키 없이 진행할 수 있다. Task 8과 그 뒤는 키가 필요하다.

---

### Task 2: 역 데이터에 좌표를 더한다  *(완료)*

**Files:**
- Modify: `scripts/fetch-stations.mjs`
- Modify: `src/stations.json`

**Interfaces:**
- Produces: `src/stations.json`
```ts
{
  lines: { id: string; name: string }[]       // 실시간 키가 있을 때만 채워진다
  stations: { name, line, branch, order, fr }[]
  coords: { name: string; lat: number; lon: number }[]
}
```

- [ ] **Step 1: 좌표 수집을 스크립트에 넣는다**

`scripts/fetch-stations.mjs`에서 `writeFileSync` 바로 앞에 넣는다.

```js
// 좌표: subwayStationMaster (BLDN_NM, ROUTE, LAT, LOT). 784개역.
// 같은 역 이름은 노선이 달라도 위치가 사실상 같다. 이름당 한 건만 둔다.
const geo = await json(`http://openapi.seoul.go.kr:8088/${KEY}/json/subwayStationMaster/1/1000/`)
const geoRows = geo.subwayStationMaster?.row
if (!geoRows) throw new Error(JSON.stringify(geo).slice(0, 300))

const coordMap = new Map()
for (const r of geoRows) {
  const name = String(r.BLDN_NM).replace(/\(.*\)$/, '')
  const lat = Number(r.LAT)
  const lon = Number(r.LOT)
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
  if (!coordMap.has(name)) coordMap.set(name, { name, lat, lon })
}
const coords = [...coordMap.values()]

const known = new Set(stations.map(s => s.name))
const missing = [...known].filter(n => !coordMap.has(n))
console.log(`좌표 ${coords.length}건. 좌표 없는 역 ${missing.length}개: ${missing.join(' ')}`)
```

`writeFileSync` 줄을 바꾼다.
```js
writeFileSync('src/stations.json', JSON.stringify({ lines, stations, coords }))
```

- [ ] **Step 2: 실행**

Run: `npm run stations`
Expected:
```
좌표 784건. 좌표 없는 역 8개: 평택지제 자양 한국항공대 시우 용인중앙시장 4·19민주묘지 서해구청 운정중앙
역 799개, 노선 이름 24개, 노선 ID 0개를 저장했습니다.
```

`SEOUL_RT_KEY`가 비어 있으면 `노선 ID 0개`가 정상이다. Task 8에서 다시 돌린다.
좌표 없는 역이 20개를 넘으면 멈추고 사람에게 알린다. 이름 정규화가 깨진 것이다.

- [ ] **Step 3: 커밋**

```bash
git add scripts/fetch-stations.mjs src/stations.json
git commit -m "feat: 역 좌표를 정적 데이터에 더한다

subwayStationMaster의 LAT/LOT를 이름당 한 건씩 넣는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `stations.ts` — 인접 그래프

**Files:**
- Create: `src/stations.ts`, `src/stations.test.ts`

**Interfaces:**
- Consumes: `src/stations.json` (Task 2)
- Produces:
```ts
export type Station = { name: string; line: string; branch: string; order: number; fr: string }
export type Edge = { to: string; w: number }
export type Coord = { name: string; lat: number; lon: number }
export const TRANSFER_COST = 5
export const COORDS: readonly Coord[]        // 추적 가능한 역만
export function supported(line: string): boolean
export function node(line: string, name: string): string          // "2호선|강남"
export function neighbors(n: string): Edge[]                       // 없으면 []
export function nodesOf(name: string): string[]                    // 그 이름의 모든 노선 노드
export function stationAt(n: string): Station | undefined
export function lineStations(line: string): Station[]              // branch, order 순
export function transferLines(name: string): string[]
export function lineName(subwayId: string): string                 // 없으면 ''
```

간선 규칙은 spec §10.1의 다섯 가지다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/stations.test.ts`:
```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  node, neighbors, nodesOf, stationAt, lineStations, transferLines, lineName,
  supported, COORDS, TRANSFER_COST,
} from './stations.ts'

test('lineStations는 노선 역을 branch와 order 순으로 준다', () => {
  const two = lineStations('2호선')
  assert.ok(two.length > 40, `2호선 역이 ${two.length}개뿐입니다`)
  const main = two.filter(s => s.branch === '')
  for (let i = 1; i < main.length; i++) assert.ok(main[i].order > main[i - 1].order)
})

test('본선은 order가 이웃인 역끼리 이어진다', () => {
  const ns = neighbors(node('2호선', '강남')).map(e => e.to)
  assert.ok(ns.includes(node('2호선', '역삼')), ns.join(' '))
  assert.ok(ns.includes(node('2호선', '교대')), ns.join(' '))
})

test('순환선은 본선의 끝과 처음이 이어진다', () => {
  const main = lineStations('2호선').filter(s => s.branch === '')
  const first = main[0], last = main[main.length - 1]
  assert.ok(neighbors(node('2호선', last.name)).some(e => e.to === node('2호선', first.name)))
})

test('지선은 갈라지는 역에 붙는다', () => {
  // 성수지선 211-1 용답은 211 성수에 붙는다
  const ns = neighbors(node('2호선', '용답')).map(e => e.to)
  assert.ok(ns.includes(node('2호선', '성수')), ns.join(' '))
})

test('환승 간선은 같은 이름 다른 노선을 잇고 가중치가 다르다', () => {
  const e = neighbors(node('2호선', '교대')).find(x => x.to === node('3호선', '교대'))
  assert.ok(e, '2호선 교대와 3호선 교대가 이어져야 합니다')
  assert.equal(e.w, TRANSFER_COST)
  assert.ok(neighbors(node('2호선', '교대')).filter(x => x.w === 1).every(x => x.to.startsWith('2호선|')))
})

test('nodesOf와 stationAt', () => {
  assert.ok(nodesOf('강남').includes(node('2호선', '강남')))
  assert.deepEqual(nodesOf('없는역'), [])
  assert.equal(stationAt(node('2호선', '강남'))?.line, '2호선')
  assert.equal(stationAt('없는|노드'), undefined)
})

test('transferLines와 lineName', () => {
  assert.ok(transferLines('교대').includes('3호선'))
  assert.deepEqual(transferLines('없는역'), [])
  assert.equal(lineName('9999'), '')
})

test('실시간 미지원 노선은 그래프에 없다', () => {
  assert.equal(supported('2호선'), true)
  assert.equal(supported('인천선'), false)
  assert.deepEqual(nodesOf('국제업무지구'), [], '인천1호선 전용역은 그래프에 없어야 합니다')
  assert.equal(lineStations('인천선').length, 0)
})

test('좌표가 있고 고립된 역이 없다', () => {
  assert.ok(COORDS.length > 600, `좌표 ${COORDS.length}건`)
  const names = new Set(COORDS.map(c => c.name))
  assert.ok(names.has('강남'))
  for (const line of ['1호선', '2호선', '3호선']) {
    for (const s of lineStations(line)) {
      assert.ok(neighbors(node(line, s.name)).length > 0, `고립: ${line} ${s.name}`)
    }
  }
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './stations.ts'`

- [ ] **Step 3: 구현 작성**

`src/stations.ts`:
```ts
import data from './stations.json'

export type Station = { name: string; line: string; branch: string; order: number; fr: string }
export type Edge = { to: string; w: number }
export type Coord = { name: string; lat: number; lon: number }

// 환승 1회를 몇 정거장으로 칠지. 경로 결과를 바꾸는 조정 손잡이다.
export const TRANSFER_COST = 5
// 2호선은 순환한다. 본선의 끝과 처음을 잇는다.
const CIRCULAR = new Set(['2호선'])

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
export const COORDS = (data.coords as Coord[]).filter(c => LIVE_NAMES.has(c.name))

export const node = (line: string, name: string): string => `${line}|${name}`

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
  if (x === y) return
  adj.get(x)?.push({ to: y, w })
  adj.get(y)?.push({ to: x, w })
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

// 5) 같은 이름 다른 노선을 잇는다 (환승)
for (const g of byName.values()) {
  for (let i = 0; i < g.length; i++) {
    for (let j = i + 1; j < g.length; j++) link(g[i], g[j], TRANSFER_COST)
  }
}

export const neighbors = (n: string): Edge[] => adj.get(n) ?? []
export const nodesOf = (name: string): string[] => (byName.get(name) ?? []).map(s => node(s.line, s.name))
export const stationAt = (n: string): Station | undefined => byNode.get(n)
export const lineStations = (line: string): Station[] => byLine.get(line) ?? []
export const transferLines = (name: string): string[] => [...new Set((byName.get(name) ?? []).map(s => s.line))]
export const lineName = (subwayId: string): string => byId.get(subwayId) ?? ''
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 8개

실패하면 `src/stations.json`의 실제 값을 보고 테스트의 역 이름을 고친다.
구현을 비틀어 테스트를 맞추지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add src/stations.ts src/stations.test.ts
git commit -m "feat: 역 인접 그래프

간선 규칙 다섯으로 본선, 지선, 알파벳 분기, 순환, 환승을 모두 잇는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `route.ts` — 경로 탐색과 방향

**Files:**
- Create: `src/route.ts`, `src/route.test.ts`

**Interfaces:**
- Consumes: `neighbors`, `nodesOf`, `stationAt` (Task 3)
- Produces:
```ts
export type Leg = { line: string; stops: string[] }    // stops[0] 승차역, 마지막이 하차역
export type Plan = { from: string; to: string; legs: Leg[] }
export function plan(from: string, to: string): Plan | null
export function stopsLeft(stops: string[], current: string): number   // 모르면 -1
```

**`direction()`은 만들지 않는다.** 방향은 `Leg.stops[1]`과 도착 열차의 `"…방면"`을
비교해 정한다(spec §10.3). `updnLine`은 읽지 않는다. 노선마다 극성이 반대다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/route.test.ts`:
```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { plan, stopsLeft } from './route.ts'

const shape = (from: string, to: string) =>
  plan(from, to)?.legs.map(l => `${l.line}:${l.stops.length - 1}`).join(' ') ?? '실패'

test('plan은 환승 없는 경로를 한 구간으로 준다', () => {
  const p = plan('홍대입구', '강남')
  assert.equal(p?.legs.length, 1)
  assert.equal(p?.legs[0].line, '2호선')
  assert.equal(p?.legs[0].stops[0], '홍대입구')
  assert.equal(p?.legs[0].stops.at(-1), '강남')
  assert.equal(p?.legs[0].stops.length - 1, 17)
})

test('plan은 환승을 구간으로 나눈다', () => {
  const p = plan('잠실', '경복궁')
  assert.equal(p?.legs.length, 2)
  assert.equal(p?.legs[0].line, '2호선')
  assert.equal(p?.legs[1].line, '3호선')
  // 환승역은 앞 구간의 마지막이자 뒤 구간의 첫 역이다
  assert.equal(p?.legs[0].stops.at(-1), p?.legs[1].stops[0])
  assert.equal(p?.legs[0].stops.at(-1), '을지로3가')
})

test('plan은 순환선의 짧은 쪽으로 돈다', () => {
  assert.equal(shape('충정로', '시청'), '2호선:1')
  assert.equal(shape('강남', '신촌'), '2호선:18')
})

test('plan은 지선과 알파벳 분기를 건넌다', () => {
  assert.equal(shape('신도림', '까치산'), '2호선:4')
  assert.equal(shape('성수', '신설동'), '2호선:4')
  const far = plan('서울역', '수원')
  assert.ok(far, '서울역 → 수원 경로를 찾아야 합니다')
  assert.equal(far.legs.at(-1)!.stops.at(-1), '수원')
  assert.ok(far.legs[0].stops[0] === '서울역')
})

test('plan은 알 수 없는 역에 null을 준다', () => {
  assert.equal(plan('없는역', '강남'), null)
  assert.equal(plan('강남', '없는역'), null)
  assert.equal(plan('강남', '강남'), null)
})

test('stops[1]이 방향을 가른다', () => {
  // 방향 판정은 이 값 하나에 달려 있다(spec §10.3)
  assert.equal(plan('강남', '교대')!.legs[0].stops[1], '교대')
  assert.equal(plan('강남', '역삼')!.legs[0].stops[1], '역삼')
  assert.equal(plan('시청', '강남')!.legs[0].stops[1], '을지로입구')
})

test('stopsLeft는 남은 정거장 수를 준다', () => {
  const s = ['A', 'B', 'C', 'D']
  assert.equal(stopsLeft(s, 'A'), 3)
  assert.equal(stopsLeft(s, 'C'), 1)
  assert.equal(stopsLeft(s, 'D'), 0)
  assert.equal(stopsLeft(s, 'Z'), -1)
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './route.ts'`

- [ ] **Step 3: 구현 작성**

`src/route.ts`:
```ts
import { neighbors, nodesOf } from './stations.ts'

export type Leg = { line: string; stops: string[] }
export type Plan = { from: string; to: string; legs: Leg[] }

// 다익스트라. 출발 이름의 모든 노선 노드에서 시작해 도착 이름의 아무 노선 노드에 닿는다.
// ponytail: 배열을 정렬해 최소값을 꺼낸다. 노드가 799개라 힙이 필요 없다.
export function plan(from: string, to: string): Plan | null {
  if (from === to) return null
  const starts = nodesOf(from)
  const goals = new Set(nodesOf(to))
  if (!starts.length || !goals.size) return null

  const dist = new Map<string, number>()
  const prev = new Map<string, string | null>()
  const queue: [number, string][] = []
  for (const s of starts) {
    dist.set(s, 0)
    prev.set(s, null)
    queue.push([0, s])
  }

  let end: string | null = null
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0])
    const [d, cur] = queue.shift()!
    if (d > (dist.get(cur) ?? Infinity)) continue
    if (goals.has(cur)) { end = cur; break }
    for (const e of neighbors(cur)) {
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

  // 노선이 바뀌는 지점에서 잘라 구간으로 만든다. 환승역은 양쪽 구간에 모두 들어간다.
  const legs: Leg[] = []
  for (const n of nodes) {
    const [line, name] = [n.slice(0, n.indexOf('|')), n.slice(n.indexOf('|') + 1)]
    const last = legs[legs.length - 1]
    // 환승역은 노드 두 개로 온다(2호선|을지로3가 다음에 3호선|을지로3가).
    // 그래서 앞 구간은 이미 환승역으로 끝난다. 여기서 다시 넣으면 안 된다.
    if (last && last.line === line) last.stops.push(name)
    else legs.push({ line, stops: [name] })
  }
  // 환승역 하나만 남은 꼬리 구간은 버린다 (도착지가 환승역일 때 생긴다)
  return { from, to, legs: legs.filter(l => l.stops.length > 1) }
}

export function stopsLeft(stops: string[], current: string): number {
  const i = stops.indexOf(current)
  return i < 0 ? -1 : stops.length - 1 - i
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전체

`plan('충정로','시청')`이 1정거장이 아니면 순환 간선이 빠진 것이다. Task 3으로 돌아간다.

- [ ] **Step 5: 커밋**

```bash
git add src/route.ts src/route.test.ts
git commit -m "feat: 환승을 포함한 경로 탐색

다익스트라로 전체 네트워크 경로를 구하고 노선이 바뀌는 지점에서 구간을 나눈다.
방향 판정은 route.ts가 하지 않는다. 도착 열차의 방면 역과 stops[1]을 비교한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `route.ts` — 속도와 추정 위치

**Files:**
- Modify: `src/route.ts`, `src/route.test.ts`

**Interfaces:**
- Produces:
```ts
export type Fix = { station: string; at: number }   // at = epoch ms
export const DEFAULT_PACE_MS = 120_000
export const STALE_MS = 180_000
export function paceMs(stops: string[], fixes: Fix[]): number
export type Guess = { index: number; estimated: number; stale: boolean }
export function locate(stops: string[], fixes: Fix[], now: number): Guess | null
```

- [ ] **Step 1: 실패하는 테스트 추가**

`src/route.test.ts` 끝에 붙인다.
```ts
import { paceMs, locate, DEFAULT_PACE_MS } from './route.ts'

const S = ['A', 'B', 'C', 'D', 'E', 'F']

test('paceMs는 관측에서 역간 소요시간을 구한다', () => {
  assert.equal(paceMs(S, [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }, { station: 'C', at: 180_000 }]), 90_000)
})

test('paceMs는 관측이 부족하면 기본값을 준다', () => {
  assert.equal(paceMs(S, []), DEFAULT_PACE_MS)
  assert.equal(paceMs(S, [{ station: 'A', at: 0 }]), DEFAULT_PACE_MS)
})

test('paceMs는 같은 역 연속 관측을 하나로 묶는다', () => {
  assert.equal(paceMs(S, [{ station: 'A', at: 0 }, { station: 'A', at: 10_000 }, { station: 'B', at: 60_000 }]), 60_000)
})

test('locate는 최근 관측이면 추정하지 않는다', () => {
  const f = [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }]
  assert.deepEqual(locate(S, f, 100_000), { index: 1, estimated: 0, stale: false })
})

test('locate는 신호가 끊기면 관측 속도로 위치를 민다', () => {
  const f = [{ station: 'A', at: 0 }, { station: 'B', at: 45_000 }]
  // 100초 지났다. 45초에 한 정거장이므로 2정거장을 민다. STALE_MS 안이다.
  assert.deepEqual(locate(S, f, 145_000), { index: 3, estimated: 2, stale: false })
})

test('locate는 STALE_MS를 넘으면 stale이다', () => {
  const f = [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }]
  assert.equal(locate(S, f, 90_000 + 180_001)!.stale, true)
  assert.equal(locate(S, f, 90_000 + 179_000)!.stale, false)
})

test('locate는 경로 끝을 넘지 않는다', () => {
  assert.equal(locate(S, [{ station: 'D', at: 0 }], 10_000_000)!.index, S.length - 1)
})

test('locate는 관측이 없으면 null을 준다', () => {
  assert.equal(locate(S, [], 1000), null)
  assert.equal(locate(S, [{ station: 'Z', at: 0 }], 1000), null)
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `paceMs is not a function` 계열

- [ ] **Step 3: 구현 추가**

`src/route.ts` 끝에 붙인다.
```ts
export type Fix = { station: string; at: number }

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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전체

- [ ] **Step 5: 커밋**

```bash
git add src/route.ts src/route.test.ts
git commit -m "feat: 관측 속도 기반 위치 추정

정적 소요시간표 대신 그 열차 자신의 실제 속도를 쓴다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `geo.ts` — 가까운 역

**Files:**
- Create: `src/geo.ts`, `src/geo.test.ts`

**Interfaces:**
- Consumes: 없음 (좌표 목록을 인자로 받는다. 그래서 단독 테스트가 된다)
- Produces:
```ts
export type Near = { name: string; meters: number }
export const MAX_ACCURACY_M = 1000
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number
export function nearest(lat: number, lon: number, coords: readonly { name: string; lat: number; lon: number }[], n?: number): Near[]
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/geo.test.ts`:
```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { distanceM, nearest } from './geo.ts'

// 실제 좌표 (subwayStationMaster)
const 서울역 = { name: '서울역', lat: 37.556228, lon: 126.972135 }
const 시청 = { name: '시청', lat: 37.565715, lon: 126.977088 }
const 종각 = { name: '종각', lat: 37.570161, lon: 126.982923 }

test('distanceM은 미터 거리를 준다', () => {
  assert.equal(distanceM(37.556228, 126.972135, 37.556228, 126.972135), 0)
  const d = distanceM(서울역.lat, 서울역.lon, 시청.lat, 시청.lon)
  assert.ok(d > 900 && d < 1300, `서울역-시청 거리가 ${d}m입니다`)
})

test('nearest는 가까운 순으로 준다', () => {
  const out = nearest(서울역.lat, 서울역.lon, [종각, 시청, 서울역])
  assert.deepEqual(out.map(o => o.name), ['서울역', '시청', '종각'])
  assert.equal(out[0].meters, 0)
})

test('nearest는 개수를 제한한다', () => {
  assert.equal(nearest(서울역.lat, 서울역.lon, [종각, 시청, 서울역], 2).length, 2)
  assert.deepEqual(nearest(0, 0, [], 3), [])
})

test('nearest는 같은 이름을 한 번만 준다', () => {
  const dup = [서울역, { ...서울역, lat: 서울역.lat + 0.0001 }, 시청]
  assert.deepEqual(nearest(서울역.lat, 서울역.lon, dup).map(o => o.name), ['서울역', '시청'])
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './geo.ts'`

- [ ] **Step 3: 구현 작성**

`src/geo.ts`:
```ts
export type Near = { name: string; meters: number }

// accuracy가 이보다 나쁘면 GPS를 버리고 최근 출발역만 보여준다.
export const MAX_ACCURACY_M = 1000

const R = 6_371_000 // 지구 반지름 (m)
const rad = (d: number) => (d * Math.PI) / 180

// 하버사인. 몇 km 범위라 평면 근사로도 되지만, 짧고 경계에서 정확하다.
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

export function nearest(
  lat: number,
  lon: number,
  coords: readonly { name: string; lat: number; lon: number }[],
  n = 8,
): Near[] {
  const best = new Map<string, number>()
  for (const c of coords) {
    const m = distanceM(lat, lon, c.lat, c.lon)
    if (m < (best.get(c.name) ?? Infinity)) best.set(c.name, m)
  }
  return [...best]
    .map(([name, meters]) => ({ name, meters }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, n)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전체

- [ ] **Step 5: 커밋**

```bash
git add src/geo.ts src/geo.test.ts
git commit -m "feat: 좌표로 가까운 역 찾기

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `screen.ts` — 화면 문자열과 바이트 한도

**Files:**
- Create: `src/screen.ts`, `src/screen.test.ts`

**Interfaces:**
- Produces:
```ts
export const PAGE_BYTES = 950
export const ITEM_BYTES = 62
export function bytes(s: string): number
export function fitItems(items: string[]): string[]
export function progressBar(len: number, index: number, estimated: number, cells?: number): string
export type Boxes = { top: string; mid: string; bottom: string }
export function ridingBoxes(a: {
  next: string; stopsLeft: number; paceMs: number; dest: string
  pathLen: number; index: number; estimated: number
  transfer?: { station: string; line: string; stopsAway: number }
}): Boxes
export function alertScreen(a: { stopsLeft: number; next: string; dest: string; minutes: number }): string
export function transferScreen(a: { station: string; from: string; to: string; toward: string }): string
export function lostScreen(a: { last: string; agoSec: number; guess: string; stopsLeft: number; bar: string }): string
export function planScreen(a: { from: string; to: string; legs: { line: string; stops: string[] }[] }): string
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/screen.test.ts`:
```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bytes, fitItems, progressBar, ridingBoxes, alertScreen, transferScreen, lostScreen, planScreen,
  PAGE_BYTES, ITEM_BYTES,
} from './screen.ts'

test('bytes는 UTF-8 바이트를 센다', () => {
  assert.equal(bytes('가'), 3)
  assert.equal(bytes('ab'), 2)
})

test('fitItems는 항목과 페이지 바이트 한도를 지킨다', () => {
  const items = Array.from({ length: 8 }, () => '가'.repeat(40))
  const out = fitItems(items)
  assert.equal(out.length, 8)
  assert.ok(out.every(i => bytes(i) <= ITEM_BYTES))
  assert.ok(bytes(out.join('')) <= PAGE_BYTES)
  assert.deepEqual(fitItems(['잠실  120m']), ['잠실  120m'])
})

test('progressBar는 관측, 추정, 남은 역, 하차역을 그린다', () => {
  assert.equal(progressBar(6, 3, 0), '●━●━●━●━○━◉')
  // index=3, estimated=2 이면 2번과 3번 칸이 추정이다
  assert.equal(progressBar(6, 3, 2), '●━●━◌━◌━○━◉')
  assert.equal(progressBar(6, 0, 0), '●━○━○━○━○━◉')
  assert.equal(progressBar(6, 5, 0), '●━●━●━●━●━◉')
})

test('progressBar는 길면 앞을 줄인다', () => {
  const bar = progressBar(30, 20, 0, 12)
  assert.ok(bar.startsWith('⋯'), bar)
  assert.ok(bar.endsWith('◉'), bar)
  assert.ok(bar.length <= 24, bar)
})

test('ridingBoxes는 세 상자를 채우고 한도를 지킨다', () => {
  const b = ridingBoxes({
    next: '역삼', stopsLeft: 4, paceMs: 120_000, dest: '강남',
    pathLen: 7, index: 3, estimated: 0,
    transfer: { station: '교대', line: '3호선', stopsAway: 2 },
  })
  assert.ok(b.top.includes('역삼'))
  assert.ok(b.mid.includes('4') && b.mid.includes('강남'))
  assert.ok(b.bottom.includes('교대') && b.bottom.includes('3호선'))
  assert.ok(bytes(b.top + b.mid + b.bottom) <= PAGE_BYTES)
})

test('ridingBoxes는 환승이 없으면 목적지를 보여준다', () => {
  const b = ridingBoxes({ next: '역삼', stopsLeft: 4, paceMs: 120_000, dest: '강남', pathLen: 7, index: 3, estimated: 0 })
  assert.ok(b.bottom.includes('강남'))
})

test('alertScreen은 남은 정거장에 따라 문구를 바꾼다', () => {
  const two = alertScreen({ stopsLeft: 2, next: '역삼', dest: '강남', minutes: 4 })
  const one = alertScreen({ stopsLeft: 1, next: '강남', dest: '강남', minutes: 2 })
  assert.ok(two.includes('다 음 다 음'))
  assert.ok(one.includes('다 음 에') && !one.includes('다 음 다 음'))
  assert.ok(bytes(two) <= PAGE_BYTES)
})

test('transferScreen과 lostScreen은 한도를 지키고 복구 경로를 보여준다', () => {
  const t = transferScreen({ station: '교대', from: '2호선', to: '3호선', toward: '경복궁' })
  assert.ok(t.includes('3호선') && t.includes('경복궁'))
  assert.ok(t.includes('탭'), '환승 화면에는 다음 동작 안내가 있어야 합니다')
  assert.ok(bytes(t) <= PAGE_BYTES)

  const l = lostScreen({ last: '선릉', agoSec: 52, guess: '역삼', stopsLeft: 3, bar: progressBar(6, 3, 2) })
  assert.ok(l.includes('선릉') && l.includes('52') && l.includes('역삼'))
  assert.ok(l.includes('탭'), '실패 화면에는 항상 탭 복구 경로가 있어야 합니다')
  assert.ok(bytes(l) <= PAGE_BYTES)
})

test('planScreen은 경로 요약을 보여주고 한도를 지킨다', () => {
  const s = planScreen({
    from: '잠실', to: '경복궁',
    legs: [
      { line: '2호선', stops: Array.from({ length: 14 }, (_, i) => `역${i}`) },
      { line: '3호선', stops: ['을지로3가', '안국', '경복궁', '끝'] },
    ],
  })
  assert.ok(s.includes('잠실') && s.includes('경복궁'))
  assert.ok(s.includes('2호선') && s.includes('3호선'))
  assert.ok(s.includes('13') && s.includes('3'))
  assert.ok(bytes(s) <= PAGE_BYTES)
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './screen.ts'`

- [ ] **Step 3: 구현 작성**

`src/screen.ts`:
```ts
// G2 한도는 모두 UTF-8 바이트다(tiro 실기기 실측). 한글 1자는 3바이트다.
export const PAGE_BYTES = 950
export const ITEM_BYTES = 62

const enc = new TextEncoder()
export const bytes = (s: string): number => enc.encode(s).length

// 목록 항목은 62바이트, 페이지 전체는 950바이트를 넘으면 하드웨어가 거부한다.
export function fitItems(items: string[]): string[] {
  for (let len = ITEM_BYTES; len > 1; len--) {
    const cut = items.map(i => i.slice(0, len))
    if (cut.every(i => bytes(i) <= ITEM_BYTES) && bytes(cut.join('')) <= PAGE_BYTES) return cut
  }
  return items.map(i => i.slice(0, 1))
}

// ● 지나온 역(관측), ◌ 지나온 역(추정), ○ 남은 역, ◉ 하차역
export function progressBar(len: number, index: number, estimated: number, cells = 12): string {
  const marks: string[] = []
  for (let i = 0; i < len; i++) {
    if (i === len - 1) marks.push('◉')
    else if (i > index) marks.push('○')
    else if (i > index - estimated) marks.push('◌')
    else marks.push('●')
  }
  if (marks.length <= cells) return marks.join('━')
  // 하차역 쪽이 중요하다. 앞을 줄인다.
  return '⋯' + marks.slice(marks.length - (cells - 1)).join('━')
}

const mins = (ms: number, stops: number) => Math.max(1, Math.round((ms * stops) / 60_000))
// 넓은 자간으로 강조한다. G2는 폰트 크기를 바꿀 수 없다.
const wide = (s: string) => [...s].join(' ')

export type Boxes = { top: string; mid: string; bottom: string }

export function ridingBoxes(a: {
  next: string; stopsLeft: number; paceMs: number; dest: string
  pathLen: number; index: number; estimated: number
  transfer?: { station: string; line: string; stopsAway: number }
}): Boxes {
  return {
    top: `\n  다음      ${wide(a.next)}\n`,
    mid: `  하차까지  ${a.stopsLeft} 정거장 · 약 ${mins(a.paceMs, a.stopsLeft)}분\n  ${progressBar(a.pathLen, a.index, a.estimated)} ${a.dest}`,
    bottom: a.transfer
      ? `  ${a.transfer.station}에서 ${a.transfer.line} 갈아탐 (${a.transfer.stopsAway}정거장 뒤)`
      : `  ${a.dest}까지 갑니다`,
  }
}

export function alertScreen(a: { stopsLeft: number; next: string; dest: string; minutes: number }): string {
  const head = a.stopsLeft <= 1 ? wide('다음에 내립니다') : wide('다음다음에 내립니다')
  return `\n\n     ${head}\n\n        ${wide(a.dest)}\n\n     ${a.next} → ${a.dest} · 약 ${a.minutes}분\n`
}

export function transferScreen(a: { station: string; from: string; to: string; toward: string }): string {
  return `\n\n     ${wide(a.station + '에서 갈아탑니다')}\n\n     ${a.from}  →  ${a.to}\n     방면: ${a.toward}\n\n     탭하면 다음 열차를 고릅니다`
}

export function lostScreen(a: { last: string; agoSec: number; guess: string; stopsLeft: number; bar: string }): string {
  return `  신호 끊김\n  마지막 확인: ${a.last} (${a.agoSec}초 전)\n\n  추정      ${a.guess} 부근 · 하차까지 ${a.stopsLeft} 정거장\n  ${a.bar}\n\n  탭: 열차 다시 고르기`
}

// 경로를 계산한 직후 보여준다. 탭이 필요 없다. 곧 열차 목록으로 넘어간다.
export function planScreen(a: { from: string; to: string; legs: { line: string; stops: string[] }[] }): string {
  const body = a.legs
    .map((l, i) => {
      const ride = `     ${l.line} ${l.stops.length - 1}정거장`
      return i === 0 ? ride : `     ▶ ${l.stops[0]} 환승\n${ride}`
    })
    .join('\n')
  return `\n     ${a.from} → ${a.to}\n\n${body}\n\n     열차를 확인하는 중...`
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전체

- [ ] **Step 5: 커밋**

```bash
git add src/screen.ts src/screen.test.ts
git commit -m "feat: 화면 문자열 생성과 바이트 한도 적합

바이트 한도를 테스트로 잡는다. tiro는 이 한도로 두 번 막혔다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Cloudflare Worker 프록시  *(실시간 키 필요)*

**Files:**
- Create: `worker/index.js`, `worker/wrangler.toml`, `worker/README.md`
- Modify: `.env.local`

**Interfaces:**
- Produces: `GET {WORKER}/position/{노선명}`, `GET {WORKER}/arrival/{역명}`

- [ ] **Step 1: `worker/index.js` 작성**

```js
// 서울 실시간 지하철 API 프록시.
// 두 가지를 푼다. (1) 원 API가 http 전용이라 https 페이지에서 못 부른다.
//                 (2) 실시간 키를 클라이언트에 두지 않는다.
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

    const url = new URL(request.url)
    const [, kind, ...rest] = url.pathname.split('/')
    const arg = decodeURIComponent(rest.join('/'))
    const build = ROUTES[kind]
    if (!build || !arg) return new Response('not found', { status: 404, headers: cors })

    // 토큰은 앱 번들에 있으므로 꺼낼 수 있다. 우연한 남용을 막는 장치이지 인증이 아니다.
    if (request.headers.get('x-metro-token') !== env.METRO_TOKEN) {
      return new Response('forbidden', { status: 403, headers: cors })
    }

    const upstream = `${BASE}/${env.SEOUL_RT_KEY}/json/${build(arg)}`
    const res = await fetch(upstream, { cf: { cacheTtl: 5, cacheEverything: true } })
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    })
  },
}
```

- [ ] **Step 2: `worker/wrangler.toml` 작성**

`name`과 `route`는 blue-rabbit 도메인에 맞게 사람이 정한다.

```toml
name = "metro"
main = "index.js"
compatibility_date = "2026-09-01"

# 사용자 도메인에 붙인다. 예: metro.blue-rabbit.example
# [[routes]]
# pattern = "metro.blue-rabbit.example"
# custom_domain = true
```

- [ ] **Step 3: `.env.local`에 실시간 키와 토큰을 넣는다**

`SEOUL_RT_KEY`에 실시간 지하철 API 키를 넣는다. 토큰을 새로 만든다.

```bash
grep -q '^METRO_TOKEN=' .env.local || printf 'METRO_TOKEN=%s\n' "$(openssl rand -hex 16)" >> .env.local
grep -q '^VITE_API_BASE=' .env.local || printf 'VITE_API_BASE=\n' >> .env.local
awk -F= '{print $1"=" (length($2)?"(설정됨)":"(비어 있음)")}' .env.local
```

- [ ] **Step 4: 배포**

```bash
cd worker
npx wrangler secret put SEOUL_RT_KEY   # .env.local의 값을 붙여넣는다
npx wrangler secret put METRO_TOKEN    # .env.local의 값을 붙여넣는다
npx wrangler deploy
```

배포된 origin을 `.env.local`의 `VITE_API_BASE`에 넣는다. 끝에 슬래시를 넣지 않는다.

- [ ] **Step 5: 워커 확인**

```bash
cd /Users/ford/projects/personal/g2/metro
BASE=$(sed -n 's/^VITE_API_BASE=//p' .env.local | tr -d '[:space:]')
TOKEN=$(sed -n 's/^METRO_TOKEN=//p' .env.local | tr -d '[:space:]')
echo "토큰 없이:"; curl -s -o /dev/null -w "%{http_code}\n" "$BASE/position/2호선"
echo "토큰으로:"; curl -s -H "x-metro-token: $TOKEN" "$BASE/position/2호선" | head -c 200
echo; echo "잘못된 경로:"; curl -s -o /dev/null -w "%{http_code}\n" -H "x-metro-token: $TOKEN" "$BASE/evil/http://example.com"
```

Expected: 403 / 열차 JSON / 404

- [ ] **Step 6: 노선 ID를 채운다**

`scripts/fetch-stations.mjs`가 `SEOUL_RT_KEY`를 쓰므로 그대로 다시 돌린다.

Run: `npm run stations`
Expected: `노선 ID 15개 이상`. `lines`에 `1001`~`1009`가 모두 있어야 한다.

```bash
node -e "const d=require('./src/stations.json'); console.log(d.lines.map(l=>l.id+':'+l.name).join(' '))"
```

`1001`~`1009` 중 빠진 것이 있으면 운행 시간대(05:30~24:00)에 다시 돌린다.

- [ ] **Step 7: 별칭과 미지원 노선을 확인한다**

`fetch-stations.mjs`가 이미 별칭을 처리한다(`경의선 → 경의중앙선`, `우이신설경전철 → 우이신설선`).
결과만 확인한다.

```bash
node -e "
const d=require('./src/stations.json');
const rt=new Set(d.lines.map(l=>l.name));
console.log('노선 ID', d.lines.length);
console.log('ID 없는 노선:', [...new Set(d.stations.map(s=>s.line))].filter(x=>!rt.has(x)).join(' '));
"
```

Expected:
```
노선 ID 19
ID 없는 노선: 김포도시철도 용인경전철 의정부경전철 인천2호선 인천선
```

이 5개는 서울시 TOPIS가 제공하지 않는다(인천·김포·용인·의정부 자체 노선).
`stations.ts`가 그래프에서 제외한다. 목록이 달라지면 멈추고 사람에게 알린다.

- [ ] **Step 8: 커밋**

```bash
git add worker src/stations.json
git commit -m "feat: 서울 실시간 API 프록시 워커

http 전용 API를 https로 중계하고 실시간 키를 서버에 둔다.
경로는 position과 arrival 둘뿐이다. 임의 URL을 중계하지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `api.ts` — 워커 호출과 응답 정규화

**Files:**
- Create: `src/api.ts`, `src/api.test.ts`

**Interfaces:**
- Consumes: `lineName` (Task 3), `Direction` (Task 4)
- Produces:
```ts
export type TrainPos = { trainNo: string; station: string; status: number; express: boolean; terminal: string; at: number }
export type Arrival = { trainNo: string; station: string; line: string; etaSec: number; msg: string; toward: string; express: boolean }
export function parsePositions(body: unknown): TrainPos[]
export function parseArrivals(body: unknown): Arrival[]
export function positions(line: string): Promise<TrainPos[]>
export function arrivals(station: string): Promise<Arrival[]>
```

**`updnLine`을 읽지 않는다.** 두 API의 표기가 다르고 2호선·9호선은 극성이 반대다(spec §5.3).
방향은 `toward`(= `"…방면"` 역)로 정한다. 이 필드의 파싱이 이 Task의 핵심이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/api.test.ts`. 응답 예시는 2026-09-20 실측값이다.
```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePositions, parseArrivals } from './api.ts'

const POS = {
  errorMessage: { code: 'INFO-000', total: 37 },
  realtimePositionList: [
    { subwayId: '1002', subwayNm: '2호선', statnNm: '신도림', trainNo: '2324',
      updnLine: '0', statnTnm: '성수종착', trainSttus: '1', directAt: '0',
      recptnDt: '2026-09-20 18:38:29' },
    { subwayId: '1002', subwayNm: '2호선', statnNm: '잠실새내', trainNo: '2301',
      updnLine: '1', statnTnm: '성수종착', trainSttus: '2', directAt: '1',
      recptnDt: '2026-09-20 18:38:38' },
  ],
}

const ARR = {
  errorMessage: { code: 'INFO-000', total: 22 },
  realtimeArrivalList: [
    { subwayId: '1001', statnNm: '서울', updnLine: '상행', trainLineNm: '광운대행 - 시청방면',
      btrainSttus: '일반', barvlDt: '0', btrainNo: '0146', arvlMsg2: '서울 출발' },
    { subwayId: '1065', statnNm: '서울', updnLine: '하행', trainLineNm: '인천공항2터미널행 - 공덕방면',
      btrainSttus: '급행', barvlDt: '180', btrainNo: 'A2203', arvlMsg2: '2분 후 도착' },
  ],
}

test('parsePositions는 필드를 정규화한다', () => {
  const [a, b] = parsePositions(POS)
  assert.equal(a.trainNo, '2324')
  assert.equal(a.station, '신도림')
  assert.equal(a.status, 1)
  assert.equal(a.express, false)
  assert.equal(a.terminal, '성수종착')
  assert.ok(a.at > 0)
  assert.equal(b.express, true)
})

test('parseArrivals는 방면 역을 뽑는다', () => {
  const [a, b] = parseArrivals(ARR)
  assert.equal(a.trainNo, '0146')
  assert.equal(a.toward, '시청', '"광운대행 - 시청방면"의 방면은 시청입니다')
  assert.equal(b.toward, '공덕')
  assert.equal(b.etaSec, 180)
  assert.equal(b.express, true)
})

test('parseArrivals는 (급행) 꼬리와 괄호 별칭을 처리한다', () => {
  const rows = [
    { btrainNo: '1', statnNm: '신도림', subwayId: '1001', trainLineNm: '동인천행 - 구로방면 (급행)', btrainSttus: '급행', barvlDt: '60' },
    { btrainNo: '2', statnNm: '사당', subwayId: '1004', trainLineNm: '불암산행 - 총신대입구(이수)방면', btrainSttus: '일반', barvlDt: '30' },
    { btrainNo: '3', statnNm: 'X', subwayId: '1001', trainLineNm: '', btrainSttus: '일반', barvlDt: '0' },
  ]
  const [a, b, c] = parseArrivals({ realtimeArrivalList: rows })
  assert.equal(a.toward, '구로')
  assert.equal(b.toward, '총신대입구', '괄호 별칭을 떼야 역 목록과 맞습니다')
  assert.equal(c.toward, '')
})

test('파서는 빈 응답과 오류 응답에 빈 배열을 준다', () => {
  assert.deepEqual(parsePositions({}), [])
  assert.deepEqual(parseArrivals({}), [])
  assert.deepEqual(parsePositions({ status: 500, code: 'ERROR-338' }), [])
  assert.deepEqual(parseArrivals(null), [])
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './api.ts'`

- [ ] **Step 3: 구현 작성**

`src/api.ts`:
```ts
import { lineName } from './stations.ts'

// 워커가 http 전용 원 API를 https로 중계한다. 키는 워커에 있다.
const BASE = import.meta.env.VITE_API_BASE ?? ''
const TOKEN = import.meta.env.VITE_API_TOKEN ?? ''

export type TrainPos = {
  trainNo: string; station: string
  status: number; express: boolean; terminal: string; at: number
}

export type Arrival = {
  trainNo: string; station: string; line: string
  etaSec: number; msg: string; toward: string; express: boolean
}

// "광운대행 - 시청방면"        -> "시청"
// "동인천행 - 구로방면 (급행)"  -> "구로"   ($ 앵커를 쓰면 (급행)에서 실패한다
// "불암산행 - 총신대입구(이수)방면" -> "총신대입구"  (괄호 별칭을 떼야 역 목록과 맞는다)
export const towardOf = (trainLineNm: string): string => {
  const m = /-\s*(.+?)방면/.exec(trainLineNm ?? '')
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
```

- [ ] **Step 4: Vite가 토큰을 주입하도록 한다**

`.env.local`의 `METRO_TOKEN` 값을 `VITE_API_TOKEN`으로도 넣는다. Vite는 `VITE_` 접두만 노출한다.

```bash
grep -q '^VITE_API_TOKEN=' .env.local || printf 'VITE_API_TOKEN=%s\n' "$(sed -n 's/^METRO_TOKEN=//p' .env.local | tr -d '[:space:]')" >> .env.local
```

- [ ] **Step 5: 테스트와 빌드 확인**

Run: `npm test && npm run build`
Expected: PASS 전체, 빌드 성공

- [ ] **Step 6: 커밋**

```bash
git add src/api.ts src/api.test.ts
git commit -m "feat: 워커 호출과 응답 정규화

updnLine은 읽지 않는다. 노선마다 극성이 반대다.
방향은 trainLineNm의 방면 역으로 정한다. (급행) 꼬리와 괄호 별칭을 처리한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 폰 설정 화면과 G2 화면 그리기

**Files:**
- Modify: `index.html`, `src/main.ts`

**Interfaces:**
- Produces:
```ts
function boxPage(b: Boxes): object
function fullPage(content: string): object
function listPage(items: string[]): object
async function showFull(content: string): Promise<void>
async function showBoxes(b: Boxes): Promise<void>
async function showList(items: string[]): Promise<boolean>
```

설정 화면은 자주 가는 도착지만 받는다. 한 줄에 역 이름 하나다. 키 입력란은 없다.

- [ ] **Step 1: `index.html` 본문 교체**

`<style>`은 그대로 두고 `<body>` 안만 바꾼다.

```html
<form id="app">
  <div>
    <p>자주 가는 도착지 (한 줄에 하나, 최대 8개)</p>
    <textarea id="dests" rows="8" placeholder="강남&#10;경복궁&#10;여의도"
              style="width: 100%; padding: 10px; box-sizing: border-box"></textarea>
    <p style="opacity: 0.7">출발역은 GPS로 찾습니다. API key는 필요 없습니다.</p>
    <button style="margin-top: 12px; padding: 10px 24px">저장</button>
    <p id="status"></p>
  </div>
</form>
<script type="module" src="/src/main.ts"></script>
```

- [ ] **Step 2: `src/main.ts`를 아래 내용으로 통째로 바꾼다**

Task 1의 한 줄짜리 `main.ts`를 버린다.

```ts
import {
  waitForEvenAppBridge,
  TextContainerProperty, ListContainerProperty, ListItemContainerProperty,
  CreateStartUpPageContainer, RebuildPageContainer, OsEventTypeList,
  AppLocationAccuracy,
} from '@evenrealities/even_hub_sdk'
import { fitItems, bytes, type Boxes } from './screen.ts'

const log = (...a: unknown[]) => {
  if (import.meta.env.DEV) navigator.sendBeacon('/__log', a.map(String).join(' '))
}
window.addEventListener('error', e => log('error', e.message))
window.addEventListener('unhandledrejection', e => log('rejection', e.reason))

const bridge = await waitForEvenAppBridge()

const box = (id: number, y: number, h: number, content: string, capture = 0) =>
  new TextContainerProperty({
    xPosition: 0, yPosition: y, width: 576, height: h,
    borderWidth: 1, paddingLength: 6,
    containerID: id, containerName: `b${id}`,
    content, isEventCapture: capture,
  })

// 상자 3개가 위계를 만든다. G2는 폰트 크기를 바꿀 수 없다.
// isEventCapture는 페이지당 정확히 1개여야 한다.
const boxPage = (b: Boxes) => ({
  containerTotalNum: 3,
  textObject: [box(1, 0, 104, b.top, 1), box(2, 104, 104, b.mid), box(3, 208, 80, b.bottom)],
})

const fullPage = (content: string) => ({
  containerTotalNum: 1,
  textObject: [box(1, 0, 288, content, 1)],
})

const listPage = (items: string[]) => ({
  containerTotalNum: 1,
  listObject: [new ListContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, paddingLength: 4,
    containerID: 1, containerName: 'rows',
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length, itemWidth: 568, isItemSelectBorderEn: 1, itemName: items,
    }),
    isEventCapture: 1,
  })],
})

// 반환값을 확인한다. tiro는 이것을 빼먹어 화면이 멈췄다.
async function showFull(content: string): Promise<void> {
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(fullPage(content)))
  log('full', ok, 'bytes', bytes(content))
  if (!ok) {
    await bridge.rebuildPageContainer(new RebuildPageContainer(
      fullPage('화면을 표시하지 못했습니다.\n탭: 처음으로 · 더블탭: 종료')))
  }
}

async function showBoxes(b: Boxes): Promise<void> {
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(boxPage(b)))
  log('boxes', ok, 'bytes', bytes(b.top + b.mid + b.bottom))
  // 상자 3개가 거부되면 전체 화면 1개로 떨어뜨린다
  if (!ok) await showFull(`${b.top}\n${b.mid}\n${b.bottom}`)
}

async function showList(items: string[]): Promise<boolean> {
  const fitted = fitItems(items)
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(listPage(fitted)))
  log('list', ok, 'count', fitted.length, 'bytes', bytes(fitted.join('')))
  return !!ok
}

// 폰 설정 화면: 자주 가는 도착지만 받는다. 키 입력란은 없다.
const MAX_DESTS = 8
const parseLines = (t: string, max: number) =>
  t.split('\n').map(s => s.trim()).filter(Boolean).slice(0, max)

let dests = parseLines((await bridge.getLocalStorage('destinations')) ?? '', MAX_DESTS)
let recents = parseLines((await bridge.getLocalStorage('recentOrigins')) ?? '', 5)

const status = document.querySelector<HTMLElement>('#status')!
const destField = document.querySelector<HTMLTextAreaElement>('#dests')!
destField.value = dests.join('\n')
const showStatus = () => { status.textContent = `도착지 ${dests.length}개 · 최근 출발역 ${recents.length}개` }
showStatus()

document.querySelector<HTMLFormElement>('#app')!.addEventListener('submit', async e => {
  e.preventDefault()
  dests = parseLines(destField.value, MAX_DESTS)
  await bridge.setLocalStorage('destinations', dests.join('\n'))
  destField.value = dests.join('\n')
  showStatus()
  await showOrigin()
})

async function rememberOrigin(name: string): Promise<void> {
  recents = [name, ...recents.filter(r => r !== name)].slice(0, 5)
  await bridge.setLocalStorage('recentOrigins', recents.join('\n'))
}

const started = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer(fullPage('출발역을 찾는 중...')))
log('startup', started, location.href)
```

`showOrigin`과 `rememberOrigin`은 Task 11에서 채운다. 이 Task는 빌드만 통과시킨다.
`rememberOrigin`이 아직 쓰이지 않아 `noUnusedLocals`에 걸리면, Task 11까지
`export`를 붙이지 말고 파일 끝에 `void rememberOrigin`을 한 줄 넣어 둔다.

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: `showOrigin`이 없다는 오류만 남는다. Task 11에서 없어진다.
빌드를 통과시키려면 임시로 `async function showOrigin(): Promise<void> { await showFull('준비 중') }`를 넣는다.

- [ ] **Step 4: 커밋**

```bash
git add index.html src/main.ts
git commit -m "feat: 폰 설정 화면과 G2 화면 그리기

설정은 자주 가는 도착지만 받는다. 키 입력란이 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `ORIGIN`과 `DEST` — GPS 출발역과 도착지 고르기

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `nearest`, `MAX_ACCURACY_M` (Task 6), `COORDS` (Task 3), `plan` (Task 4), `planScreen` (Task 7)
- Produces:
```ts
type Mode = 'origin' | 'dest' | 'pick' | 'riding' | 'transfer' | 'arrived'
async function showOrigin(): Promise<void>
async function showDest(): Promise<void>
async function onTap(index: number): Promise<void>
```

- [ ] **Step 1: 상태와 두 화면을 추가한다**

```ts
import { nearest, MAX_ACCURACY_M, type Near } from './geo.ts'
import { COORDS } from './stations.ts'
import { plan, type Plan } from './route.ts'
import { planScreen } from './screen.ts'

type Mode = 'origin' | 'dest' | 'pick' | 'riding' | 'transfer' | 'arrived'
let mode: Mode = 'origin'
let rows: string[] = []      // 현재 목록 각 행이 뜻하는 값
let origin = ''
let trip: Plan | null = null
let busy = false

const GPS_TIMEOUT_MS = 5000

async function nearbyStations(): Promise<Near[]> {
  try {
    // accuracy는 문자열이 아니라 enum이다. 'high'를 그대로 넘기면 타입 오류다.
    const loc = await bridge.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: GPS_TIMEOUT_MS })
    log('gps', loc?.latitude, loc?.longitude, 'acc', loc?.accuracy)
    if (!loc || !Number.isFinite(loc.latitude)) return []
    // 오차가 크면 목록 순서를 믿을 수 없다. GPS를 버린다.
    if ((loc.accuracy ?? 0) > MAX_ACCURACY_M) return []
    return nearest(loc.latitude, loc.longitude, COORDS, 8)
  } catch (e) {
    log('gps failed', e)
    return []
  }
}

async function showOrigin(): Promise<void> {
  mode = 'origin'
  trip = null
  await showFull('출발역을 찾는 중...')
  const near = await nearbyStations()
  const names = [...near.map(n => n.name), ...recents.filter(r => !near.some(n => n.name === r))]
  rows = names
  if (!names.length) {
    rows = []
    return showFull('출발역을 찾지 못했습니다.\n폰에서 도착지를 먼저 넣으세요.\n탭: 다시 시도 · 더블탭: 종료')
  }
  const label = new Map(near.map(n => [n.name, `${n.name}  ${n.meters}m`]))
  const items = names.map(n => label.get(n) ?? `${n}  (최근)`)
  if (!near.length) {
    // 안내행은 고를 수 없어야 한다. rows에 빈 문자열을 두면 onTap이 다시 시도한다.
    items.unshift('GPS 실패 · 최근 출발역')
    rows = ['', ...names]
  }
  if (!(await showList(items))) {
    rows = []
    await showFull('목록을 표시하지 못했습니다.\n탭: 다시 시도 · 더블탭: 종료')
  }
}

async function showDest(): Promise<void> {
  mode = 'dest'
  if (!dests.length) {
    rows = []
    return showFull('폰 화면에서 자주 가는 도착지를 넣으세요.\n탭: 출발역 다시 고르기 · 더블탭: 종료')
  }
  rows = dests.filter(d => d !== origin)
  if (!(await showList(rows))) {
    rows = []
    await showFull('목록을 표시하지 못했습니다.\n탭: 출발역 다시 고르기')
  }
}

async function startTrip(dest: string): Promise<void> {
  trip = plan(origin, dest)
  if (!trip || !trip.legs.length) {
    mode = 'dest'
    rows = []
    // 실시간 미지원 노선(인천·김포·용인·의정부)의 역은 그래프에 없어서 여기로 온다
    return showFull(`경로를 찾지 못했습니다.\n${origin} → ${dest}\n역 이름과 노선을 확인하세요.\n탭: 도착지 다시 고르기`)
  }
  await rememberOrigin(origin)
  await showFull(planScreen(trip))
  log('plan', origin, dest, trip.legs.map(l => `${l.line}:${l.stops.length - 1}`).join(' '))
  await startLeg(0)
}
```

- [ ] **Step 2: 이벤트 처리를 추가한다**

```ts
// CLICK_EVENT는 0이고 protobuf가 0을 생략한다. eventType이 없으면 클릭이다.
function eventTypeOf(e?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!e) return null
  return e.eventType ?? OsEventTypeList.CLICK_EVENT
}

const unsubscribe = bridge.onEvenHubEvent(async event => {
  const type = eventTypeOf(event.listEvent) ?? eventTypeOf(event.textEvent) ?? eventTypeOf(event.sysEvent)
  if (type === OsEventTypeList.SYSTEM_EXIT_EVENT || type === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    return unsubscribe()
  }
  if (type === null || busy) return
  busy = true
  try {
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      // 루트 화면의 더블탭은 반드시 종료여야 한다 (Even Hub 요구사항)
      if (mode === 'origin') await bridge.shutDownPageContainer(1)
      else await showOrigin()
    } else if (type === OsEventTypeList.CLICK_EVENT) {
      // 하드웨어가 첫 항목의 currentSelectItemIndex를 생략한다
      await onTap(event.listEvent?.currentSelectItemIndex ?? 0)
    }
  } catch (e) {
    log('event failed', e)
    mode = 'origin'
    rows = []
    await showFull(`오류\n${e}\n탭: 처음으로 · 더블탭: 종료`)
  } finally {
    busy = false
  }
})

async function onTap(index: number): Promise<void> {
  if (mode === 'origin') {
    const pick = rows[index]
    if (!pick) return showOrigin()      // 실패 화면이나 안내행이면 다시 시도
    origin = pick
    return showDest()
  }
  if (mode === 'dest') {
    const pick = rows[index]
    if (!pick) return showOrigin()
    return startTrip(pick)
  }
  // pick / riding / transfer / arrived는 Task 12, 13에서 채운다
  return showOrigin()
}

await showOrigin()
```

Task 10에서 넣은 임시 `showOrigin`을 지운다.
`startLeg`는 Task 12에서 채운다. 이 Task에서는 자리만 만든다.

```ts
async function startLeg(i: number): Promise<void> {
  log('leg', i, trip?.legs[i]?.line)
  mode = 'pick'
  rows = []
  await showFull(`${trip!.legs[i].line}\n${trip!.legs[i].stops[0]} → ${trip!.legs[i].stops.at(-1)}\n탭: 처음으로`)
}
```

- [ ] **Step 3: `app.json`에 위치 권한을 넣는다**

Task 14에서 전체를 만들지만, GPS 확인에 필요하므로 먼저 만든다.

```json
{
  "package_id": "com.ford.metro",
  "edition": "202601",
  "name": "Metro",
  "version": "0.1.0",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.15",
  "entrypoint": "index.html",
  "permissions": [
    { "name": "network", "desc": "지하철 실시간 도착·열차 위치 정보를 받습니다.", "whitelist": ["PUT_WORKER_ORIGIN_HERE"] },
    { "name": "location", "desc": "가까운 지하철역을 찾기 위해 위치를 확인합니다." }
  ],
  "supported_languages": ["ko", "en"]
}
```

`PUT_WORKER_ORIGIN_HERE`를 `.env.local`의 `VITE_API_BASE` origin으로 바꾼다.

- [ ] **Step 4: 빌드와 실기기 확인**

Run: `npm run build && npm run dev`
G2 앱에서 QR을 스캔한다. 폰에서 도착지를 몇 개 넣고 저장한다.

Expected:
- G2에 가까운 역 목록이 거리와 함께 나온다
- 터미널에 `[device] gps 37.5... 127.0... acc 15`가 찍힌다
- 역을 탭하면 도착지 목록이 나온다
- 도착지를 탭하면 경로 요약이 나온다 (`[device] plan 잠실 경복궁 2호선:13 3호선:3`)

`gps failed` 또는 `acc` 값이 없으면 `getAppLocation`의 인자 모양을 SDK 타입에서 다시 확인한다.
GPS가 안 되면 최근 출발역 경로로 떨어지는지 확인한다. 이것이 중요한 fallback이다.

- [ ] **Step 5: 커밋**

```bash
git add src/main.ts app.json
git commit -m "feat: GPS로 출발역 고르기와 도착지 목록

GPS 실패나 오차 1km 초과 시 최근 출발역으로 떨어진다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `PICK` — 탈 열차 고르기

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `arrivals` (Task 9), `direction` (Task 4)
- Produces:
```ts
let legIndex: number
let stops: string[]
let trainNo: string
async function showPick(): Promise<void>
async function board(no: string): Promise<void>
```

- [ ] **Step 1: `startLeg`와 `showPick`을 채운다**

Task 11의 자리표시자 `startLeg`를 지우고 아래로 바꾼다.

```ts
import { arrivals, type Arrival } from './api.ts'

let legIndex = 0
let stops: string[] = []
let trainNo = ''
let candidates: Arrival[] = []

const leg = () => trip!.legs[legIndex]

async function startLeg(i: number): Promise<void> {
  legIndex = i
  stops = leg().stops
  trainNo = ''
  await showPick()
}

async function showPick(): Promise<void> {
  mode = 'pick'
  const from = stops[0]
  await showFull(`${from}\n${leg().line} 도착 열차를 확인하는 중...`)
  const all = await arrivals(from)
  const sameLine = all.filter(a => a.trainNo && a.line === leg().line)
  // 방향은 "…방면" 역이 다음 역과 같은지로 가른다(spec §10.3).
  // "…방면"은 급행이든 일반이든 인접한 다음 역이다. updnLine은 읽지 않는다.
  const next = stops[1]
  const sameWay = sameLine.filter(a => a.toward === next)
  // 이름 표기가 어긋나 0대가 되면 거르지 않는다.
  // "도착 정보 없음"으로 막히는 것보다 한 번 더 묻는 편이 안전하다.
  candidates = (sameWay.length ? sameWay : sameLine)
    .sort((a, b) => a.etaSec - b.etaSec)
    .slice(0, 18)
  log('candidates', candidates.length, 'sameWay', sameWay.length, 'line', sameLine.length, 'of', all.length, 'next', next)

  if (!candidates.length) {
    rows = []
    return showFull(`${from}\n${leg().stops.at(-1)} 방면 도착 정보가 없습니다.\n탭: 다시 확인 · 더블탭: 처음으로`)
  }
  if (candidates.length === 1) return board(candidates[0].trainNo)

  rows = candidates.map(a => a.trainNo)
  const items = candidates.map(a =>
    `${a.etaSec > 0 ? `${Math.max(1, Math.round(a.etaSec / 60))}분` : a.msg} ${a.express ? '급행 ' : ''}${a.toward}행`)
  if (!(await showList(items))) {
    rows = []
    await showFull('열차 목록을 표시하지 못했습니다.\n탭: 다시 확인')
  }
}

async function board(no: string): Promise<void> {
  trainNo = no
  mode = 'riding'
  log('boarded', no, leg().line)
  await showFull(`${no}번 열차\n추적을 시작합니다...`)
  // Task 13에서 polling을 붙인다
}
```

- [ ] **Step 2: `onTap`에 배선한다**

```ts
async function onTap(index: number): Promise<void> {
  if (mode === 'origin') {
    const pick = rows[index]
    if (!pick) return showOrigin()
    origin = pick
    return showDest()
  }
  if (mode === 'dest') {
    const pick = rows[index]
    if (!pick) return showOrigin()
    return startTrip(pick)
  }
  if (mode === 'pick') {
    const pick = rows[index]
    return pick ? board(pick) : showPick()   // 실패 화면에서 탭하면 다시 확인
  }
  return showOrigin()
}
```

- [ ] **Step 3: 빌드와 실기기 확인**

Run: `npm run build && npm run dev`

경로의 출발역에 실제로 열차가 들어오는 시간대에 연다.

Expected: 도착지를 탭하면 열차 목록이 뜬다.
`[device] candidates 2 of 18 want 1 line 2호선`이 찍힌다.

로그를 이렇게 읽는다. `candidates 2 sameWay 2 line 4 of 18 next 교대`
= 그 역 도착 18건 중 그 노선이 4건, 그중 교대방면이 2건이다.

**`sameWay 0`이면** 방면 이름이 `stops[1]`과 안 맞는 것이다. 후보를 거르지 않고 넘어가므로
화면은 동작한다. `all`의 `toward` 값을 로그로 찍어 어느 표기가 다른지 확인한다.

**`line 0`이면** `a.line`이 빈 문자열이거나 다른 것이다.
`stations.json`의 `lines`에 그 노선이 빠졌다. Task 8 Step 6으로 돌아간다.

- [ ] **Step 4: 커밋**

```bash
git add src/main.ts
git commit -m "feat: 승강장에서 탈 열차 고르기

방향은 도착 열차의 방면 역이 다음 역과 같은지로 가른다.
일치가 0대면 거르지 않는다. 막히는 것보다 한 번 더 묻는 편이 안전하다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `RIDING` — 열차 추적과 동행 화면

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `positions` (Task 9), `locate`, `paceMs`, `stopsLeft`, `Fix` (Task 4, 5), `ridingBoxes`, `alertScreen`, `transferScreen`, `lostScreen`, `progressBar` (Task 7)
- Produces:
```ts
const POLL_MS = 10_000
async function poll(): Promise<void>
async function render(): Promise<void>
async function arrive(): Promise<void>
```

- [ ] **Step 1: polling과 그리기를 추가한다**

```ts
import { positions } from './api.ts'
import { locate, paceMs, stopsLeft, type Fix } from './route.ts'
import { ridingBoxes, alertScreen, transferScreen, lostScreen, progressBar } from './screen.ts'

const POLL_MS = 10_000
let fixes: Fix[] = []
let pollTimer: ReturnType<typeof setTimeout> | null = null

function stopPolling(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

async function poll(): Promise<void> {
  if (mode !== 'riding') return
  if (!busy) {
    try {
      const me = (await positions(leg().line)).find(t => t.trainNo === trainNo)
      if (me && stops.includes(me.station)) {
        const last = fixes[fixes.length - 1]
        if (!last || last.station !== me.station) fixes.push({ station: me.station, at: me.at })
      } else {
        log('train missing', trainNo)
      }
    } catch (e) {
      log('poll failed', e)   // 일시적 실패는 화면을 바꾸지 않는다. render가 추정으로 처리한다
    }
    await render()
  }
  if (mode === 'riding') pollTimer = setTimeout(poll, POLL_MS)
}

async function render(): Promise<void> {
  const now = Date.now()
  const guess = locate(stops, fixes, now)
  if (!guess) {
    rows = []
    return showFull(`${trainNo}번 열차\n아직 위치를 못 찾았습니다.\n탭: 열차 다시 고르기`)
  }

  const left = stopsLeft(stops, stops[guess.index])
  if (left <= 0) return arrive()

  const pace = paceMs(stops, fixes)
  const lastFix = fixes[fixes.length - 1]

  if (guess.stale) {
    rows = []
    return showFull(lostScreen({
      last: lastFix.station,
      agoSec: Math.round((now - lastFix.at) / 1000),
      guess: stops[guess.index],
      stopsLeft: left,
      bar: progressBar(stops.length, guess.index, guess.estimated),
    }))
  }

  if (left <= 2) {
    return showFull(alertScreen({
      stopsLeft: left,
      next: stops[guess.index + 1],
      dest: stops[stops.length - 1],
      minutes: Math.max(1, Math.round((pace * left) / 60_000)),
    }))
  }

  const nextLeg = trip!.legs[legIndex + 1]
  await showBoxes(ridingBoxes({
    next: stops[guess.index + 1],
    stopsLeft: left,
    paceMs: pace,
    dest: stops[stops.length - 1],
    pathLen: stops.length,
    index: guess.index,
    estimated: guess.estimated,
    transfer: nextLeg
      ? { station: stops[stops.length - 1], line: nextLeg.line, stopsAway: left }
      : undefined,
  }))
}

async function arrive(): Promise<void> {
  stopPolling()
  rows = []
  const nextLeg = trip!.legs[legIndex + 1]
  if (nextLeg) {
    mode = 'transfer'
    return showFull(transferScreen({
      station: stops[stops.length - 1],
      from: leg().line,
      to: nextLeg.line,
      toward: nextLeg.stops[nextLeg.stops.length - 1],
    }))
  }
  mode = 'arrived'
  const dest = stops[stops.length - 1]
  await showFull(`\n\n     ${[...dest].join(' ')}\n\n     도착했습니다.\n\n     탭: 처음으로 · 더블탭: 종료`)
}
```

- [ ] **Step 2: `board`를 완성한다**

Task 12의 `board` 끝에 붙인다.
```ts
async function board(no: string): Promise<void> {
  trainNo = no
  fixes = []
  mode = 'riding'
  log('boarded', no, leg().line)
  await showFull(`${no}번 열차\n추적을 시작합니다...`)
  stopPolling()
  await poll()
}
```

- [ ] **Step 3: `onTap`과 더블탭을 완성한다**

```ts
async function onTap(index: number): Promise<void> {
  if (mode === 'origin') {
    const pick = rows[index]
    if (!pick) return showOrigin()
    origin = pick
    return showDest()
  }
  if (mode === 'dest') {
    const pick = rows[index]
    if (!pick) return showOrigin()
    return startTrip(pick)
  }
  if (mode === 'pick') {
    const pick = rows[index]
    return pick ? board(pick) : showPick()
  }
  if (mode === 'riding') { stopPolling(); return showPick() }   // 엉뚱한 열차를 잡았을 때
  if (mode === 'transfer') return startLeg(legIndex + 1)
  return showOrigin()                                            // arrived
}
```

더블탭 처리의 `showOrigin()` 앞에 `stopPolling()`을 넣는다. 나가면 polling을 멈춘다.

- [ ] **Step 4: 전체 테스트와 빌드**

Run: `npm test && npm run build`
Expected: 모든 테스트 PASS, 빌드 성공

- [ ] **Step 5: 실기기 확인 (실제 탑승)**

Run: `npm run dev`

실제로 지하철을 탄다. 확인할 것은 다섯이다.
1. 상자 3개 화면이 팔 뻗은 거리에서 읽히는가
2. 역을 지날 때 `다음` 역 이름이 바뀌는가 (`[device] boxes 1 bytes ...`)
3. 하차 2정거장 전에 전체 화면으로 바뀌는가
4. 환승역에서 환승 화면이 뜨고, 탭하면 다음 구간 열차 목록이 나오는가
5. 지하 구간에서 `poll failed`가 얼마나 자주 찍히는가

- [ ] **Step 6: 커밋**

```bash
git add src/main.ts
git commit -m "feat: 열차 추적과 동행 화면

10초마다 탄 열차의 위치를 읽는다. 신호가 끊기면 관측 속도로 추정하고 추정이라고 표시한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: 마무리 — 매니페스트 검증과 기록

**Files:**
- Modify: `app.json`, `.agent/context.md`

- [ ] **Step 1: `app.json`의 whitelist를 확인한다**

`.env.local`의 `VITE_API_BASE` origin이 들어 있어야 한다. 와일드카드는 쓸 수 없다.
`openapi.seoul.go.kr:8088`은 빌드 때만 쓰므로 넣지 않는다.

- [ ] **Step 2: 매니페스트 검증**

Run: `npm run pack`
Expected: `out.ehpk`가 만들어진다.

`min_app_version`이 SDK 하한으로 올라가는 것은 정상이다(tiro 확인).

- [ ] **Step 3: 전체 확인**

Run: `npm test && npm run build && npm run pack`
Expected: 전부 성공

- [ ] **Step 4: `.agent/context.md`에 실측 결과를 적는다**

계획에 이미 있는 내용은 적지 않는다. 실기기에서 새로 안 것만 적는다. 최소한 여섯이다.
1. 상자 3개 레이아웃의 실제 가독성
2. 각 화면의 실제 바이트 수
3. `getAppLocation`의 실제 `accuracy` 값과 응답 시간
4. 2호선 내선/외선이 `updnLine`의 0인지 1인지 (spec §14 #2)
5. 두 소스의 이름 표기 차이 실측 결과 (spec §14 #1)
6. 지하 구간의 polling 실패율

- [ ] **Step 5: 커밋**

```bash
git add app.json .agent/context.md
git commit -m "feat: 매니페스트 검증과 실기기 측정 기록

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 알려진 미해결

spec §14와 같다.

1. 서울 API의 rate limit. `poll failed`가 잦으면 `POLL_MS`를 15초로 올린다.
2. 코레일 직결 구간의 `trainNo` 연속성. 끊기면 그때 자동 재탐색을 넣는다.
3. `.ehpk` 페이지의 scheme. 워커가 https이므로 막힐 이유가 없지만 배포 때 확인한다.
4. 이미 탑승한 상태로 앱을 여는 경우. 1차는 승강장에서 시작하는 것만 지원한다.
5. 급행을 타면 "하차까지 N 정거장"이 물리적 역 수라 실제 정차 횟수보다 많다.
   남은 시간은 관측 속도로 계산하므로 영향이 없다. 목록에 `급행`을 표시한다.

### 해결됨 (2026-09-20 실측)
- 노선명 별칭 → `경의선 → 경의중앙선`, `우이신설경전철 → 우이신설선`. 스크립트가 처리한다.
- 실시간 미지원 노선 5개 → 그래프에서 제외한다.
- 2호선·9호선의 `updnLine` 극성 → `updnLine`을 아예 읽지 않는다. 방면 매칭으로 바꿨다.
