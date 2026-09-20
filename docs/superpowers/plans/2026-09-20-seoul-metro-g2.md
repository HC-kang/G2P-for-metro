# 서울 지하철 G2 플러그인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Even Realities G2 글래스에서 내가 탄 지하철 열차를 실제로 추적하여 남은 정거장, 환승 시점, 하차 시점을 안내한다.

**Architecture:** Vite로 빌드한 웹앱이 Even Hub WebView에서 돈다. 서울시 실시간 API를 브라우저에서 직접 호출한다(CORS 허용, 프록시 없음). 계산과 화면 문자열 생성은 순수 함수로 분리하여 `node --test`로 검증한다. G2 SDK 호출은 `main.ts` 한 곳에 모은다.

**Tech Stack:** TypeScript, Vite 5, `@evenrealities/even_hub_sdk`, `node --test` (프레임워크 없음)

**Spec:** `docs/superpowers/specs/2026-09-20-seoul-metro-g2-design.md`

## Global Constraints

- 참고 구현은 `../tiro`다. 같은 SDK 패턴을 쓴다. 새로 발명하지 않는다.
- G2 바이트 한도 (tiro 실기기 실측, 한글 1자 = 3바이트):
  - `rebuildPageContainer` 페이지 전체: **950 UTF-8 바이트**
  - 목록 항목 1개: **62 바이트**
  - 목록 항목 수: **20개**
  - `textContainerUpgrade`: 약 2,000 바이트
- 화면 크기는 576 x 288이다. 페이지당 비이미지 컨테이너는 8개까지다.
- `isEventCapture: 1`인 컨테이너가 페이지당 **정확히 1개** 있어야 한다.
- `CLICK_EVENT`는 값이 0이라 protobuf가 생략한다. `eventType`이 `undefined`면 클릭이다.
- 목록 첫 항목 클릭 시 하드웨어가 `currentSelectItemIndex`를 생략한다. `?? 0`을 쓴다.
- 루트 화면의 더블탭은 반드시 `bridge.shutDownPageContainer(1)`이다 (Even Hub 요구사항).
- `rebuildPageContainer`와 `textContainerUpgrade`의 반환값을 **항상 확인한다.** `false`면 복구 화면을 띄운다.
- 실패 화면에는 **항상** 탭 복구 경로를 둔다.
- 키는 `bridge.setLocalStorage`에 저장한다. 브라우저 `localStorage`는 `.ehpk` WebView 재시작 시 지워진다.
- 개발 로그는 `navigator.sendBeacon('/__log', msg)`이며 `import.meta.env.DEV`일 때만 보낸다.
- API 도메인은 **http 전용**이다. https는 응답하지 않는다.
- 커밋 메시지는 한국어로 쓴다. 각 커밋 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`를 넣는다.
- 키는 `.env.local`에 둔다. 소스와 커밋에 넣지 않는다. 화면에 출력하지 않는다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts` | 빌드 설정. tiro에서 복사 후 수정 |
| `app.json` | Even Hub 매니페스트. 네트워크 whitelist |
| `index.html` | 폰 설정 화면. API key, 경로 5개 |
| `scripts/fetch-stations.mjs` | 빌드 전 1회 실행. `src/stations.json` 생성 |
| `src/stations.json` | 역 순서 + 노선 ID 정적 데이터 |
| `src/stations.ts` | `stations.json` 읽기. 노선별 역 순서, 환승 판정 |
| `src/route.ts` | 방향, 남은 정거장, 속도, 추정 위치. **순수 함수** |
| `src/screen.ts` | 화면 문자열 생성과 바이트 한도 적합. **순수 함수** |
| `src/api.ts` | 서울 API 호출 2개 + 응답 파싱 |
| `src/main.ts` | 상태 기계, G2 SDK 호출, 폰 폼 |

`route.ts`와 `screen.ts`는 `fetch`와 SDK에 의존하지 않는다. 그래서 단독으로 테스트한다.

---

### Task 1: 프로젝트 뼈대

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `index.html`, `src/main.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `npm run dev`가 동작하는 Vite 프로젝트

- [ ] **Step 1: `package.json` 작성**

```json
{
  "name": "g2-metro",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "pack": "npm run build && evenhub pack app.json dist",
    "stations": "node scripts/fetch-stations.mjs",
    "test": "node --test src/*.test.ts"
  },
  "dependencies": {
    "@evenrealities/even_hub_sdk": "^0.0.15"
  },
  "devDependencies": {
    "@evenrealities/evenhub-cli": "^0.1.12",
    "typescript": "^5.7.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`exclude`가 중요하다. 테스트는 node 타입을 쓰는데 `@types/node`를 설치하지 않는다.

- [ ] **Step 3: `vite.config.ts` 작성**

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  // 실기기 WebView에는 볼 수 있는 콘솔이 없다. POST /__log가 dev server 터미널에 찍는다.
  plugins: [{
    name: 'device-log',
    configureServer(server) {
      server.middlewares.use('/__log', (req, res) => {
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => { console.log('[device]', body); res.end() })
      })
    },
  }],
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
})
```

- [ ] **Step 4: `.gitignore` 확인**

`.env.local`, `node_modules`, `dist`가 들어 있어야 한다. 없으면 추가한다.

- [ ] **Step 5: `index.html`과 `src/main.ts` 최소 버전 작성**

`index.html`은 tiro의 것을 복사하되 폼 내용을 비운다. `<title>Metro</title>`로 바꾸고 `<div id="app">준비 중</div>`만 둔다.

`src/main.ts`는 한 줄이다.

```ts
console.log('metro')
```

- [ ] **Step 6: 설치와 빌드 확인**

Run: `npm install && npm run build`
Expected: 오류 없이 끝난다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "chore: Vite 프로젝트 뼈대

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 역 데이터 받아 번들하기

**Files:**
- Create: `scripts/fetch-stations.mjs`, `src/stations.json`

**Interfaces:**
- Consumes: `.env.local`의 `SEOUL_KEY`
- Produces: `src/stations.json`

```ts
{
  lines: { id: string; name: string }[]        // [{ id: "1002", name: "2호선" }, ...]
  stations: { name: string; line: string; order: number }[]
}
```
`line`은 API가 받는 노선명이다("2호선"). `order`는 노선 내 역 순서다.

- [ ] **Step 1: `scripts/fetch-stations.mjs` 작성**

```js
// 빌드 전에 한 번만 돌린다. 런타임에는 호출하지 않는다.
// 1) 열린데이터광장에서 799개역을 받는다.
// 2) LINE_NUM("01호선")을 실시간 API가 받는 노선명("1호선")으로 바꾼다.
// 3) 노선마다 realtimePosition을 한 번 불러 subwayId를 실제 응답에서 얻는다.
import { readFileSync, writeFileSync } from 'node:fs'

const KEY = readFileSync('.env.local', 'utf8').match(/^SEOUL_KEY=(.+)$/m)?.[1]?.trim()
if (!KEY) throw new Error('.env.local에 SEOUL_KEY가 없습니다')

const json = async url => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url.replace(KEY, '***')}`)
  return res.json()
}

// "01호선" -> "1호선", "경의중앙선" -> "경의중앙선"
const apiLineName = raw => raw.replace(/^0?(\d+)호선$/, '$1호선')

const master = await json(`http://openapi.seoul.go.kr:8088/${KEY}/json/SearchSTNBySubwayLineInfo/1/800/`)
const rows = master.SearchSTNBySubwayLineInfo?.row
if (!rows) throw new Error(JSON.stringify(master).slice(0, 300))

