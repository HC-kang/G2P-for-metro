import {
  waitForEvenAppBridge,
  TextContainerProperty, ListContainerProperty, ListItemContainerProperty,
  CreateStartUpPageContainer, RebuildPageContainer, OsEventTypeList,
  AppLocationAccuracy,
} from '@evenrealities/even_hub_sdk'
import { COORDS, NAMES, transferLines, arrivalName } from './stations.ts'
import { plan, planVia, locate, paceMs, stopsLeft, DEFAULT_PACE_MS, type Plan, type Fix } from './route.ts'
import { nearest, MAX_ACCURACY_M, type Near } from './geo.ts'
import { arrivals, positions, remoteLog, ApiError, type Arrival } from './api.ts'
import { lineShort, lineColor } from './lines.ts'
import * as S from './screen.ts'

const log = (...a: unknown[]) => {
  const msg = a.map(String).join(' ')
  // 같은 Wi-Fi에 있을 때는 dev server 터미널에, 아닐 때도 볼 수 있게 워커에도 보낸다.
  if (import.meta.env?.DEV) navigator.sendBeacon('/__log', msg)
  remoteLog(msg)
}
window.addEventListener('error', e => log('error', e.message))
window.addEventListener('unhandledrejection', e => log('rejection', e.reason))

const bridge = await waitForEvenAppBridge()

// ---------- G2 화면 ----------
// 화면 하나에 컨테이너 하나를 꽉 채운다. 테두리 상자를 쌓지 않는다.
// 위계는 여백, 자간, 가로줄 하나가 만든다.

const full = (content: string) => ({
  containerTotalNum: 1,
  textObject: [new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, paddingLength: 8,
    containerID: 1, containerName: 'main',
    content, isEventCapture: 1,
  })],
})

const listOf = (items: string[]) => ({
  containerTotalNum: 1,
  listObject: [new ListContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, paddingLength: 8,
    containerID: 1, containerName: 'rows',
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length, itemWidth: 560, isItemSelectBorderEn: 1, itemName: items,
    }),
    isEventCapture: 1,
  })],
})

// 반환값을 확인한다. tiro는 이것을 빼먹어 화면이 멈췄다.
async function show(content: string): Promise<void> {
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(full(content)))
  log('show', ok, 'bytes', S.bytes(content))
  if (!ok) {
    await bridge.rebuildPageContainer(new RebuildPageContainer(
      full(S.notice(Date.now(), '화면을 표시하지 못했습니다', '', '탭: 처음으로\n  더블탭: 종료'))))
  }
}

async function showList(items: string[]): Promise<boolean> {
  const fitted = S.fitsAll(items) ? items : S.fitItems(items)
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(listOf(fitted)))
  log('list', ok, 'count', fitted.length, 'bytes', S.bytes(fitted.join('')))
  return !!ok
}

// ---------- 저장 ----------

// G2 목록 위젯이 한 화면에 20항목까지 보여준다. 그것이 유일한 한도다.
// 항목 하나가 약 34바이트라 20개를 넣어도 페이지 한도 950바이트 안에 든다.
const MAX_DESTS = 20
const parseLines = (t: string, max: number) =>
  t.split('\n').map(s => s.trim()).filter(Boolean).slice(0, max)

let dests = parseLines((await bridge.getLocalStorage('destinations')) ?? '', MAX_DESTS)
let recents = parseLines((await bridge.getLocalStorage('recentOrigins')) ?? '', 5)
const savedQuota = ((await bridge.getLocalStorage('quota')) ?? '').split(':')

const saveDests = () => bridge.setLocalStorage('destinations', dests.join('\n'))

async function rememberOrigin(name: string): Promise<void> {
  recents = [name, ...recents.filter(r => r !== name)].slice(0, 5)
  await bridge.setLocalStorage('recentOrigins', recents.join('\n'))
}

// ---------- 폰 설정 화면 ----------
// 역 이름을 치면 바로 검증한다. 오타는 저장되기 전에 잡힌다.

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
const listEl = $('#list')
const countEl = $('#count')
const noteEl = $('#note')
const hitsEl = $('#hits')
const qEl = $<HTMLInputElement>('#q')
const goEl = $<HTMLButtonElement>('#go')

// G2 목록용 노선 표기. 항목 한도는 62바이트다.
// 노선 2개까지는 전체 이름이 들어간다. 3개 이상인 역 4개만 짧은 이름을 쓴다.
const lineLabel = (name: string): string => {
  const lines = transferLines(name)
  return lines.length <= 2 ? lines.join('·') : lines.map(lineShort).join('·')
}

const badge = (line: string) => {
  const el = document.createElement('span')
  el.className = 'badge'
  el.textContent = lineShort(line)
  el.style.background = lineColor(line)
  return el
}

function renderDests(): void {
  listEl.replaceChildren()
  countEl.textContent = dests.length >= MAX_DESTS
    ? `${dests.length}곳 · G2 목록이 가득 찼습니다`
    : dests.length ? `${dests.length}곳` : ''
  if (!dests.length) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = '아직 없습니다. 아래에 역 이름을 넣으세요.'
    listEl.append(li)
  }
  for (const name of dests) {
    const lines = transferLines(name)
    const li = document.createElement('li')
    if (!lines.length) li.className = 'missing'

    const drop = document.createElement('button')
    drop.className = 'drop'
    drop.type = 'button'
    drop.textContent = '×'
    drop.setAttribute('aria-label', `${name} 지우기`)
    drop.addEventListener('click', async () => {
      dests = dests.filter(d => d !== name)
      await saveDests()
      renderDests()
      await showOrigin()
    })

    const nm = document.createElement('span')
    nm.className = 'name'
    nm.textContent = name

    li.append(drop, nm)
    if (lines.length) {
      const b = document.createElement('span')
      b.className = 'badges'
      for (const l of lines) b.append(badge(l))
      li.append(b)
    } else {
      const why = document.createElement('span')
      why.className = 'why'
      why.textContent = '찾을 수 없음'
      li.append(why)
    }
    listEl.append(li)
  }
  noteEl.textContent = dests.some(d => !transferLines(d).length)
    ? '찾을 수 없는 역은 안내에 쓰이지 않습니다. 인천·김포·용인·의정부 노선은 실시간 정보가 없습니다.'
    : ''
  qEl.placeholder = dests.length >= MAX_DESTS ? '가득 찼습니다' : '역 이름'
}

function renderHits(): void {
  const q = qEl.value.trim()
  goEl.disabled = !q || dests.includes(q) || dests.length >= MAX_DESTS
  hitsEl.replaceChildren()
  if (!q) return
  const hits = NAMES.filter(n => n.startsWith(q) && !dests.includes(n)).slice(0, 6)
  for (const name of hits) {
    const li = document.createElement('li')
    li.tabIndex = 0
    const nm = document.createElement('span')
    nm.className = 'name'
    nm.textContent = name
    const b = document.createElement('span')
    b.className = 'badges'
    for (const l of transferLines(name)) b.append(badge(l))
    li.append(nm, b)
    const pick = () => add(name)
    li.addEventListener('click', pick)
    li.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') pick() })
    hitsEl.append(li)
  }
}

async function add(name: string): Promise<void> {
  if (!name || dests.includes(name) || dests.length >= MAX_DESTS) return
  dests = [...dests, name]
  await saveDests()
  qEl.value = ''
  renderHits()
  renderDests()
  await showOrigin()
}

qEl.addEventListener('input', renderHits)
$<HTMLFormElement>('#add').addEventListener('submit', async e => {
  e.preventDefault()
  const q = qEl.value.trim()
  // 정확히 맞는 역이 없으면 첫 후보를 넣는다. 오타로 빈 항목이 생기지 않는다.
  await add(NAMES.includes(q) ? q : (NAMES.find(n => n.startsWith(q)) ?? q))
})
renderDests()
renderHits()