// FR_CODE의 숫자 부분이 노선 내 순서다. "P148" -> 148, "151" -> 151.
const stations = rows.map(r => ({
  name: r.STATION_NM.replace(/\(.*\)$/, ''),   // "공릉(서울산업대입구)" -> "공릉"
  line: apiLineName(r.LINE_NUM),
  order: Number(String(r.FR_CODE).replace(/\D/g, '')),
})).filter(s => Number.isFinite(s.order))

stations.sort((a, b) => a.line.localeCompare(b.line) || a.order - b.order)

// 노선별 subwayId는 실시간 API 응답에서 직접 얻는다. 추측하지 않는다.
const lines = []
for (const name of [...new Set(stations.map(s => s.line))]) {
  try {
    const d = await json(`http://swopenapi.seoul.go.kr/api/subway/${KEY}/json/realtimePosition/0/1/${encodeURIComponent(name)}`)
    const row = d.realtimePositionList?.[0]
    if (row) lines.push({ id: row.subwayId, name: row.subwayNm })
    else console.warn(`운행 열차 없음, 건너뜀: ${name}`)
  } catch (e) {
    console.warn(`실시간 미지원, 건너뜀: ${name} (${e.message})`)
  }
}

writeFileSync('src/stations.json', JSON.stringify({ lines, stations }, null, 0))
console.log(`역 ${stations.length}개, 노선 ${lines.length}개를 저장했습니다.`)
```

- [ ] **Step 2: 실행**

Run: `npm run stations`
Expected: `역 700개 이상, 노선 15개 이상을 저장했습니다.` 형태의 출력.

**운행 시간대(05:30~24:00)에 돌린다.** 노선 ID는 실제 운행 중인 열차 응답에서 얻는다.
막차 이후에는 `운행 열차 없음, 건너뜀`이 쏟아지고 `lines`가 비어 버린다.

실패하면 멈추고 사람에게 알린다. 키가 두 도메인에서 모두 통하는지가 첫 확인 대상이다.
`openapi.seoul.go.kr:8088`이 거부하면 열린데이터광장에서 "서울시 지하철역 정보"를 따로 신청해야 한다.
그때는 `.env.local`에 `SEOUL_STATION_KEY`를 추가하고 스크립트가 그것을 쓰게 고친다.

- [ ] **Step 3: 데이터 눈으로 확인**

Run:
```bash
node -e "
const d=require('./src/stations.json');
const two=d.stations.filter(s=>s.line==='2호선');
console.log('2호선', two.length, two.slice(0,5).map(s=>s.name).join(' '));
console.log('lines', d.lines.map(l=>l.id+':'+l.name).join(' '));
"
```
Expected: 2호선이 50개 안팎이고, 역 이름이 순서대로 나온다.
`lines`에 `1001:1호선`부터 `1009:9호선`까지 9개가 모두 있어야 한다.
하나라도 빠지면 `npm run stations`를 운행 시간대에 다시 돌린다. 빠진 채로 진행하지 않는다.

- [ ] **Step 4: 커밋**

```bash
git add scripts/fetch-stations.mjs src/stations.json
git commit -m "feat: 역 순서와 노선 ID를 정적 데이터로 번들

subwayId는 추측하지 않고 실시간 API 응답에서 얻는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `stations.ts` — 노선별 역 순서와 환승 판정

**Files:**
- Create: `src/stations.ts`, `src/stations.test.ts`

**Interfaces:**
- Consumes: `src/stations.json` (Task 2)
- Produces:
```ts
export type Station = { name: string; line: string; order: number }
export function lineStations(line: string): Station[]   // order 오름차순
export function indexOf(line: string, name: string): number   // 없으면 -1
export function transferLines(name: string): string[]   // 그 역이 속한 모든 노선
export function lineName(subwayId: string): string      // 없으면 ''
export const CIRCULAR: ReadonlySet<string>              // 순환 노선 이름
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/stations.test.ts`:
```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { lineStations, indexOf, transferLines, lineName } from './stations.ts'

test('lineStations는 노선 역을 순서대로 준다', () => {
  const two = lineStations('2호선')
  assert.ok(two.length > 40, `2호선 역이 ${two.length}개뿐입니다`)
  for (let i = 1; i < two.length; i++) assert.ok(two[i].order > two[i - 1].order)
})

test('indexOf는 역 위치를 준다', () => {
  assert.ok(indexOf('2호선', '강남') >= 0)
  assert.equal(indexOf('2호선', '없는역'), -1)
  assert.equal(indexOf('없는노선', '강남'), -1)
})

test('transferLines는 환승역의 모든 노선을 준다', () => {
  assert.ok(transferLines('강남').includes('2호선'))
  assert.ok(transferLines('강남').includes('신분당선'))
  assert.deepEqual(transferLines('없는역'), [])
})

test('lineName은 subwayId를 노선명으로 바꾼다', () => {
  assert.equal(lineName('1002'), '2호선')
  assert.equal(lineName('9999'), '')
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './stations.ts'`

- [ ] **Step 3: 최소 구현 작성**

`src/stations.ts`:
```ts
import data from './stations.json'

export type Station = { name: string; line: string; order: number }

const STATIONS = data.stations as Station[]

// 2호선은 순환한다. 성수지선과 신정지선은 realtimePosition이 statnTnm으로 구분한다.
export const CIRCULAR: ReadonlySet<string> = new Set(['2호선'])

const byLine = new Map<string, Station[]>()
for (const s of STATIONS) {
  const list = byLine.get(s.line) ?? []
  list.push(s)
  byLine.set(s.line, list)
}
for (const list of byLine.values()) list.sort((a, b) => a.order - b.order)

const byName = new Map<string, string[]>()
for (const s of STATIONS) {
  const lines = byName.get(s.name) ?? []
  if (!lines.includes(s.line)) lines.push(s.line)
  byName.set(s.name, lines)
}

const byId = new Map<string, string>(
  (data.lines as { id: string; name: string }[]).map(l => [l.id, l.name]),
)

export const lineStations = (line: string): Station[] => byLine.get(line) ?? []
export const indexOf = (line: string, name: string): number =>
  lineStations(line).findIndex(s => s.name === name)
export const transferLines = (name: string): string[] => byName.get(name) ?? []
export const lineName = (subwayId: string): string => byId.get(subwayId) ?? ''
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 4개

실패하면 `stations.json`의 실제 내용을 보고 테스트의 역 이름을 실제 값으로 고친다.
구현을 비틀어 테스트를 맞추지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add src/stations.ts src/stations.test.ts
git commit -m "feat: 역 순서 조회와 환승 판정

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `route.ts` — 방향과 남은 정거장

**Files:**
- Create: `src/route.ts`, `src/route.test.ts`

**Interfaces:**
- Consumes: `lineStations`, `indexOf`, `CIRCULAR` (Task 3)
- Produces:
```ts
export type Leg = { line: string; from: string; to: string }
export type Route = { name: string; legs: Leg[] }
export type Direction = 0 | 1          // realtimePosition의 updnLine
export function legPath(leg: Leg): string[]      // from..to 역 이름, 양 끝 포함. 불가능하면 []
export function direction(leg: Leg): Direction | null
export function stopsLeft(path: string[], current: string): number   // 모르면 -1
```

`direction`은 `updnLine` 규약을 따른다. `0` = 상행/외선, `1` = 하행/내선.
직선 노선에서는 `order`가 줄면 상행(0), 늘면 하행(1)이다.
순환선에서는 `order`가 늘어나는 쪽이 내선(1), 줄어드는 쪽이 외선(0)이다. 짧은 쪽으로 돈다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/route.test.ts`:
```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { legPath, direction, stopsLeft } from './route.ts'
import { lineStations } from './stations.ts'

const two = lineStations('2호선').map(s => s.name)
const at = (n: number) => two[n]

test('legPath는 두 역 사이 경로를 준다 (order 증가 방향)', () => {
  const path = legPath({ line: '2호선', from: at(3), to: at(7) })
  assert.deepEqual(path, [at(3), at(4), at(5), at(6), at(7)])
})

test('legPath는 반대 방향도 준다', () => {
  const path = legPath({ line: '2호선', from: at(7), to: at(3) })
  assert.deepEqual(path, [at(7), at(6), at(5), at(4), at(3)])
})

test('legPath는 순환선에서 짧은 쪽으로 돈다', () => {
  const n = two.length
  // 끝에서 2번째 -> 1번째: 순환하면 3정거장, 되돌아가면 n-3정거장
  const path = legPath({ line: '2호선', from: at(n - 2), to: at(1) })
  assert.ok(path.length <= 5, `순환하지 않고 ${path.length}개역을 돌았습니다`)
  assert.equal(path[0], at(n - 2))
  assert.equal(path[path.length - 1], at(1))
})

test('legPath는 비순환 노선에서 단순 구간을 준다', () => {
  const three = lineStations('3호선').map(s => s.name)
  const path = legPath({ line: '3호선', from: three[2], to: three[6] })
  assert.deepEqual(path, three.slice(2, 7))
  assert.deepEqual(legPath({ line: '3호선', from: three[6], to: three[2] }), three.slice(2, 7).reverse())
})

test('legPath는 알 수 없는 역에 빈 배열을 준다', () => {
  assert.deepEqual(legPath({ line: '2호선', from: '없는역', to: at(3) }), [])
  assert.deepEqual(legPath({ line: '없는노선', from: at(3), to: at(7) }), [])
  assert.deepEqual(legPath({ line: '2호선', from: at(3), to: at(3) }), [])
})

test('direction은 updnLine 규약을 따른다', () => {
  assert.equal(direction({ line: '2호선', from: at(3), to: at(7) }), 1)
  assert.equal(direction({ line: '2호선', from: at(7), to: at(3) }), 0)
  assert.equal(direction({ line: '2호선', from: '없는역', to: at(7) }), null)
})

test('stopsLeft는 남은 정거장 수를 준다', () => {
  const path = ['A', 'B', 'C', 'D']
  assert.equal(stopsLeft(path, 'A'), 3)
  assert.equal(stopsLeft(path, 'C'), 1)
  assert.equal(stopsLeft(path, 'D'), 0)
  assert.equal(stopsLeft(path, 'Z'), -1)
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './route.ts'`

- [ ] **Step 3: 최소 구현 작성**

`src/route.ts`:
```ts
import { lineStations, indexOf, CIRCULAR } from './stations.ts'

export type Leg = { line: string; from: string; to: string }
export type Route = { name: string; legs: Leg[] }
export type Direction = 0 | 1

// 한 구간의 역 이름을 출발역부터 하차역까지 순서대로 준다.
// 순환선은 짧은 쪽으로 돈다. 알 수 없으면 빈 배열이다.
export function legPath(leg: Leg): string[] {
  const names = lineStations(leg.line).map(s => s.name)
  const a = indexOf(leg.line, leg.from)
  const b = indexOf(leg.line, leg.to)
  if (a < 0 || b < 0 || a === b) return []

  const forward = (b - a + names.length) % names.length   // order 증가 방향으로 도는 거리
  if (!CIRCULAR.has(leg.line)) {
    return a < b ? names.slice(a, b + 1) : names.slice(b, a + 1).reverse()
  }
  const step = forward <= names.length - forward ? 1 : -1
  const count = step === 1 ? forward : names.length - forward
  const path: string[] = []
  for (let i = 0; i <= count; i++) path.push(names[(a + i * step + names.length) % names.length])
  return path
}

// 0 = 상행/외선, 1 = 하행/내선. realtimePosition의 updnLine과 같은 규약이다.
export function direction(leg: Leg): Direction | null {
  const path = legPath(leg)
  if (path.length < 2) return null
  const a = indexOf(leg.line, path[0])
  const b = indexOf(leg.line, path[1])
  const names = lineStations(leg.line).length
  const forward = (b - a + names) % names
  return forward === 1 ? 1 : 0
}

export function stopsLeft(path: string[], current: string): number {
  const i = path.indexOf(current)
  return i < 0 ? -1 : path.length - 1 - i
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (Task 3의 4개 + 여기 6개)

- [ ] **Step 5: 커밋**

```bash
git add src/route.ts src/route.test.ts
git commit -m "feat: 구간 경로, 방향, 남은 정거장 계산

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `route.ts` — 속도와 추정 위치

**Files:**
- Modify: `src/route.ts`
- Modify: `src/route.test.ts`

**Interfaces:**
- Consumes: Task 4의 `legPath`
- Produces:
```ts
export type Fix = { station: string; at: number }   // at = epoch ms
export const DEFAULT_PACE_MS = 120_000              // 관측이 부족할 때 쓰는 역간 소요시간
export const STALE_MS = 180_000                     // 이 시간이 지나면 추정을 멈춘다
export function paceMs(path: string[], fixes: Fix[]): number
export type Guess = { index: number; estimated: number; stale: boolean }
export function locate(path: string[], fixes: Fix[], now: number): Guess | null
```

`locate`의 `index`는 `path` 안의 현재 위치다. `estimated`는 그중 추정으로 민 정거장 수다.
`estimated`가 0이면 화면이 관측(`●`)만 그린다. `stale`이 참이면 화면이 "위치 모름"을 띄운다.

- [ ] **Step 1: 실패하는 테스트 추가**

`src/route.test.ts` 끝에 붙인다:
```ts
import { paceMs, locate, DEFAULT_PACE_MS } from './route.ts'

const PATH = ['A', 'B', 'C', 'D', 'E', 'F']

test('paceMs는 관측에서 역간 소요시간을 구한다', () => {
  const fixes = [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }, { station: 'C', at: 180_000 }]
  assert.equal(paceMs(PATH, fixes), 90_000)
})

test('paceMs는 관측이 부족하면 기본값을 준다', () => {
  assert.equal(paceMs(PATH, []), DEFAULT_PACE_MS)
  assert.equal(paceMs(PATH, [{ station: 'A', at: 0 }]), DEFAULT_PACE_MS)
})

test('paceMs는 같은 역 반복 관측을 무시한다', () => {
  const fixes = [{ station: 'A', at: 0 }, { station: 'A', at: 10_000 }, { station: 'B', at: 60_000 }]
  assert.equal(paceMs(PATH, fixes), 60_000)
})

test('locate는 최근 관측이면 추정하지 않는다', () => {
  const fixes = [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }]
  assert.deepEqual(locate(PATH, fixes, 100_000), { index: 1, estimated: 0, stale: false })
})

test('locate는 신호가 끊기면 관측 속도로 위치를 민다', () => {
  const fixes = [{ station: 'A', at: 0 }, { station: 'B', at: 45_000 }]
  // 마지막 관측에서 100초 지났다. 45초에 한 정거장이므로 2정거장을 민다.
  // STALE_MS(180초) 안이므로 아직 stale이 아니다.
  assert.deepEqual(locate(PATH, fixes, 145_000), { index: 3, estimated: 2, stale: false })
})

test('locate는 추정 중에도 STALE_MS를 넘으면 stale이다', () => {
  const fixes = [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }]
  // 200초 지났다. 2정거장을 밀지만 180초를 넘었으므로 stale이다.
  assert.deepEqual(locate(PATH, fixes, 290_000), { index: 3, estimated: 2, stale: true })
})

test('locate는 경로 끝을 넘지 않는다', () => {
  const fixes = [{ station: 'D', at: 0 }]
  assert.equal(locate(PATH, fixes, 10_000_000)!.index, PATH.length - 1)
})

test('locate는 오래된 관측을 stale로 표시한다', () => {
  const fixes = [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }]
  assert.equal(locate(PATH, fixes, 90_000 + 180_001)!.stale, true)
  assert.equal(locate(PATH, fixes, 90_000 + 179_000)!.stale, false)
})

test('locate는 관측이 없으면 null을 준다', () => {
  assert.equal(locate(PATH, [], 1000), null)
  assert.equal(locate(PATH, [{ station: 'Z', at: 0 }], 1000), null)
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `paceMs is not a function` 계열

- [ ] **Step 3: 구현 추가**

`src/route.ts` 끝에 붙인다:
```ts
export type Fix = { station: string; at: number }