// ---------- 상태 ----------

type Mode = 'origin' | 'dest' | 'line' | 'pick' | 'riding' | 'transfer' | 'arrived'
let mode: Mode = 'origin'
let rows: string[] = []      // 목록의 각 행이 뜻하는 값
let origin = ''
let trip: Plan | null = null
let options: Plan[] = []     // 출발 노선이 다른 경로 후보
let legIndex = 0
let stops: string[] = []
let train: Arrival | null = null
let boardedAt = 0            // 열차를 고른 시각. 도착 예정 시간을 깎는 데 쓴다.
let approach = ''            // 아직 승강장에 오지 않은 열차의 현재 역
let atStatus = -1            // 마지막 관측의 trainSttus. 0 진입, 1 도착, 2 출발
let seenAt = 0               // 마지막 관측의 보고 시각. 데이터가 얼마나 묵었는지 보여준다.
let fixes: Fix[] = []
let busy = false
let pollTimer: ReturnType<typeof setTimeout> | null = null
// polling 루프의 세대. 멈추면 올라간다. 옛 루프는 자기 세대가 아니면 아무것도 하지 않는다.
let pollGen = 0
// 연속으로 열차를 못 찾은 횟수. 한 번 놓친 것으로 오류 화면을 띄우지 않는다.
let misses = 0

// 환승 1회에 걸리는 시간. 실측 전 추정값이다. 화면에는 '약'을 붙여 보여준다.
const TRANSFER_MIN = 4
const tripStops = (p: Plan) => p.legs.reduce((n, l) => n + l.stops.length - 1, 0)
const tripMinutes = (p: Plan, pace = DEFAULT_PACE_MS) =>
  Math.round((tripStops(p) * pace) / 60_000 + (p.legs.length - 1) * TRANSFER_MIN)
// 남은 구간만 센다. 환승 화면과 주행 화면의 최종 도착 시각에 쓴다.
const restMinutes = (from: number, pace = DEFAULT_PACE_MS) =>
  Math.round((trip!.legs.slice(from).reduce((n, l) => n + l.stops.length - 1, 0) * pace) / 60_000
    + (trip!.legs.length - 1 - from) * TRANSFER_MIN)

// 서울 API 하루 한도. 넘으면 ERROR-337이 오고 아무것도 못 본다.
// 조용히 넘기지 않으려고 직접 센다. 날짜가 바뀌면 0으로 돌아간다.
const QUOTA_DAY = 1000
const QUOTA_WARN = 800
const today = () => new Date().toISOString().slice(0, 10)
let usedDay = savedQuota[0] === today() ? savedQuota[0] : today()
let used = savedQuota[0] === today() ? Number(savedQuota[1]) || 0 : 0

async function counted<T>(p: Promise<T>): Promise<T> {
  if (usedDay !== today()) { usedDay = today(); used = 0 }
  used += 1
  void bridge.setLocalStorage('quota', `${usedDay}:${used}`)
  return p
}

const GPS_TIMEOUT_MS = 5000
// 서울 API는 하루 1000건이 한도다(ERROR-337). 10초 폴링은 시간당 360건이라 두 번 타면 바닥난다.
// 상황에 따라 주기를 바꾼다. 급한 순간에만 자주 본다.
//   하차 2정거장 이내  15초  내려야 할 때를 놓치면 안 된다
//   열차 기다리는 중    20초  도착 예정이 줄어드는 것을 봐야 한다
//   그 밖의 주행 중     35초  역 사이가 보통 2분이라 충분하다
// 40분 주행 한 번에 약 80건이다. 하루 왕복이 200건 안쪽이다.
const POLL_NEAR_MS = 15_000
const POLL_WAIT_MS = 20_000
const POLL_FAR_MS = 35_000