// 관측이 부족할 때 쓰는 값이다. 수도권 평균 역간 소요시간이 대략 2분이다.
export const DEFAULT_PACE_MS = 120_000
// 마지막 관측이 이만큼 오래되면 추정을 멈춘다. 추정이 길어질수록 틀릴 확률이 커진다.
export const STALE_MS = 180_000

// 이 열차 자신이 실제로 낸 속도를 쓴다. 정적 소요시간표를 쓰지 않는다.
export function paceMs(path: string[], fixes: Fix[]): number {
  const seen = fixes.filter(f => path.includes(f.station))
  // 같은 역이 연달아 관측되면 하나로 묶는다. polling이 10초마다 같은 역을 볼 수 있다.
  const uniq = seen.filter((f, i) => i === 0 || f.station !== seen[i - 1].station)
  if (uniq.length < 2) return DEFAULT_PACE_MS
  const first = uniq[0]
  const last = uniq[uniq.length - 1]
  const stops = Math.abs(path.indexOf(last.station) - path.indexOf(first.station))
  if (stops < 1) return DEFAULT_PACE_MS
  return Math.round((last.at - first.at) / stops)
}

export type Guess = { index: number; estimated: number; stale: boolean }

// 마지막 관측 이후 흐른 시간을 관측 속도로 나눠 위치를 앞으로 민다.
export function locate(path: string[], fixes: Fix[], now: number): Guess | null {
  const last = [...fixes].reverse().find(f => path.includes(f.station))
  if (!last) return null
  const base = path.indexOf(last.station)
  const elapsed = now - last.at
  const stale = elapsed > STALE_MS
  const pushed = Math.floor(Math.max(0, elapsed) / paceMs(path, fixes))
  const index = Math.min(base + pushed, path.length - 1)
  return { index, estimated: index - base, stale }
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

### Task 6: `screen.ts` — 화면 문자열과 바이트 한도

**Files:**
- Create: `src/screen.ts`, `src/screen.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 문자열 처리)
- Produces:
```ts
export const PAGE_BYTES = 950
export const ITEM_BYTES = 62
export function bytes(s: string): number
export function progressBar(len: number, index: number, estimated: number, cells?: number): string
export function fitItems(items: string[]): string[]
export type Boxes = { top: string; mid: string; bottom: string }
export function ridingBoxes(a: {
  next: string; stopsLeft: number; paceMs: number; dest: string
  pathLen: number; index: number; estimated: number
  transfer?: { station: string; line: string; stopsAway: number }
  terminal?: string
}): Boxes
export function alertScreen(a: { stopsLeft: number; next: string; dest: string; minutes: number }): string
export function transferScreen(a: { station: string; from: string; to: string; toward: string }): string
export function lostScreen(a: { last: string; agoSec: number; guess: string; stopsLeft: number; bar: string }): string
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/screen.test.ts`:
```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bytes, progressBar, fitItems, ridingBoxes, alertScreen, transferScreen, lostScreen,
  PAGE_BYTES, ITEM_BYTES,
} from './screen.ts'

test('bytes는 UTF-8 바이트를 센다', () => {
  assert.equal(bytes('가'), 3)
  assert.equal(bytes('ab'), 2)
})

test('progressBar는 지나온 역, 추정 역, 남은 역, 하차역을 그린다', () => {
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
  assert.ok(bar.length <= 12 * 2, bar)
})

test('fitItems는 항목과 페이지 바이트 한도를 지킨다', () => {
  const items = Array.from({ length: 5 }, () => '가'.repeat(40))
  const out = fitItems(items)
  assert.equal(out.length, 5)
  assert.ok(out.every(i => bytes(i) <= ITEM_BYTES))
  assert.ok(bytes(out.join('')) <= PAGE_BYTES)
  assert.deepEqual(fitItems(['출근']), ['출근'])
})

test('ridingBoxes는 세 상자를 채우고 한도를 지킨다', () => {
  const b = ridingBoxes({
    next: '역삼', stopsLeft: 4, paceMs: 120_000, dest: '강남',
    pathLen: 7, index: 3, estimated: 0,
    transfer: { station: '교대', line: '3호선', stopsAway: 2 },
  })
  assert.ok(b.top.includes('역삼'))
  assert.ok(b.mid.includes('4'))
  assert.ok(b.mid.includes('강남'))
  assert.ok(b.bottom.includes('교대') && b.bottom.includes('3호선'))
  assert.ok(bytes(b.top + b.mid + b.bottom) <= PAGE_BYTES)
})

test('ridingBoxes는 환승이 없으면 종착역을 보여준다', () => {
  const b = ridingBoxes({
    next: '역삼', stopsLeft: 4, paceMs: 120_000, dest: '강남',
    pathLen: 7, index: 3, estimated: 0, terminal: '성수',
  })
  assert.ok(b.bottom.includes('성수'))
})

test('transferScreen과 lostScreen은 한도를 지키고 복구 경로를 보여준다', () => {
  const t = transferScreen({ station: '교대', from: '2호선', to: '3호선', toward: '경복궁' })
  assert.ok(t.includes('교') && t.includes('3호선') && t.includes('경복궁'))
  assert.ok(bytes(t) <= PAGE_BYTES)

  const l = lostScreen({ last: '선릉', agoSec: 52, guess: '역삼', stopsLeft: 3, bar: progressBar(6, 3, 2) })
  assert.ok(l.includes('선릉') && l.includes('52') && l.includes('역삼'))
  assert.ok(l.includes('탭'), '실패 화면에는 항상 탭 복구 경로가 있어야 합니다')
  assert.ok(bytes(l) <= PAGE_BYTES)
})

test('alertScreen은 남은 정거장에 따라 문구를 바꾼다', () => {
  assert.ok(alertScreen({ stopsLeft: 2, next: '역삼', dest: '강남', minutes: 4 }).includes('다 음 다 음'))
  assert.ok(alertScreen({ stopsLeft: 1, next: '강남', dest: '강남', minutes: 2 }).includes('다 음 에'))
  assert.ok(bytes(alertScreen({ stopsLeft: 2, next: '역삼', dest: '강남', minutes: 4 })) <= PAGE_BYTES)
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
  // 뒤쪽(하차역 방향)이 중요하다. 앞을 줄인다.
  return '⋯' + marks.slice(marks.length - (cells - 1)).join('━')
}

// 목록 항목은 62바이트, 페이지 전체는 950바이트를 넘으면 하드웨어가 거부한다.
export function fitItems(items: string[]): string[] {
  for (let len = ITEM_BYTES; len > 1; len--) {
    const cut = items.map(i => i.slice(0, len))
    if (cut.every(i => bytes(i) <= ITEM_BYTES) && bytes(cut.join('')) <= PAGE_BYTES) return cut
  }
  return items.map(i => i.slice(0, 1))
}

const mins = (ms: number, stops: number) => Math.max(1, Math.round((ms * stops) / 60_000))
// 넓은 자간으로 강조한다. G2는 폰트 크기를 바꿀 수 없다.
const wide = (s: string) => [...s].join(' ')

export type Boxes = { top: string; mid: string; bottom: string }

export function ridingBoxes(a: {
  next: string; stopsLeft: number; paceMs: number; dest: string
  pathLen: number; index: number; estimated: number
  transfer?: { station: string; line: string; stopsAway: number }
  terminal?: string
}): Boxes {
  const top = `\n  다음      ${wide(a.next)}\n`
  const bar = progressBar(a.pathLen, a.index, a.estimated)
  const mid = `  하차까지  ${a.stopsLeft} 정거장 · 약 ${mins(a.paceMs, a.stopsLeft)}분\n  ${bar} ${a.dest}`
  const bottom = a.transfer
    ? `  ${a.transfer.station}에서 ${a.transfer.line} 갈아탐 (${a.transfer.stopsAway}정거장 뒤)`
    : `  ${a.terminal ?? a.dest}행`
  return { top, mid, bottom }
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

### Task 7: `api.ts` — 서울 API 호출과 파싱

**Files:**
- Create: `src/api.ts`, `src/api.test.ts`

**Interfaces:**
- Consumes: `lineName` (Task 3), `Direction` (Task 4)
- Produces:
```ts
export type TrainPos = {
  trainNo: string; station: string; updn: Direction
  status: number         // 0=진입, 1=도착, 2=출발
  express: boolean; terminal: string; at: number   // at = epoch ms
}
export type Arrival = {
  trainNo: string; station: string; line: string; updn: Direction
  etaSec: number; msg: string; toward: string; express: boolean
}
export function parsePositions(body: unknown): TrainPos[]
export function parseArrivals(body: unknown): Arrival[]
export function positions(key: string, line: string): Promise<TrainPos[]>
export function arrivals(key: string, station: string): Promise<Arrival[]>
```

**중요한 함정:** 두 API가 `updnLine`을 다르게 쓴다.
`realtimePosition`은 `"0"` / `"1"`이고, `realtimeStationArrival`은 `"상행"` / `"하행"`이다.
`parse*`가 둘 다 `Direction`(0 또는 1)으로 정규화한다. 상행·외선이 0이고 하행·내선이 1이다.

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
  assert.equal(a.updn, 0)
  assert.equal(a.status, 1)
  assert.equal(a.express, false)
  assert.equal(a.terminal, '성수종착')
  assert.ok(a.at > 0)
  assert.equal(b.updn, 1)
  assert.equal(b.express, true)
})

test('parseArrivals는 한글 updnLine을 숫자로 바꾼다', () => {
  const [a, b] = parseArrivals(ARR)
  assert.equal(a.updn, 0, '상행은 0이어야 합니다')
  assert.equal(b.updn, 1, '하행은 1이어야 합니다')
  assert.equal(a.trainNo, '0146')
  assert.equal(a.line, '1호선')
  assert.equal(a.toward, '광운대')
  assert.equal(b.etaSec, 180)
  assert.equal(b.express, true)
})