function pollDelay(): number {
  if (!fixes.length) return POLL_WAIT_MS
  const g = locate(stops, fixes, Date.now())
  if (!g) return POLL_WAIT_MS
  return stopsLeft(stops, stops[g.index]) <= 2 ? POLL_NEAR_MS : POLL_FAR_MS
}
const leg = () => trip!.legs[legIndex]
const toward = () => leg().stops[leg().stops.length - 1]

function stopPolling(): void {
  pollGen += 1
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

// ---------- 출발역 ----------

let gpsRough = false   // 오차가 커서 목록 순서를 믿기 어려운 상태

async function locateOnce(): Promise<Near[]> {
  const loc = await bridge.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: GPS_TIMEOUT_MS })
  log('gps', loc?.latitude, loc?.longitude, 'acc', loc?.accuracy)
  if (!loc || !Number.isFinite(loc.latitude)) return []
  // 오차가 커도 버리지 않는다. 실내나 지하에서는 1km를 넘는 것이 흔하다.
  // 버리면 사용자에게 아무것도 남지 않는다. 후보를 더 주고 불확실하다고 말한다.
  gpsRough = (loc.accuracy ?? 0) > MAX_ACCURACY_M
  return nearest(loc.latitude, loc.longitude, COORDS, gpsRough ? 12 : 8)
}

// 첫 호출이 null을 주는 것을 실기기에서 봤다. 한 번 더 부른다.
async function nearbyStations(): Promise<Near[]> {
  for (let i = 0; i < 2; i++) {
    try {
      const near = await locateOnce()
      if (near.length) return near
    } catch (e) {
      log('gps failed', i, e)
    }
  }
  return []
}

async function showOrigin(): Promise<void> {
  mode = 'origin'
  trip = null
  train = null
  stopPolling()
  await show(S.notice(Date.now(), '출발역을 찾는 중', '', '위치를 확인하고 있습니다'))
  const near = await nearbyStations()
  const names = [...near.map(n => n.name), ...recents.filter(r => !near.some(n => n.name === r))]
  if (!names.length) {
    rows = []
    return show(S.notice(Date.now(), '출발역을 찾지 못했습니다',
      '위치 권한을 켜거나, 폰에서 자주 가는 곳을 넣으세요', '탭: 다시 시도\n  더블탭: 종료'))
  }
  const meters = new Map(near.map(n => [n.name, n.meters]))
  rows = names
  const items = S.rows(names, n => {
    const m = meters.get(n)
    return m === undefined ? `${lineLabel(n)}  최근` : `${lineLabel(n)}  ${m}m`
  })
  // 안내행은 고를 수 없어야 한다. rows의 빈 문자열이 onTap을 다시 시도로 보낸다.
  if (!near.length) {
    items.unshift('위치를 찾지 못했습니다 · 최근 출발역')
    rows = ['', ...names]
  } else if (gpsRough) {
    items.unshift('위치가 정확하지 않습니다 · 직접 고르세요')
    rows = ['', ...names]
  }
  // 한도가 가까우면 떠나기 전에 알린다. 도중에 끊기는 것보다 낫다.
  if (used >= QUOTA_WARN) {
    items.unshift(`오늘 조회 ${used}/${QUOTA_DAY} · 자정에 초기화`)
    rows = ['', ...rows]
  }
  if (!(await showList(items))) {
    rows = []
    await show(S.notice(Date.now(), '목록을 표시하지 못했습니다', '', '탭: 다시 시도\n  더블탭: 종료'))
  }
}

// ---------- 도착지 ----------

async function showDest(): Promise<void> {
  mode = 'dest'
  const shown = dests.filter(d => d !== origin)
  if (!shown.length) {
    rows = []
    return show(S.notice(Date.now(), '갈 곳이 없습니다', '폰 화면에서 자주 가는 곳을 넣으세요', '탭: 출발역 다시 고르기'))
  }
  rows = shown
  // 경로가 없는 곳도 숨기지 않는다. 사용자가 일부러 넣은 것이고,
  // 목록에서 사라지면 저장이 안 된 줄 안다. 왜 못 가는지 그 자리에서 말한다.
  const items = S.rows(shown, d => {
    const p = plan(origin, d)
    if (!p) return '경로 없음'
    const tail = p.legs.length > 1 ? ` · 환승 ${p.legs.length - 1}` : ''
    return `${tripStops(p)}정거장 · 약 ${tripMinutes(p)}분${tail}`
  })
  if (!(await showList(items))) {
    rows = []
    await show(S.notice(Date.now(), '목록을 표시하지 못했습니다', '', '탭: 출발역 다시 고르기'))
  }
}