test('파서는 빈 응답과 오류 응답에 빈 배열을 준다', () => {
  assert.deepEqual(parsePositions({}), [])
  assert.deepEqual(parseArrivals({}), [])
  assert.deepEqual(parsePositions({ status: 500, code: 'ERROR-336' }), [])
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
import type { Direction } from './route.ts'

// API는 http 전용이다. https는 응답하지 않는다(2026-09-20 실측).
const POS_BASE = 'http://swopenapi.seoul.go.kr/api/subway'

export type TrainPos = {
  trainNo: string; station: string; updn: Direction
  status: number; express: boolean; terminal: string; at: number
}

export type Arrival = {
  trainNo: string; station: string; line: string; updn: Direction
  etaSec: number; msg: string; toward: string; express: boolean
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
  // 반환 타입을 명시한다. 없으면 updn이 0|1 대신 number로 넓어질 수 있다.
  return rows(body, 'realtimePositionList').map((r): TrainPos => ({
    trainNo: String(r.trainNo ?? ''),
    station: String(r.statnNm ?? ''),
    updn: r.updnLine === '1' ? 1 : 0,
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
    // 도착 API는 updnLine을 한글로 준다. 위치 API는 "0"/"1"로 준다.
    updn: String(r.updnLine).startsWith('하') || String(r.updnLine).includes('내선') ? 1 : 0,
    etaSec: Number(r.barvlDt ?? 0),
    msg: String(r.arvlMsg2 ?? ''),
    // "광운대행 - 시청방면" -> "광운대"
    toward: String(r.trainLineNm ?? '').split('행')[0].trim(),
    express: String(r.btrainSttus ?? '').includes('급행'),
  }))
}

const get = async (url: string): Promise<unknown> => {
  const res = await fetch(url)
  if (res.status === 401 || res.status === 403) throw new Error('API key가 거부됐습니다')
  if (!res.ok) throw new Error(`서울 API ${res.status}`)
  return res.json()
}

export const positions = async (key: string, line: string): Promise<TrainPos[]> =>
  parsePositions(await get(`${POS_BASE}/${key}/json/realtimePosition/0/200/${encodeURIComponent(line)}`))

export const arrivals = async (key: string, station: string): Promise<Arrival[]> =>
  parseArrivals(await get(`${POS_BASE}/${key}/json/realtimeStationArrival/0/40/${encodeURIComponent(station)}`))
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전체

- [ ] **Step 5: 실제 키로 한 번 확인**

Run:
```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs'
const KEY = readFileSync('.env.local','utf8').match(/^SEOUL_KEY=(.+)\$/m)[1].trim()
const r = await (await fetch(\`http://swopenapi.seoul.go.kr/api/subway/\${KEY}/json/realtimePosition/0/200/2호선\`)).json()
console.log('열차', r.realtimePositionList?.length, '전체', r.errorMessage?.total)
"
```
Expected: `열차 30 전체 30` 형태. `sample` 키의 5건 제한이 풀렸는지 여기서 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add src/api.ts src/api.test.ts
git commit -m "feat: 서울 실시간 API 호출과 응답 정규화

두 API가 updnLine을 다르게 쓴다. 위치는 0/1, 도착은 상행/하행이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 폰 설정 화면 (`index.html`)

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Route`, `Leg` (Task 4)
- Produces: `bridge.setLocalStorage('seoulKey' | 'routes', ...)`에 저장된 설정

경로 입력은 한 줄 텍스트로 받는다. 위젯을 만들지 않는다.
형식: `이름 | 노선,출발역,하차역 | 노선,출발역,하차역`

예: `출근 | 2호선,잠실,교대 | 3호선,교대,경복궁`

- [ ] **Step 1: `index.html` 작성**

`../tiro/index.html`의 `<style>`을 그대로 쓴다. 본문만 바꾼다.

```html
<form id="app">
  <div>
    <p>서울 열린데이터광장 API key (data.seoul.go.kr)<br />
      "지하철 실시간 열차 위치정보"와 "실시간 도착정보"를 신청하세요.</p>
    <input id="key" type="password" autocomplete="off" placeholder="인증키"
           style="width: 100%; padding: 10px; box-sizing: border-box" />
    <p>경로 (한 줄에 하나, 최대 5개)<br />
      <code>이름 | 노선,출발역,하차역 | 노선,출발역,하차역</code></p>
    <textarea id="routes" rows="6" placeholder="출근 | 2호선,잠실,교대 | 3호선,교대,경복궁"
              style="width: 100%; padding: 10px; box-sizing: border-box"></textarea>
    <p style="opacity: 0.7">key 칸이 비어 있으면 저장된 key를 그대로 둡니다.</p>
    <button style="margin-top: 12px; padding: 10px 24px">저장</button>
    <p id="status"></p>
  </div>
</form>
<script type="module" src="/src/main.ts"></script>
```

- [ ] **Step 2: 경로 파서 테스트를 `screen.test.ts`가 아닌 새 파일에 추가**

`src/routes.test.ts`:
```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoutes, formatRoutes } from './routes.ts'

test('parseRoutes는 한 줄을 Route로 바꾼다', () => {
  assert.deepEqual(parseRoutes('출근 | 2호선,잠실,교대 | 3호선,교대,경복궁'), [{
    name: '출근',
    legs: [
      { line: '2호선', from: '잠실', to: '교대' },
      { line: '3호선', from: '교대', to: '경복궁' },
    ],
  }])
})

test('parseRoutes는 빈 줄과 잘못된 줄을 버린다', () => {
  assert.deepEqual(parseRoutes('\n\n  \n망가진줄\n'), [])
  assert.deepEqual(parseRoutes('이름만 | 2호선,잠실'), [])
})

test('parseRoutes는 5개까지만 받는다', () => {
  const line = '출근 | 2호선,잠실,교대'
  assert.equal(parseRoutes(Array(9).fill(line).join('\n')).length, 5)
})

test('formatRoutes는 parseRoutes의 역이다', () => {
  const text = '출근 | 2호선,잠실,교대 | 3호선,교대,경복궁'
  assert.equal(formatRoutes(parseRoutes(text)), text)
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './routes.ts'`

- [ ] **Step 4: `src/routes.ts` 작성**

```ts
import type { Route, Leg } from './route.ts'

export const MAX_ROUTES = 5

// "출근 | 2호선,잠실,교대 | 3호선,교대,경복궁"
export function parseRoutes(text: string): Route[] {
  const out: Route[] = []
  for (const raw of text.split('\n')) {
    const parts = raw.split('|').map(p => p.trim()).filter(Boolean)
    if (parts.length < 2) continue
    const [name, ...legParts] = parts
    const legs: Leg[] = []
    for (const p of legParts) {
      const [line, from, to] = p.split(',').map(s => s.trim())
      if (!line || !from || !to) { legs.length = 0; break }
      legs.push({ line, from, to })
    }
    if (legs.length) out.push({ name, legs })
    if (out.length === MAX_ROUTES) break
  }
  return out
}

export const formatRoutes = (routes: Route[]): string =>
  routes.map(r => [r.name, ...r.legs.map(l => `${l.line},${l.from},${l.to}`)].join(' | ')).join('\n')
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS 전체

- [ ] **Step 6: `src/main.ts`를 아래 내용으로 통째로 바꾼다**

Task 1의 한 줄짜리 `main.ts`를 버린다. `../tiro/src/main.ts`의 맨 아래 폼 처리와 같은 모양이다.
```ts
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { parseRoutes, formatRoutes } from './routes.ts'
import type { Route } from './route.ts'

const log = (...a: unknown[]) => {
  if (import.meta.env.DEV) navigator.sendBeacon('/__log', a.map(String).join(' '))
}
window.addEventListener('error', e => log('error', e.message))
window.addEventListener('unhandledrejection', e => log('rejection', e.reason))

const bridge = await waitForEvenAppBridge()

let apiKey = (await bridge.getLocalStorage('seoulKey')) ?? ''
let routes: Route[] = parseRoutes((await bridge.getLocalStorage('routes')) ?? '')

const status = document.querySelector<HTMLElement>('#status')!
const keyField = document.querySelector<HTMLInputElement>('#key')!
const routeField = document.querySelector<HTMLTextAreaElement>('#routes')!

const showStatus = () => {
  status.textContent = `key: ${apiKey ? '저장됨' : '없음'} · 경로 ${routes.length}개`
}
routeField.value = formatRoutes(routes)
showStatus()

document.querySelector<HTMLFormElement>('#app')!.addEventListener('submit', async e => {
  e.preventDefault()
  apiKey = keyField.value.trim() || apiKey
  routes = parseRoutes(routeField.value)
  await bridge.setLocalStorage('seoulKey', apiKey)
  await bridge.setLocalStorage('routes', formatRoutes(routes))
  keyField.value = ''
  routeField.value = formatRoutes(routes)
  showStatus()
})
```

- [ ] **Step 7: 빌드 확인**

Run: `npm run build`
Expected: 오류 없이 끝난다.

- [ ] **Step 8: 커밋**

```bash
git add index.html src/main.ts src/routes.ts src/routes.test.ts
git commit -m "feat: 폰 설정 화면에서 key와 경로 5개를 저장

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: G2 화면 그리기와 IDLE 상태

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `fitItems`, `PAGE_BYTES` (Task 6), `routes` (Task 8)
- Produces:
```ts
function boxPage(b: Boxes): object       // 텍스트 컨테이너 3개
function fullPage(content: string): object   // 텍스트 컨테이너 1개
function listPage(items: string[]): object
async function showBoxes(b: Boxes): Promise<void>
async function showFull(content: string): Promise<void>
async function showIdle(): Promise<void>
```

- [ ] **Step 1: 컨테이너 생성 함수 추가**

`src/main.ts`에 추가한다. 좌표는 spec §7.1이다.
```ts
import {
  TextContainerProperty, ListContainerProperty, ListItemContainerProperty,
  CreateStartUpPageContainer, RebuildPageContainer, OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { fitItems, bytes, type Boxes } from './screen.ts'

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
```

- [ ] **Step 2: 화면 표시 함수 추가**

반환값을 확인한다. tiro는 이것을 빼먹어 화면이 멈췄다.
```ts
async function showFull(content: string): Promise<void> {
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(fullPage(content)))
  log('full', ok, 'bytes', bytes(content))
  if (!ok) await bridge.rebuildPageContainer(new RebuildPageContainer(
    fullPage('화면을 표시하지 못했습니다.\n탭: 처음으로 · 더블탭: 종료')))
}

async function showBoxes(b: Boxes): Promise<void> {
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(boxPage(b)))
  log('boxes', ok, 'bytes', bytes(b.top + b.mid + b.bottom))
  if (!ok) await showFull(`${b.top}\n${b.mid}\n${b.bottom}`)   // 상자가 거부되면 한 상자로 떨어뜨린다
}
```

- [ ] **Step 3: 상태와 IDLE 화면 추가**

```ts
type Mode = 'idle' | 'pick' | 'riding' | 'transfer' | 'arrived'
let mode: Mode = 'idle'
let rows: string[] = []          // 현재 목록 화면의 행 의미
let busy = false

const NO_SETUP = '폰 화면에서 API key와 경로를 넣으세요.\n더블탭: 종료'

async function showIdle(): Promise<void> {
  mode = 'idle'
  if (!apiKey || !routes.length) return showFull(NO_SETUP)
  rows = routes.map(r => r.name)
  const items = fitItems(routes.map(r => `${r.name}  ${r.legs[0].from} → ${r.legs[r.legs.length - 1].to}`))
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(listPage(items)))
  log('idle list', ok, items.length)
  if (!ok) { rows = []; await showFull('경로 목록을 표시하지 못했습니다.\n탭: 다시 시도 · 더블탭: 종료') }
}

const started = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer(fullPage('경로를 불러오는 중...')))
log('startup', started, location.href)
await showIdle()
```

폼 `submit` 처리 끝에 `await showIdle()`을 넣는다. 저장하면 G2 화면이 곧바로 갱신된다.

- [ ] **Step 4: 이벤트 처리 추가**

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
      if (mode === 'idle') await bridge.shutDownPageContainer(1)
      else await showIdle()
    } else if (type === OsEventTypeList.CLICK_EVENT) {
      // 하드웨어가 첫 항목의 currentSelectItemIndex를 생략한다
      const i = event.listEvent?.currentSelectItemIndex ?? 0
      await onTap(i)
    }
  } catch (e) {
    log('event failed', e)
    await showFull(`오류\n${e}\n탭: 처음으로 · 더블탭: 종료`)
    mode = 'idle'
  } finally {
    busy = false
  }
})

async function onTap(index: number): Promise<void> {
  if (mode === 'idle') {
    if (!rows.length) return showIdle()
    const r = routes[index]
    log('route picked', r.name)
    // Task 10이 이 자리를 열차 고르기로 바꾼다. 지금은 고른 결과를 보여주기만 한다.
    mode = 'pick'
    rows = []
    await showFull(`${r.name}\n${r.legs[0].line} ${r.legs[0].from} → ${r.legs[0].to}\n탭: 처음으로 · 더블탭: 종료`)
  }
}
```