// 출발역에 노선이 여럿이면 어느 노선으로 떠날지 사용자가 고른다.
// 최단 경로만 내밀면 "호선을 지맘대로 고른다"는 말을 듣는다.
function routeOptions(dest: string): Plan[] {
  const seen = new Set<string>()
  const out: Plan[] = []
  for (const line of transferLines(origin)) {
    const p = planVia(origin, dest, line)
    if (!p) continue
    const key = p.legs.map(l => `${l.line}:${l.stops.length}`).join('/')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  // 빠른 것부터. 정거장 수에 환승 시간을 더해 견준다.
  return out.sort((a, b) => tripMinutes(a) - tripMinutes(b))
}

async function chooseRoute(dest: string): Promise<void> {
  options = routeOptions(dest)
  if (!options.length) {
    mode = 'dest'
    rows = []
    // 실시간 미지원 노선(인천·김포·용인·의정부)의 역은 그래프에 없어서 여기로 온다
    return show(S.notice(Date.now(), '경로를 찾지 못했습니다', `${origin} → ${dest}`, '탭: 도착지 다시 고르기'))
  }
  if (options.length === 1) return startTrip(options[0])

  mode = 'line'
  rows = options.map(p => p.legs[0].line)
  const items = S.rows(rows, line => {
    const p = options.find(o => o.legs[0].line === line)!
    return p.legs.length > 1
      ? `${tripStops(p)}정거장 · 환승 ${p.legs.length - 1} · 약 ${tripMinutes(p)}분`
      : `${tripStops(p)}정거장 · 직통 · 약 ${tripMinutes(p)}분`
  })
  log('options', rows.join(','), '|', items.join(' / '))
  if (!(await showList(items))) {
    rows = []
    await show(S.notice(Date.now(), '노선 목록을 표시하지 못했습니다', '', '탭: 도착지 다시 고르기'))
  }
}

async function startTrip(picked: Plan): Promise<void> {
  trip = picked
  const dest = picked.to
  await rememberOrigin(origin)
  log('plan', origin, '->', dest, trip.legs.map(l => `${l.line}[${l.stops.slice(0, 3).join('·')}…${l.stops[l.stops.length - 1]}]`).join(' ▶ '))
  await show(S.route({
    now: Date.now(), from: trip.from, to: trip.to, legs: trip.legs,
    stops: tripStops(trip), minutes: tripMinutes(trip),
    quota: used >= QUOTA_WARN ? `오늘 조회 ${used}/${QUOTA_DAY}` : undefined,
  }))
  await startLeg(0)
}

// ---------- 탈 열차 ----------

async function startLeg(i: number): Promise<void> {
  legIndex = i
  stops = leg().stops
  train = null
  approach = ''
  await showPick()
}

// autoBoard: 후보가 1대면 바로 태운다. 사용자가 "다시 고르기"로 왔을 때는 끈다.
// 켜 둔 채로 다시 고르면 같은 열차를 또 태워서 아무 일도 없는 것처럼 보인다.
async function showPick(autoBoard = true): Promise<void> {
  mode = 'pick'
  const from = stops[0]
  // 조회에 시간이 걸린다. 탭이 먹혔다는 것을 먼저 보여준다.
  await show(S.notice(Date.now(), `${from}`, `${leg().line} 도착 열차를 확인합니다`, '잠시만 기다리세요'))
  let all: Arrival[]
  try {
    all = await counted(arrivals(from))
  } catch (e) {
    log('arrivals failed', e)
    rows = []
    if (e instanceof ApiError) return show(S.notice(Date.now(), e.message, '자정에 초기화됩니다', '탭: 다시 확인'))
    return show(S.notice(Date.now(), '도착 정보를 받지 못했습니다', String(e), '탭: 다시 확인'))
  }
  const sameLine = all.filter(a => a.trainNo && a.line === leg().line)
  // 방향은 "…방면" 역이 다음 역과 같은지로 가른다.
  // "…방면"은 급행이든 일반이든 인접한 다음 역이다. updnLine은 읽지 않는다.
  const sameWay = sameLine.filter(a => a.toward === stops[1])
  // 이름 표기가 어긋나 0대가 되면 거르지 않는다.
  // "도착 정보 없음"으로 막히는 것보다 한 번 더 묻는 편이 안전하다.
  const candidates = (sameWay.length ? sameWay : sameLine).sort((a, b) => a.etaSec - b.etaSec).slice(0, 18)
  log('candidates', candidates.length, 'sameWay', sameWay.length, 'line', sameLine.length,
    'of', all.length, '| 다음역', stops[1], '| 온 방면', sameLine.map(a => a.toward).join(',') || '없음',
    '| 조회이름', arrivalName(from))

  if (!candidates.length) {
    rows = []
    return show(S.notice(Date.now(), `${from}에 오는 열차가 없습니다`, `${toward()} 방면 도착 정보가 비어 있습니다`, '탭: 다시 확인\n  더블탭: 처음으로'))
  }
  // 후보가 하나뿐이어도 "다시 고르기"로 온 경우에는 목록을 보여준다.
  // 자동으로 같은 열차를 다시 태우면 탭이 먹히지 않은 것처럼 보인다.
  if (candidates.length === 1 && autoBoard) return board(candidates[0])

  picks = candidates
  rows = candidates.map(a => a.trainNo)
  // 방면을 먼저 보여준다. 승강장 표지와 같은 기준이고, 방향을 그 자리에서 확인할 수 있다.
  // 넘치면 행선지부터 버린다. 글자를 자르면 '온수행 급행'이 '온수행 급'이 된다.
  const when = (a: Arrival) => (a.etaSec > 0 ? `${Math.max(1, Math.round(a.etaSec / 60))}분` : '곧')
  const items = S.tiers(
    candidates.map(a => `${when(a)}  ${a.toward}방면  ${a.dest}행${a.express ? ' 급행' : ''}`),
    candidates.map(a => `${when(a)}  ${a.toward}방면${a.express ? ' 급행' : ''}`),
    candidates.map(a => `${when(a)}  ${a.toward}방면`),
  )
  if (!(await showList(items))) {
    rows = []
    await show(S.notice(Date.now(), '열차 목록을 표시하지 못했습니다', '', '탭: 다시 확인'))
  }
}

let picks: Arrival[] = []

async function board(a: Arrival): Promise<void> {
  train = a
  boardedAt = Date.now()
  approach = ''
  fixes = []
  atStatus = -1
  seenAt = 0
  mode = 'riding'
  log('boarded', a.trainNo, leg().line, 'eta', a.etaSec)
  await show(S.waiting({
    now: Date.now(), line: leg().line, toward: a.dest || a.toward,
    at: '확인 중', from: stops[0], etaSec: a.etaSec, agoSec: -1,
  }))
  stopPolling()
  misses = 0
  await poll(pollGen)
}

// ---------- 추적 ----------

async function poll(gen: number): Promise<void> {
  if (gen !== pollGen || mode !== 'riding') return
  if (!busy) {
    try {
      const me = (await counted(positions(leg().line))).find(t => t.trainNo === train!.trainNo)
      if (gen !== pollGen) return   // 기다리는 사이에 다른 흐름이 시작됐다
      if (!me) {
        misses += 1
        log('train not in feed', train!.trainNo, 'misses', misses)
      } else if (stops.includes(me.station)) {
        misses = 0
        approach = ''
        atStatus = me.status
        seenAt = me.at
        const last = fixes[fixes.length - 1]
        if (!last || last.station !== me.station) fixes.push({ station: me.station, at: me.at })
      } else {
        // 고른 열차가 아직 승강장에 오지 않았다. 오는 중이다.
        misses = 0
        approach = me.station
        seenAt = me.at
        log('train approaching', me.station, 'at', new Date(me.at).toTimeString().slice(0, 8))
      }
    } catch (e) {
      log('poll failed', e)   // 일시적 실패는 화면을 바꾸지 않는다. render가 추정으로 처리한다
      if (e instanceof ApiError) {
        // 한도 소진 같은 것은 기다려도 낫지 않는다. 숨기지 않고 말한다.
        stopPolling()
        mode = 'arrived'
        rows = []
        return show(S.notice(Date.now(), e.message, '자정에 초기화됩니다', '탭: 처음으로\n  더블탭: 종료'))
      }
    }
    await render()
  }
  if (gen === pollGen && mode === 'riding') pollTimer = setTimeout(() => poll(gen), pollDelay())
}

async function render(): Promise<void> {
  const now = Date.now()
  const guess = locate(stops, fixes, now)

  if (!guess) {
    // 아직 타지 않았다. 열차가 오는 중이거나, 열차를 못 찾았다.
    const etaSec = Math.max(0, train!.etaSec - Math.round((now - boardedAt) / 1000))
    // 세 번 연속(30초) 못 찾기 전에는 오류로 단정하지 않는다.
    // 한 번 놓친 것은 흔하다. 그때마다 오류를 띄우면 화면이 깜빡인다.
    if (approach || misses < 3) {
      return show(S.waiting({
        now, line: leg().line, toward: train!.dest || train!.toward,
        at: approach || '확인 중', from: stops[0], etaSec,
        agoSec: seenAt ? Math.round((now - seenAt) / 1000) : -1,
      }))
    }
    return show(S.notice(now, `${train!.trainNo}번 열차를 찾지 못했습니다`, `${leg().line} 실시간 정보에 ${misses}회 연속 없습니다`, '탭: 열차 다시 고르기\n  더블탭: 처음으로'))
  }

  const left = stopsLeft(stops, stops[guess.index])
  if (left <= 0) return arrive()

  const pace = paceMs(stops, fixes)
  const lastFix = fixes[fixes.length - 1]
  const dest = stops[stops.length - 1]

  if (guess.stale) {
    return show(S.lost({
      now, last: lastFix.station,
      agoSec: Math.round((now - lastFix.at) / 1000),
      guess: stops[guess.index],
      dest, stopsLeft: left,
      bar: S.track(stops.length, guess.index, guess.estimated),
    }))
  }

  if (left <= 2) {
    return show(S.alight({
      now, stopsLeft: left, dest, next: stops[guess.index + 1],
      minutes: Math.max(1, Math.round((pace * left) / 60_000)),
    }))
  }

  const nextLeg = trip!.legs[legIndex + 1]
  // 지금 어디인지. 관측이면 전광판과 같은 말(진입·도착·출발), 추정이면 추정이라고 말한다.
  const agoSec = seenAt ? Math.round((now - seenAt) / 1000) : -1
  const at = guess.estimated > 0
    ? { station: stops[guess.index], label: '부근 (추정)', agoSec }
    : { station: stops[guess.index], label: S.statusWord(atStatus) || '통과', agoSec }
  await show(S.riding({
    now, line: leg().line,
    at,
    next: stops[guess.index + 1],
    legDest: dest, stopsLeft: left, paceMs: pace,
    pathLen: stops.length, index: guess.index, estimated: guess.estimated,
    transfer: nextLeg
      ? {
          line: nextLeg.line,
          finalDest: trip!.to,
          // 남은 시간은 이번 구간의 관측 속도로 센다. 지금 타고 있는 열차의 실제 속도다.
          finalMinutes: Math.round((left * pace) / 60_000) + TRANSFER_MIN + restMinutes(legIndex + 1, pace),
        }
      : undefined,
  }))
}

async function arrive(): Promise<void> {
  stopPolling()
  rows = []
  const nextLeg = trip!.legs[legIndex + 1]
  if (nextLeg) {
    mode = 'transfer'
    return show(S.transfer({
      now: Date.now(),
      station: stops[stops.length - 1],
      from: leg().line, to: nextLeg.line,
      // 환승 뒤 첫 구간의 다음 역. 승강장 표지와 같은 기준이라 그 자리에서 확인된다.
      toward: nextLeg.stops[1] ?? nextLeg.stops[nextLeg.stops.length - 1],
      rest: trip!.legs.slice(legIndex + 1).reduce((n, l) => n + l.stops.length - 1, 0),
      minutes: restMinutes(legIndex + 1),
    }))
  }
  mode = 'arrived'
  await show(S.arrived(Date.now(), stops[stops.length - 1]))
}

// ---------- 이벤트 ----------

// CLICK_EVENT는 0이고 protobuf가 0을 생략한다. eventType이 없으면 클릭이다.
function eventTypeOf(e?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!e) return null
  return e.eventType ?? OsEventTypeList.CLICK_EVENT
}