- [ ] **Step 5: 빌드와 실기기 확인**

Run: `npm run build && npm run dev`
그 다음 G2 앱에서 QR을 스캔한다. 폰에서 key와 경로를 넣고 저장한다.

Expected: G2에 경로 목록이 보인다. 경로를 탭하면 그 경로의 첫 구간이 보인다.
dev server 터미널에 `[device] idle list 1 1`과 `[device] route picked 출근`이 찍힌다.

`idle list 0` 또는 `false`가 찍히면 `fitItems`가 줄인 결과를 로그로 찍어 바이트 한도를 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add src/main.ts
git commit -m "feat: G2 경로 목록 화면과 이벤트 처리

상자 3개 페이지와 전체 화면 페이지를 만든다. rebuild 반환값을 항상 확인한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: PICK_TRAIN — 탈 열차 고르기

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `arrivals` (Task 7), `direction`, `legPath` (Task 4), `fitItems` (Task 6)
- Produces:
```ts
let route: Route | null
let legIndex: number
let path: string[]
let trainNo: string
async function showPick(): Promise<void>
```

- [ ] **Step 1: 상태 변수와 `showPick` 추가**

```ts
// 쓰지 않는 import는 tsconfig의 noUnusedLocals 때문에 빌드를 깬다.
// Task 11이 positions, locate, paceMs, stopsLeft, Fix를 추가한다.
import { arrivals, type Arrival } from './api.ts'
import { legPath, direction, type Route } from './route.ts'

let route: Route | null = null
let legIndex = 0
let path: string[] = []
let trainNo = ''
let candidates: Arrival[] = []

const leg = () => route!.legs[legIndex]

async function startLeg(r: Route, i: number): Promise<void> {
  route = r
  legIndex = i
  path = legPath(r.legs[i])
  trainNo = ''
  if (!path.length) {
    mode = 'idle'
    return showFull(`경로를 찾지 못했습니다.\n${r.legs[i].line} ${r.legs[i].from} → ${r.legs[i].to}\n역 이름을 확인하세요.\n탭: 처음으로`)
  }
  await showPick()
}

async function showPick(): Promise<void> {
  mode = 'pick'
  await showFull(`${leg().from}\n도착 열차를 확인하는 중...`)
  const want = direction(leg())
  const all = await arrivals(apiKey, leg().from)
  // 같은 노선, 같은 방향만 남긴다. 옆 선로 열차를 잡으면 안내가 통째로 틀린다.
  candidates = all
    .filter(a => a.line === leg().line && a.updn === want && a.trainNo)
    .sort((a, b) => a.etaSec - b.etaSec)
    .slice(0, 18)
  log('candidates', candidates.length, 'want', want, 'line', leg().line)

  if (!candidates.length) {
    rows = []
    return showFull(`${leg().from}\n${leg().to} 방면 도착 정보가 없습니다.\n탭: 다시 확인 · 더블탭: 처음으로`)
  }
  if (candidates.length === 1) return board(candidates[0].trainNo)

  rows = candidates.map(a => a.trainNo)
  const items = fitItems(candidates.map(a =>
    `${a.toward}행 ${a.express ? '급행 ' : ''}${a.etaSec > 0 ? `${Math.round(a.etaSec / 60)}분` : a.msg}`))
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(listPage(items)))
  if (!ok) { rows = []; await showFull('열차 목록을 표시하지 못했습니다.\n탭: 다시 확인') }
}
```

- [ ] **Step 2: `onTap`에 배선**

```ts
async function onTap(index: number): Promise<void> {
  if (mode === 'idle') {
    if (!rows.length) return showIdle()
    return startLeg(routes[index], 0)
  }
  if (mode === 'pick') {
    if (!rows.length) return showPick()       // 실패 화면에서 탭하면 다시 확인
    return board(rows[index])
  }
}
```

- [ ] **Step 3: `board` 자리표시자 추가**

```ts
async function board(no: string): Promise<void> {
  trainNo = no
  log('boarded', no, leg().line)
  mode = 'riding'
  await showFull(`${no}번 열차\n추적을 시작합니다...`)
  // Task 11에서 polling을 붙인다
}
```

- [ ] **Step 4: 빌드와 실기기 확인**

Run: `npm run build && npm run dev`
승강장이 아니어도 확인할 수 있다. 경로의 출발역에 실제로 열차가 들어오는 시간대에 연다.

Expected: 경로를 탭하면 열차 목록이 뜬다. 터미널에 `[device] candidates 2 want 1 line 2호선`이 찍힌다.

`candidates 0`이 나오면 `all`의 원본 `line`과 `updn`을 로그로 찍어 필터가 무엇을 버렸는지 본다.
`lineName`이 빈 문자열을 주면 `stations.json`의 `lines`에 그 노선이 빠진 것이다.

- [ ] **Step 5: 커밋**

```bash
git add src/main.ts
git commit -m "feat: 승강장에서 탈 열차 고르기

같은 노선 같은 방향만 남긴다. 후보가 1대면 자동으로 탑승 처리한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: RIDING — 열차 추적과 동행 화면

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `positions` (Task 7), `locate`, `paceMs`, `stopsLeft` (Task 4, 5), `ridingBoxes`, `progressBar`, `lostScreen` (Task 6)
- Produces:
```ts
const POLL_MS = 10_000
let fixes: Fix[]
async function poll(): Promise<void>
async function render(): Promise<void>
```

- [ ] **Step 1: polling과 그리기 추가**

```ts
import { ridingBoxes, alertScreen, transferScreen, lostScreen, progressBar } from './screen.ts'
import { positions } from './api.ts'
import { locate, paceMs, stopsLeft, type Fix } from './route.ts'

const POLL_MS = 10_000
let fixes: Fix[] = []
let pollTimer: ReturnType<typeof setTimeout> | null = null
let lastMiss = 0        // trainNo를 못 찾은 연속 횟수

function stopPolling(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

async function poll(): Promise<void> {
  if (mode !== 'riding') return
  if (!busy) {
    try {
      const all = await positions(apiKey, leg().line)
      const me = all.find(t => t.trainNo === trainNo)
      if (me && path.includes(me.station)) {
        lastMiss = 0
        const last = fixes[fixes.length - 1]
        if (!last || last.station !== me.station) fixes.push({ station: me.station, at: me.at })
      } else {
        lastMiss += 1
        log('train missing', trainNo, 'miss', lastMiss)
      }
      await render()
    } catch (e) {
      log('poll failed', e)   // 일시적 실패는 화면을 바꾸지 않는다. render가 추정으로 처리한다
      await render()
    }
  }
  if (mode === 'riding') pollTimer = setTimeout(poll, POLL_MS)
}

async function render(): Promise<void> {
  const now = Date.now()
  const guess = locate(path, fixes, now)
  if (!guess) return showFull(`${trainNo}번 열차\n위치를 아직 못 찾았습니다.\n탭: 열차 다시 고르기`)

  const left = stopsLeft(path, path[guess.index])
  const pace = paceMs(path, fixes)
  const lastFix = fixes[fixes.length - 1]

  if (left <= 0) return arrive()
  if (guess.stale) {
    return showFull(lostScreen({
      last: lastFix.station,
      agoSec: Math.round((now - lastFix.at) / 1000),
      guess: path[guess.index],
      stopsLeft: left,
      bar: progressBar(path.length, guess.index, guess.estimated),
    }))
  }
  if (left <= 2) {
    return showFull(alertScreen({
      stopsLeft: left,
      next: path[guess.index + 1],
      dest: path[path.length - 1],
      minutes: Math.max(1, Math.round((pace * left) / 60_000)),
    }))
  }

  const nextLeg = route!.legs[legIndex + 1]
  await showBoxes(ridingBoxes({
    next: path[guess.index + 1],
    stopsLeft: left,
    paceMs: pace,
    dest: path[path.length - 1],
    pathLen: path.length,
    index: guess.index,
    estimated: guess.estimated,
    transfer: nextLeg
      ? { station: leg().to, line: nextLeg.line, stopsAway: left }
      : undefined,
    terminal: nextLeg ? undefined : path[path.length - 1],
  }))
}
```

- [ ] **Step 2: `board`를 완성하고 `arrive`를 추가**

```ts
async function board(no: string): Promise<void> {
  trainNo = no
  fixes = []
  lastMiss = 0
  mode = 'riding'
  log('boarded', no, leg().line)
  await showFull(`${no}번 열차\n추적을 시작합니다...`)
  stopPolling()
  await poll()
}

async function arrive(): Promise<void> {
  stopPolling()
  const nextLeg = route!.legs[legIndex + 1]
  if (nextLeg) {
    mode = 'transfer'
    rows = []
    return showFull(transferScreen({
      station: leg().to, from: leg().line, to: nextLeg.line,
      toward: nextLeg.to,
    }))
  }
  mode = 'arrived'
  rows = []
  await showFull(`\n\n     ${[...path[path.length - 1]].join(' ')}\n\n     도착했습니다.\n\n     탭: 처음으로 · 더블탭: 종료`)
}
```

- [ ] **Step 3: `onTap`과 더블탭에 배선**

```ts
async function onTap(index: number): Promise<void> {
  if (mode === 'idle') {
    if (!rows.length) return showIdle()
    return startLeg(routes[index], 0)
  }
  if (mode === 'pick') return rows.length ? board(rows[index]) : showPick()
  if (mode === 'riding') return showPick()          // 엉뚱한 열차를 잡았을 때 다시 고른다
  if (mode === 'transfer') return startLeg(route!, legIndex + 1)
  if (mode === 'arrived') return showIdle()
}
```

더블탭 처리에서 `showIdle()` 앞에 `stopPolling()`을 넣는다. 목록으로 나가면 polling을 멈춘다.

- [ ] **Step 4: 빌드와 실기기 확인 (실제 탑승)**

Run: `npm run build && npm run dev`

실제로 지하철을 탄다. 확인할 것은 넷이다.
1. 상자 3개 화면이 팔 뻗은 거리에서 읽히는가
2. 역을 지날 때 `다음` 역 이름이 바뀌는가 (터미널에 `[device] boxes 1 bytes ...`)
3. 하차 2정거장 전에 전체 화면으로 바뀌는가
4. 지하 구간에서 `poll failed`가 얼마나 자주 찍히는가

- [ ] **Step 5: 커밋**

```bash
git add src/main.ts
git commit -m "feat: 열차 추적과 동행 화면

10초마다 탄 열차의 위치를 읽는다. 신호가 끊기면 관측 속도로 추정하고 추정이라고 표시한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `app.json`과 실기기 마무리

**Files:**
- Create: `app.json`
- Modify: `.agent/context.md`

**Interfaces:**
- Consumes: 없음
- Produces: `evenhub pack` 검증을 통과하는 매니페스트

- [ ] **Step 1: `app.json` 작성**

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
    {
      "name": "network",
      "desc": "서울시 지하철 실시간 도착·열차 위치 정보를 본인의 API key로 조회합니다.",
      "whitelist": [
        "http://swopenapi.seoul.go.kr"
      ]
    }
  ],
  "supported_languages": ["ko", "en"]
}
```

`openapi.seoul.go.kr:8088`은 whitelist에 넣지 않는다. 빌드 시점에만 쓴다.

- [ ] **Step 2: 매니페스트 검증**

Run: `npm run pack`
Expected: `out.ehpk`가 만들어진다.

`min_app_version`이 SDK 하한으로 올라가는 것은 정상이다(tiro 확인).

- [ ] **Step 3: 전체 테스트와 빌드**

Run: `npm test && npm run build`
Expected: 모든 테스트 PASS, 빌드 성공.

- [ ] **Step 4: `.agent/context.md`에 마무리 기록**

실기기에서 새로 알게 된 것만 적는다. 계획에 이미 있는 내용은 적지 않는다.
최소한 다음 네 가지의 실측 결과를 적는다.
1. 상자 3개 레이아웃의 실제 가독성
2. 각 화면의 실제 바이트 수
3. 코레일 직결 구간에서 `trainNo`가 유지되는가
4. 지하 구간의 polling 실패율

- [ ] **Step 5: 커밋**

```bash
git add app.json .agent/context.md
git commit -m "feat: Even Hub 매니페스트와 실기기 검증 기록

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 알려진 미해결

이 계획은 다음을 해결하지 않는다. spec §12와 같다.

1. `.ehpk` private build의 페이지 scheme. https면 http API가 mixed content로 차단된다. 1차는 QR sideload로 쓴다.
2. 코레일 직결 구간의 `trainNo` 연속성. Task 11 Step 4에서 실측한다. 끊기면 재탐색 로직이 필요하다.
3. 서울 API의 rate limit 수치. `poll failed`가 잦으면 `POLL_MS`를 15초로 올린다.
4. 이미 탑승한 상태로 앱을 여는 경우. 1차는 승강장에서 시작하는 것만 지원한다.