async function onTap(index: number): Promise<void> {
  if (mode === 'origin') {
    const pick = rows[index]
    if (!pick) return showOrigin()   // 자 화면과 실패 화면은 rows가 비어 있다
    origin = pick
    return showDest()
  }
  if (mode === 'dest') {
    const pick = rows[index]
    if (!pick) return showOrigin()
    return chooseRoute(pick)
  }
  if (mode === 'line') {
    const p = options.find(o => o.legs[0].line === rows[index])
    return p ? startTrip(p) : showDest()
  }
  if (mode === 'pick') {
    const a = picks.find(p => p.trainNo === rows[index])
    return a ? board(a) : showPick()          // 실패 화면에서 탭하면 다시 확인
  }
  // 엉뚱한 열차를 잡았을 때. 자동 탑승을 끄고 목록을 보여준다.
  if (mode === 'riding') { stopPolling(); return showPick(false) }
  if (mode === 'transfer') return startLeg(legIndex + 1)
  return showOrigin()                                            // arrived
}

const unsubscribe = bridge.onEvenHubEvent(async event => {
  const type = eventTypeOf(event.listEvent) ?? eventTypeOf(event.textEvent) ?? eventTypeOf(event.sysEvent)
  if (type === OsEventTypeList.SYSTEM_EXIT_EVENT || type === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    stopPolling()
    return unsubscribe()
  }
  if (type === null || busy) return
  busy = true
  try {
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      // 루트 화면의 더블탭은 반드시 종료여야 한다 (Even Hub 요구사항)
      if (mode === 'origin') { stopPolling(); await bridge.shutDownPageContainer(1) }
      else await showOrigin()
    } else if (type === OsEventTypeList.CLICK_EVENT) {
      // 하드웨어가 첫 항목의 currentSelectItemIndex를 생략한다
      await onTap(event.listEvent?.currentSelectItemIndex ?? 0)
    }
  } catch (e) {
    log('event failed', e)
    stopPolling()
    mode = 'origin'
    rows = []
    await show(S.notice(Date.now(), '오류', String(e), '탭: 처음으로\n  더블탭: 종료'))
  } finally {
    busy = false
  }
})

// Vite HMR은 모듈을 다시 실행한다. 정리하지 않으면 옛 타이머와 이벤트 핸들러가 살아남아
// 여러 루프가 같은 화면을 덮어쓴다. 개발 중에만 쌓이지만 디버깅을 통째로 망친다.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopPolling()
    unsubscribe()
  })
}

const started = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer(full(S.notice(Date.now(), 'Metro', '출발역을 찾는 중', ''))))
log('startup', started, location.href)
await showOrigin()
