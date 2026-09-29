// 초기화가 도중에 터지면 화면이 반쯤만 살아난다. 그것을 사람이 알아채기 어렵다.
// 아래 어떤 선언에도 기대지 않는 안전망을 맨 먼저 단다. 오류가 나면 폰 화면 맨 위에 적힌다.
const fatal = (what: string) => {
  const el = document.getElementById('fatal')
  if (el) el.textContent = `앱이 제대로 시작되지 않았습니다: ${what}`
}
window.addEventListener('error', e => fatal(e.message))
window.addEventListener('unhandledrejection', e => fatal(String((e as PromiseRejectionEvent).reason)))

// 개발 모드 ?host=ios 흉내 장치. SDK보다 먼저 실행되어야 한다. 배포본에서는 빈 모듈이다.
import './devhost.ts'
import {
  waitForEvenAppBridge,
  TextContainerProperty, ListContainerProperty, ListItemContainerProperty,
  CreateStartUpPageContainer, RebuildPageContainer, TextContainerUpgrade, OsEventTypeList,
  AppLocationAccuracy,
} from '@evenrealities/even_hub_sdk'
import { COORDS, NAMES, transferLines, arrivalName, DATA_DATE } from './stations.ts'
import { plan, planHop, departures, locate, legEta, hops, paceMs, reaches, stopsLeft, deviation, DEFAULT_PACE_MS, type Plan, type Fix, type Deviation } from './route.ts'
import { nearest, distanceM, MAX_ACCURACY_M, type Near } from './geo.ts'
import { arrivals, positions, remoteLog, flushLog, endLog, sendTrail, REPORTING, SESSION, setServerUsedListener, setReporting, setRequestGuard, ApiError, type Arrival } from './api.ts'
import { lineShort, lineColor } from './lines.ts'
import * as S from './screen.ts'
import { closest, doubleTapAction, doubleTapHint, type DoubleTapState } from './controls.ts'

// 최근 기록을 앱 안에 모아 둔다. wrangler tail은 붙어 있을 때만 받으므로
// 혼자 탈 때 생긴 일을 놓친다. 폰 화면에서 읽고 보낼 수 있어야 한다.
const LOG_KEEP = 120
const trail: string[] = []

const stamp = () => new Date().toTimeString().slice(0, 8)

const log = (...a: unknown[]) => {
  const msg = a.map(String).join(' ')
  trail.push(`${stamp()} ${msg}`.slice(0, 300))
  if (trail.length > LOG_KEEP) trail.shift()
  // 같은 Wi-Fi에 있을 때는 dev server 터미널에, 아닐 때도 볼 수 있게 워커에도 보낸다.
  if (import.meta.env?.DEV) navigator.sendBeacon('/__log', msg)
  // 서버에서는 10초 묶음이 도착 시각 하나를 공유한다. 폴링 간격과 겹침을 보려면 줄마다 기기 시각이 있어야 한다.
  remoteLog(`${stamp()} ${msg}`)
}

// 화면이 죽으면 메모리 기록도 사라진다. 그 직전 것이 가장 쓸모 있으므로 남긴다.
const keepTrail = () => bridge.setLocalStorage('trail', trail.slice(-LOG_KEEP).join('\n'))
window.addEventListener('error', e => { log('error', e.message); void keepTrail() })
window.addEventListener('unhandledrejection', e => { log('rejection', e.reason); void keepTrail() })

// SDK 0.0.15의 그림자 타이머는 한 번짜리 타이머를 두 번 부를 수 있다. 폰을 잠그고 타면 실제로 그랬고,
// 폴링 사슬이 주기마다 두 배가 되어 몇 분 만에 앱이 멈췄다(constraints.md 2026-09-26).
// 앱의 한 번짜리 타이머는 모두 later로 건다. 두 번째 호출은 아무것도 하지 않는다.
function later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  let done = false
  return setTimeout(() => { if (!done) { done = true; fn() } }, ms)
}
// 반복 타이머도 겹쳐 불릴 수 있다. 주기의 80% 안에 다시 불리면 건너뛴다.
// 절반으로 두었더니 겹칠 때 1초 틱이 초당 두 번까지 통과했다(리뷰 1라운드).
function every(fn: () => void, ms: number): ReturnType<typeof setInterval> {
  let last = 0
  return setInterval(() => { const now = Date.now(); if (now - last < ms * 0.8) return; last = now; fn() }, ms)
}

const bridge = await waitForEvenAppBridge()

// 폰이 잠기거나 앱이 뒤로 가는 순간을 남긴다. 그림자 타이머가 도는 구간이 이때부터다.
// 가려질 때 기록을 저장하고 모아 둔 로그를 보낸다. 그 뒤에 앱이 끝나도 다음 실행에서 보낼 수 있다.
document.addEventListener('visibilitychange', () => {
  log('visibility', document.visibilityState)
  if (document.visibilityState === 'hidden') { void keepTrail(); flushLog() }
})

// 호스트가 그림자 틱을 언제 보내는지 실기기에서 배운다. SDK는 틱마다 'shadow-timer:tick' 이벤트를 낸다.
// 앞 화면에서도 틱이 오는지(실기기 로그의 '1초 안에 두 번째 폴링'은 그쪽을 가리킨다) 1분마다 세어 남긴다.
let shadowTicks = 0, shadowFired = 0
window.addEventListener('shadow-timer:tick', e => {
  shadowTicks += 1
  shadowFired += (e as CustomEvent<{ fired?: number }>).detail?.fired ?? 0
})
every(() => {
  if (!writes) return
  log('ble writes/min', writes, 'bytes', writeBytes, 'mode', mode, 'sec', S.clock.seconds)
  allWrites += writes; allBytes += writeBytes
  writes = writeBytes = 0
}, 60_000)
const shadowLog = every(() => {
  if (!shadowTicks) return
  log('shadow ticks', shadowTicks, 'fired', shadowFired, 'visible', document.visibilityState)
  shadowTicks = shadowFired = 0
}, 60_000)

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

// 목록 위에 한 줄짜리 머리줄(현재시각과 제목)을 얹는다. SDK는 한 페이지에 컨테이너 12개까지 허용한다.
// 컨테이너 번호를 텍스트 페이지(1)와 겹치지 않게 둔다. 틱의 글자 갈아끼우기가 목록 페이지에 잘못 떨어져도 아무 일이 없다.
// 40이면 글자 한 줄(약 27px)과 위아래 여백(8px씩)이 안 들어가 스크롤 막대가 섰다(시뮬레이터 실측).
const HEAD_H = 44
const listOf = (items: string[], head?: string) => ({
  containerTotalNum: head ? 2 : 1,
  listObject: [new ListContainerProperty({
    xPosition: 0, yPosition: head ? HEAD_H : 0, width: 576, height: 288 - (head ? HEAD_H : 0),
    borderWidth: 0, paddingLength: 8,
    containerID: 3, containerName: 'rows',
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length, itemWidth: 560, isItemSelectBorderEn: 1, itemName: items,
    }),
    isEventCapture: 1,
  })],
  ...(head ? {
    textObject: [new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: 576, height: HEAD_H,
      borderWidth: 0, paddingLength: 8,
      containerID: 2, containerName: 'head', content: head, isEventCapture: 0,
    })],
  } : {}),
})

// 지금 안경에 떠 있는 것이 텍스트 페이지인지. 맞으면 내용만 갈아끼운다(가벼움).
// 목록 페이지에서 텍스트로 바뀔 때만 페이지를 다시 만든다.
let pageIsText = false
// 마지막으로 안경에 쓴 텍스트. 같으면 다시 쓰지 않는다. 쓰기 횟수와 바이트는 1분마다 기록한다(리뷰: 수치가 없다).
let lastWritten = ''
let writes = 0, writeBytes = 0, allWrites = 0, allBytes = 0

// 반환값을 확인한다. tiro는 이것을 빼먹어 화면이 멈췄다.
async function show(content: string): Promise<void> {
  if (Date.now() < confirmUntil) {
    const ls = content.split('\n')
    ls[ls.length - 1] = `  ${CONFIRM}`
    content = ls.join('\n')
  }
  if (pageIsText) {
    // 바뀐 것이 없으면 쓰지 않는다. 분 단위 시계에서는 대부분의 틱이 여기서 끝난다(BLE·배터리).
    if (content === lastWritten) return
    // 매초 도는 길이다. 여기서 log를 부르면 1초마다 한 줄이 쌓이고 워커로도 날아간다.
    const up = await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'main', content }))
    if (up) { lastWritten = content; writes += 1; writeBytes += S.bytes(content); return }
    log('upgrade false, rebuild', S.bytes(content))
  }
  listHead = null
  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(full(content)))
  pageIsText = !!ok
  lastWritten = ok ? content : ''
  writes += 1; writeBytes += S.bytes(content)
  if (ok) { showFails = 0; return }
  showFails += 1
  // 실패마다 한 줄씩 남기면 383줄이 쌓인다. 멈추는 순간 한 번만 알린다.
  if (showFails <= SHOW_FAIL_STOP) log('show false', 'bytes', S.bytes(content), 'fails', showFails)
  if (showFails === SHOW_FAIL_STOP) log('show 연속 실패, 틱 중단. 탭이나 폴링 성공에 재개')
  // 실패한 직후 또 재구성하면 한 틱에 두 번 때린다. 대체 화면은 한 번만 시도한다.
  if (showFails === 1) {
    await bridge.rebuildPageContainer(new RebuildPageContainer(
      full(S.notice(Date.now(), '화면을 표시하지 못했습니다', '잠시 뒤 다시 그립니다', ''))))
  }
}

// 지금 떠 있는 목록 페이지의 머리줄을 만드는 함수. 틱이 매초 시계를 갈아끼운다. 목록 페이지가 아니면 null.
let listHead: (() => string) | null = null

async function showList(items: string[], head?: () => string): Promise<boolean> {
  const fitted = S.fitsAll(items) ? items : S.fitItems(items)
  let ok = await bridge.rebuildPageContainer(new RebuildPageContainer(listOf(fitted, head?.())))
  if (!ok && head) {
    // 머리줄을 얹은 페이지를 기기가 거부하면 목록만 띄운다. 시계가 빠져도 고를 수는 있어야 한다.
    log('list with head refused, retry without')
    head = undefined
    ok = await bridge.rebuildPageContainer(new RebuildPageContainer(listOf(fitted)))
  }
  pageIsText = false
  current = null
  listHead = ok && head ? head : null
  log('list', ok, 'count', fitted.length, 'bytes', S.bytes(fitted.join('')), 'head', !!listHead)
  return !!ok
}

// ---------- 저장 ----------

// G2 목록 위젯이 한 화면에 20항목까지 보여준다. 그것이 유일한 한도다.
// 항목 하나가 약 34바이트라 20개를 넣어도 페이지 한도 950바이트 안에 든다.
const MAX_DESTS = 20
const parseLines = (t: string, max: number) =>
  t.split('\n').map(s => s.trim()).filter(Boolean).slice(0, max)

let dests = parseLines((await bridge.getLocalStorage('destinations')) ?? '', MAX_DESTS)
// 시뮬레이터 저장소는 비어 있다. 개발 모드에서만 URL로 도착지를 심는다.
//   http://localhost:5173/?lat=..&lon=..&dests=홍대입구,강남
if (import.meta.env?.DEV) {
  const seed = (new URLSearchParams(location.search).get('dests') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (seed.length) dests = [...new Set([...dests, ...seed])].slice(0, MAX_DESTS)
}
let recents = parseLines((await bridge.getLocalStorage('recentOrigins')) ?? '', 5)
// 마지막으로 도착한 역. 위치가 없거나 묵었을 때 가장 그럴듯한 출발역이다.
// 'name\tms'. 방금 내린 역이면 GPS보다 확실한 출발역이다.
const [savedArrived = '', savedArrivedAt = '0'] = ((await bridge.getLocalStorage('lastArrived')) ?? '').split('\t')
let lastArrived = savedArrived
let lastArrivedAt = Number(savedArrivedAt) || 0
// 출발역·도착지마다 지난번에 고른 경로를 기억한다. 늘 같은 길로 다니는 사람이 대부분이다.
const savedQuota = ((await bridge.getLocalStorage('quota')) ?? '').split(':')
const prefs = new Map(((await bridge.getLocalStorage('prefs')) ?? '').split('\n')
  .map(l => l.split('\t')).filter(v => v.length === 2) as [string, string][])

// 서울 API 하루 한도. 넘으면 ERROR-337이 오고 아무것도 못 본다.
// 조용히 넘기지 않으려고 직접 센다. 날짜가 바뀌면 0으로 돌아간다.
// 워커가 950건에서 막는다(나머지 50건은 여유). 화면의 분모도 같아야 한다(리뷰 2라운드: 950/1000에서 '다 썼습니다').
const QUOTA_DAY = 950
const QUOTA_WARN = 800
// 서울 API는 KST 자정에 초기화된다. UTC 날짜를 쓰면 오전 9시에 엉뚱하게 초기화된다.
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
// 1분에 이만큼 넘게 부르면 무언가 폭주한 것이다. 정상은 분당 2~4건이고,
// 사람이 급하게 만지작거려도 10건 안팎이다. 폭주 루프는 60건을 넘는다. 20이면 둘을 가른다.
const BURST_PER_MIN = 20

let usedDay = savedQuota[0] === today() ? savedQuota[0] : today()
let used = savedQuota[0] === today() ? Number(savedQuota[1]) || 0 : 0
let recentCalls: number[] = []

// 하루 한도 소진. 기다려도 낫지 않는다. 화면에 말하고 멈춘다.
class QuotaError extends Error {}
// 분당 폭주. 몇 초만 기다리면 풀린다. 화면을 지우지 않고 기다렸다가 다시 한다.
class BurstError extends Error {
  waitSec: number
  constructor(waitSec: number) {
    super(`${waitSec}초 뒤 다시 조회할 수 있습니다`)
    this.waitSec = waitSec
  }
}

// 실제 요청마다 부른다(api.ts의 get 안에서). 한도와 폭주를 요청 전에 막는다.
// 28,165건까지 올라간 적이 있다. 한도를 넘어도 계속 부르고 있었다.
// 누가 몇 초 만에 불렀는지 남긴다. 폭주가 나면 이 줄이 원인을 가리킨다.
let lastReqAt = 0
function guard(path: string): void {
  if (usedDay !== today()) { usedDay = today(); used = 0; recentCalls = [] }
  const now = Date.now()
  recentCalls = recentCalls.filter(t => now - t < 60_000)
  const dt = lastReqAt ? ((now - lastReqAt) / 1000).toFixed(1) : '-'
  if (recentCalls.length >= BURST_PER_MIN) {
    // 가장 오래된 호출이 60초 창을 벗어날 때까지가 대기 시간이다
    const waitSec = Math.max(1, Math.ceil((recentCalls[0] + 60_000 - now) / 1000))
    log('burst guard', recentCalls.length, '/min', 'path', path, 'mode', mode, 'wait', waitSec)
    throw new BurstError(waitSec)
  }
  if (used >= QUOTA_DAY) throw new QuotaError(`오늘 조회 한도(${QUOTA_DAY}건)를 다 썼습니다`)
  recentCalls.push(now)
  lastReqAt = now
  used += 1
  log('req', path, 'dt', lastReqAt ? dt + 's' : '-', 'mode', mode, 'n', used)
  void bridge.setLocalStorage('quota', `${usedDay}:${used}`)
}
setRequestGuard(guard)
// 워커가 센 오늘 사용량이 더 크면 그것을 쓴다(캐시·다른 기기·토큰 유출까지 반영된다).
let serverUsed = -1   // 워커가 센 오늘 수. 헤더가 안 오면 -1('서버 집계 없음')
setServerUsedListener(n => {
  serverUsed = n
  if (n > used) { used = n; void bridge.setLocalStorage('quota', `${usedDay}:${used}`) }
})

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
// 노선이 하나면 전체 이름, 여럿이면 짧은 이름. 숫자 노선만이면 '1·6호선'처럼 '호선'을 한 번만 붙인다.
// '2·4·5'와 '1호선·6호선'이 섞여 보였다(리뷰 1라운드).
const lineLabel = (name: string): string => {
  const lines = transferLines(name)
  if (lines.length < 2) return lines[0] ?? ''
  const short = lines.map(lineShort)
  return short.every(s => /^\d+$/.test(s)) ? `${short.join('·')}호선` : short.join('·')
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
      await refreshGlasses()
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
  const q = normName(qEl.value.trim())
  goEl.disabled = !q || dests.includes(q) || dests.length >= MAX_DESTS
  hitsEl.replaceChildren()
  if (!q) return
  const hits = matches(q).filter(n => !dests.includes(n)).slice(0, 6)
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
  await refreshGlasses()
}

// 폰에서 자주 가는 곳을 고치면 안경이 그 목록을 보고 있을 때만 다시 그린다.
// 예전에는 무조건 출발역 화면으로 돌아가 주행 중 추적이 끊겼다.
async function refreshGlasses(): Promise<void> {
  if (busy) return
  if (mode === 'dest') return showDest()
  if (mode === 'origin' && !rows.some(Boolean)) return showOrigin()   // 막다른 안내 화면이었다
}

// '홍대입구역'처럼 '역'을 붙여 쳐도 찾는다. 앞부분이 안 맞으면 가운데라도 맞는 역을 찾는다('문화공원').
const normName = (q: string): string =>
  !NAMES.includes(q) && q.endsWith('역') && NAMES.includes(q.slice(0, -1)) ? q.slice(0, -1) : q
const matches = (q: string): string[] =>
  [...NAMES.filter(n => n.startsWith(q)), ...NAMES.filter(n => !n.startsWith(q) && n.includes(q))]

qEl.addEventListener('input', renderHits)
$<HTMLFormElement>('#add').addEventListener('submit', async e => {
  e.preventDefault()
  const q = normName(qEl.value.trim())
  // 정확히 맞는 역이 없으면 첫 후보를 넣는다. 오타로 빈 항목이 생기지 않는다.
  await add(NAMES.includes(q) ? q : (matches(q)[0] ?? q))
})
// 진단 기록. 지난 실행에서 남긴 것도 함께 보여준다.
const logView = $<HTMLPreElement>('#logview')
const sentEl = $('#sent')
const prevTrail = (await bridge.getLocalStorage('trail')) ?? ''

function renderTrail(): void {
  const lines = [
    `오늘 조회 ${used}/${QUOTA_DAY} (${usedDay}, KST 기준)`,
    '',
    ...(prevTrail ? ['── 지난 실행 ──', prevTrail] : []),
    ...(trail.length ? ['── 이번 실행 ──', ...trail] : []),
  ]
  logView.textContent = lines.length ? lines.join('\n') : '기록이 없습니다.'
  logView.scrollTop = logView.scrollHeight
}

$('#refresh').addEventListener('click', () => { void keepTrail(); renderTrail() })
$('#send').addEventListener('click', async () => {
  sentEl.textContent = '보내는 중...'
  const head = `-- ${import.meta.env?.VITE_APP_NAME ?? 'Metro'} ${import.meta.env?.VITE_APP_VERSION ?? ''} `
    + `| ${new Date().toISOString()} | 조회 ${used}/${QUOTA_DAY} | 도착지 ${dests.length}곳 --`
  const ok = await sendTrail([head, prevTrail, ...trail].filter(Boolean).join('\n'))
  sentEl.textContent = ok ? '보냈습니다.' : '보내지 못했습니다. 네트워크를 확인하세요.'
})
$('#glyph').addEventListener('click', async () => {
  // 안경 폰트의 글리프 유무는 실기기에서만 안다. 줄 번호로 보고받아 스피너 글리프를 고른다.
  stopPolling(); stopOriginWatch(); stopTransferWatch()
  mode = 'arrived'   // 탭하면 처음으로
  rows = []
  const lines = ['1 ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', '2 ◐◓◑◒ ◌ ◎ ◉', '3 ▁▂▃▄▅▆▇█ ░▒▓', '4 ←→↑↓ ⇢ ➜ ▶ ▷', '5 ●○━─ ✓ ✗ ⏳', '6 ★☆ ♥ ⌛ ⚠', '7 · ≈ ⋯ ▸ … ▪ ◆ ◇']
  await showLive(() => [`  현재시각 ${S.hhmmss(Date.now())}  글리프 시험`, '', ...lines.map(l => `  ${l}`), '', '  탭: 처음으로'].join('\n'))
  sentEl.textContent = '안경에 글리프 시험 화면을 띄웠습니다. 보이는 줄 번호가 답입니다.'
})
$('#resetQuota').addEventListener('click', async () => {
  // 폭주로 잘못 쌓인 값을 지운다. 실제 서울 API 한도는 이것과 무관하게 KST 자정에 돈다.
  used = 0
  recentCalls = []
  usedDay = today()
  await bridge.setLocalStorage('quota', `${usedDay}:0`)
  sentEl.textContent = '조회수를 0으로 되돌렸습니다. 서울 API 실제 한도는 KST 자정에 초기화됩니다.'
  renderTrail()
})
$('#diag').addEventListener('toggle', renderTrail)
renderTrail()

// 버전은 app.json에서 온다. 패키징되는 값과 같아야 문의가 왔을 때 대조할 수 있다.
$('#version').textContent =
  `${import.meta.env?.VITE_APP_NAME ?? 'Metro'} ${import.meta.env?.VITE_APP_VERSION ?? ''}`.trim()
  + (DATA_DATE ? ` · 역 데이터 ${DATA_DATE} 기준` : '')
  + (REPORTING ? ` · 세션 ${SESSION}` : '')

// 설정: 초 단위 시계, 진단 기록 자동 보고. 폰 저장소에 둔다.
const secEl = $<HTMLInputElement>('#secClock')
S.clock.seconds = ((await bridge.getLocalStorage('secClock')) ?? '1') !== '0'
// 개발 모드 ?sec=0: 분 단위 시계로 쓰기 횟수를 잰다(시뮬레이터는 폰 스위치를 누를 수 없다). 배포본은 타지 않는다.
if (import.meta.env?.DEV && new URLSearchParams(location.search).get('sec') === '0') S.clock.seconds = false
secEl.checked = S.clock.seconds
secEl.addEventListener('change', () => {
  S.clock.seconds = secEl.checked
  void bridge.setLocalStorage('secClock', secEl.checked ? '1' : '0')
  log('setting secClock', secEl.checked)
})
// 개발 빌드(자동 보고가 들어간 빌드)에서만 스위치를 보인다. 무엇을 보내는지 스위치 옆에 적었다.
const reportEl = $<HTMLInputElement>('#report')
if (REPORTING) {
  $('#reportRow').hidden = false
  const on = ((await bridge.getLocalStorage('report')) ?? '1') !== '0'
  reportEl.checked = on
  setReporting(on)
  reportEl.addEventListener('change', () => {
    log('setting report', reportEl.checked)   // 끄기 직전 한 줄은 남긴다
    setReporting(reportEl.checked)
    void bridge.setLocalStorage('report', reportEl.checked ? '1' : '0')
  })
}
// 오늘 조회 수는 숨기지 않는다. 한도가 보여야 안심하고 켜 둔다.
function renderUsage(): void {
  $('#usage').textContent = `오늘 조회 ${used}/${QUOTA_DAY}건 · 서버 집계 ${serverUsed >= 0 ? `${serverUsed}건` : '없음'} · KST 자정에 초기화 · 700건부터 조회 간격을 늘립니다`
}
renderUsage()
every(renderUsage, 15_000)

renderDests()
renderHits()

// ---------- 상태 ----------

type Mode = 'origin' | 'dest' | 'line' | 'pick' | 'riding' | 'transfer' | 'arrived'
// 주행 중 탭 메뉴. 목록 화면이 열려 있는 동안은 렌더가 그것을 덮지 않아야 한다.
let menuOpen = false
const MENU = ['계속 보기', '현위치에서 재탐색', '열차 다시 고르기', '처음으로'] as const
// 이탈로 경로를 바꿨을 때 머리줄에 짧게 보이는 말
let note = ''
let stranded = false     // 내려야 하는데 거기서 경로를 못 찾은 상태
let mode: Mode = 'origin'
let rows: string[] = []      // 목록의 각 행이 뜻하는 값
let origin = ''
let trip: Plan | null = null
let options: Plan[] = []     // 출발 방면이 다른 경로 후보
let legIndex = 0
let stops: string[] = []
let train: Arrival | null = null
let boardedAt = 0            // 열차를 고른 시각. 도착 예정 시간을 깎는 데 쓴다.
let departedAt = 0           // 고른 열차가 출발역을 떠난 시각. 2분 동안 탭 한 번이 '못 탔으면 다음 열차'다
let approach = ''            // 아직 승강장에 오지 않은 열차의 현재 역
let approachStatus = -1      // 그 역에서의 상태(진입·도착·출발)
let approachAt = 0           // 그 상태가 된 시각(피드 recptnDt)
// '탭: 열차 다시 고르기'가 적힌 화면에서만 탭이 다시 고르기다.
// 안내 없는 주행 화면에서 탭마다 도착 조회를 하면 답답해서 누를수록 한도가 샌다.
let lastSeen = ''        // 직전 관측 역(경로 밖 포함). 진행 방향을 잡는 데 쓴다
let prevSeen = ''
let atStatus = -1            // 마지막 관측의 trainSttus. 0 진입, 1 도착, 2 출발
// 초 단위 시계와 갱신 막대. 텍스트 화면이 떠 있는 동안 매초 다시 쓴다.
// 초를 보여주면서 안 움직이면 멈춘 것처럼 보인다. 보여주려면 움직여야 한다.
// TICK_MS는 실측 전 값이다. 안경 배터리가 빨리 닳거나 쓰기가 거부되면 2000으로 올린다.
const TICK_MS = 1000
let nextPollAt = 0           // 다음 폴링 예정 시각. 막대와 초읽기의 기준이다.
let pollWait = 20_000        // 이번 폴링 간격. 막대가 차는 총 길이다.
let lastPollFailed = false
let rendering = false        // 폴링 렌더와 틱 렌더가 겹치지 않게
// 지금 떠 있는 텍스트 화면을 다시 만드는 함수. 목록 화면이면 null.
let current: (() => string) | null = null

const refresh = (): S.Refresh => ({
  inSec: Math.max(0, Math.ceil((nextPollAt - Date.now()) / 1000)),
  totalSec: Math.round(pollWait / 1000),
  failed: lastPollFailed,
})

// 화면 재구성이 연달아 실패하면 매초 때리기를 멈춘다. 383번 연속 실패한 적이 있다.
// 다시 그릴 이유(탭, 폴링 성공)가 생기면 카운터를 0으로 돌려 재개한다.
const SHOW_FAIL_STOP = 3
let showFails = 0

// 매초 한 번. 주행 중이면 위치 추정까지 다시 계산하고, 그 밖의 텍스트 화면은 시계만 새로 쓴다.
// 탭 처리 중(도착 정보를 기다리는 중)에도 시계와 스피너는 돌아야 한다. 예전에는 이때 멈춰서
// 스피너가 가장 필요한 순간에 정지했다. 이때는 글자만 갈아끼운다. 페이지를 다시 만들면 처리 중인 전환과 부딪힌다.
// 주행 모드의 current는 탑승 전 화면의 것이라 믿지 않는다. 주행 화면은 render가 그린다.
// 안경을 벗으면 아무도 안 보는 매초 쓰기를 멈춘다. 조회 결과로 바뀌는 내용은 폴링이 그린다(리뷰 2라운드).
let wearing = true
bridge.onDeviceStatusChanged(st => {
  const w = st?.isWearing !== false
  if (w !== wearing) { wearing = w; log('wearing', w) }
})
const ticker = every(() => {
  if (rendering || showFails >= SHOW_FAIL_STOP || !wearing) return
  if (listHead) void tickHead(listHead())
  else if (busy) { if (pageIsText && current && mode !== 'riding') void tickText(current()) }
  else if (mode === 'riding') void render()
  else if (current) void show(current())
}, TICK_MS)

async function tickText(content: string): Promise<void> {
  if (content === lastWritten) return
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'main', content }))
  lastWritten = content; writes += 1; writeBytes += S.bytes(content)
}
let lastHead = ''
async function tickHead(content: string): Promise<void> {
  if (content === lastHead) return
  lastHead = content; writes += 1; writeBytes += S.bytes(content)
  const ok = await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, containerName: 'head', content }))
  // 머리줄 갱신이 거부되면 매초 때리지 않는다. 목록은 그대로 쓸 수 있다.
  if (!ok && listHead) { log('head upgrade false, stop'); listHead = null }
}

// 시계가 있는 화면은 이것으로 띄운다. 틱이 같은 함수를 다시 불러 초를 갱신한다.
async function showLive(build: () => string): Promise<void> {
  current = build
  await show(build())
}
let fixes: Fix[] = []
let busy = false
let pollTimer: ReturnType<typeof setTimeout> | null = null
// polling 루프의 세대. 멈추면 올라간다. 옛 루프는 자기 세대가 아니면 아무것도 하지 않는다.
let pollGen = 0
// 연속으로 열차를 못 찾은 횟수. 한 번 놓친 것으로 오류 화면을 띄우지 않는다.
let misses = 0
let heardAt = 0   // 고른 열차를 피드에서 마지막으로 본(또는 추적을 시작한) 시각

// 환승 1회에 걸리는 시간. 실측 전 추정값이다. 화면에는 '약'을 붙여 보여준다.
const TRANSFER_MIN = 4
// 환승 통로를 걸어 다음 승강장에 닿는 시간. 이보다 빨리 오는 열차는 자동으로 태우지 않는다.
const TRANSFER_WALK_SEC = 150
// 환승 화면에서 '지금 다음 열차 찾기'를 누르면 이미 승강장 가까이 왔다고 본다.
const TRANSFER_TAP_WALK_SEC = 120   // 60초였다. 내리자마자 누르면 닿지 못할 열차를 태웠다(리뷰 2라운드)
const tripStops = (p: Plan) => p.legs.reduce((n, l) => n + l.stops.length - 1, 0)
const tripMinutes = (p: Plan, pace = DEFAULT_PACE_MS) =>
  Math.round((tripStops(p) * pace) / 60_000 + (p.legs.length - 1) * TRANSFER_MIN)
// 남은 구간만 센다. 환승 화면과 주행 화면의 최종 도착 시각에 쓴다.
const restMinutes = (from: number, pace = DEFAULT_PACE_MS) =>
  Math.round((trip!.legs.slice(from).reduce((n, l) => n + l.stops.length - 1, 0) * pace) / 60_000
    + (trip!.legs.length - 1 - from) * TRANSFER_MIN)


const GPS_TIMEOUT_MS = 5000
// 서울 API는 하루 1000건이 한도다(ERROR-337).
// 폴링은 15초 한 가지다. 서울 피드가 약 15초마다 한꺼번에 갱신되고, 새 기록은 이미 10~35초 늦게 나온다(09-29 실측).
// 그보다 자주 봐도 얻는 것이 없고, 35초로 늦추면 평균 지연이 38초까지 늘었다. 15초면 평균 약 30초다.
// 주행 1분에 4건이다. 출퇴근 50분씩 두 번이면 하루 약 400건. 많이 탄 날을 위해 사용량에 따라 늦춘다.
const POLL_MS = 15_000
const POLL_SLOW_MS = 25_000      // 오늘 700건을 넘으면
const POLL_SLOWEST_MS = 35_000   // 오늘 850건을 넘으면

// 개발 모드 ?poll=fast 면 5초. 시뮬레이터 시나리오를 몇 분 안에 돌리려고 둔다. 배포본은 타지 않는다.
const FAST_POLL = !!import.meta.env?.DEV && new URLSearchParams(location.search).get('poll') === 'fast'
// 개발 모드 ?api=dev: 모사 데이터로 시험 중이다. 새벽 운행 안내를 건너뛴다(한밤중에도 시나리오를 돌린다). 배포본은 타지 않는다.
const MOCK_API = !!import.meta.env?.DEV && new URLSearchParams(location.search).get('api') === 'dev'
function pollDelay(): number {
  if (FAST_POLL) return 5_000
  if (misses >= 4) return POLL_SLOWEST_MS   // 고른 열차가 한동안 안 보인다. 아껴 가며 기다린다
  return used >= 850 ? POLL_SLOWEST_MS : used >= 700 ? POLL_SLOW_MS : POLL_MS
}
const leg = () => trip!.legs[legIndex]
const toward = () => leg().stops[leg().stops.length - 1]

function stopPolling(): void {
  pollGen += 1
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

// ---------- 출발역 ----------

// getAppLocation은 호스트의 마지막 위치를 그대로 돌려준다.
// 실측: 한 세션의 GPS 읽기 10번이 소수점 5자리까지 같은 좌표였다. 주행을 했는데도.
// 그래서 묵은 위치라도 일단 최선의 추정으로 목록을 띄우고, 새 측위를 계속 받아 조용히 고쳐 나간다.
// 사용자에게 "직접 고르세요"라고 시키지 않는다. 앱이 할 수 있는 일은 앱이 한다.
const GPS_FRESH_MS = 30_000
const RECENT_ARRIVAL_MS = 20 * 60_000
// '약 0m'는 읽기 어색하다. 가까우면 말로 한다.
// 묵은 위치에서 '약 879m'는 정밀하지 않은 값을 정밀하게 보이게 한다. 100m 단위로 반올림한다(리뷰 2라운드).
const dist = (m: number, rough: boolean): string =>
  m < 100 ? (rough ? '근처' : '바로 앞')
    : rough ? `약 ${m < 950 ? `${Math.round(m / 100) * 100}m` : `${(m / 1000).toFixed(1)}km`}`   // 950m 이상은 '1000m'가 아니라 '1.0km'
    : m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`
const ORIGIN_WATCH_MS = 180_000

type Loc = { latitude: number; longitude: number; accuracy?: number; timestamp?: number }

// timestamp 단위는 문서에 없다. 1e12보다 작으면 초로 보고 ms로 바꾼다. 원값은 로그로 남겨 배운다.
const tsMs = (t?: number): number | null =>
  t == null || !Number.isFinite(t) ? null : t < 1e12 ? t * 1000 : t
const ageSec = (l: Loc): number | null => {
  const t = tsMs(l.timestamp)
  return t == null ? null : Math.round((Date.now() - t) / 1000)
}
// 묵었거나(30초 초과) 오차가 크면(1km 초과) 목록 순서를 다 믿지 않는다. 버리지는 않는다.
const uncertain = (l: Loc): boolean =>
  ((ageSec(l) ?? 0) * 1000 > GPS_FRESH_MS) || ((l.accuracy ?? 0) > MAX_ACCURACY_M)

// 시뮬레이터는 위치 API를 모른다(브리지 메서드 목록에 없다). 개발 모드에서만 모사한다.
//   ?lat=37.6350&lon=127.0645   고정 좌표
//   ?gps=dev                    dev 서버의 /__gps 피드(.dev/gps.json: {lat, lon, acc?, ts?})를 읽는다.
//                               파일을 고치면 폰이 움직인 것이고, ts를 묵히면 묵은 위치를 모사한다.
// 배포본은 이 코드를 타지 않는다.
const devQuery = import.meta.env?.DEV ? new URLSearchParams(location.search) : null
const simFeed = devQuery?.get('gps') === 'dev'

async function simLocation(): Promise<Loc | null> {
  if (!devQuery) return null
  if (simFeed) {
    try {
      const r = await fetch('/__gps', { cache: 'no-store' })
      if (!r.ok) return null
      const j = await r.json() as { lat?: number; lon?: number; acc?: number; ts?: number }
      if (!Number.isFinite(j.lat) || !Number.isFinite(j.lon)) return null
      return { latitude: j.lat!, longitude: j.lon!, accuracy: j.acc ?? 5, timestamp: j.ts ?? Date.now() }
    } catch {
      return null
    }
  }
  const lat = Number(devQuery.get('lat')), lon = Number(devQuery.get('lon'))
  return Number.isFinite(lat) && Number.isFinite(lon) ? { latitude: lat, longitude: lon, accuracy: 5, timestamp: Date.now() } : null
}

// 지금 당장 받을 수 있는 위치. 기다리지 않는다. 없으면 null.
// 첫 호출이 null을 주는 것을 실기기에서 봤다. 한 번 더 부른다.
async function quickFix(): Promise<Loc | null> {
  const sim = await simLocation()
  if (sim) return sim
  for (let i = 0; i < 2; i++) {
    try {
      const l = await bridge.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: GPS_TIMEOUT_MS })
      if (l && Number.isFinite(l.latitude)) return l
    } catch (e) {
      log('gps failed', i, e)
    }
  }
  return null
}

// 출발역 후보. 위치가 있으면 가까운 순, 불확실하면 지난 도착역·최근 출발역을 앞으로 당긴다.
// 위치가 없으면 지난 도착역 → 최근 출발역 → 자주 가는 곳. 셋 다 없을 때만 빈 배열이다.
function originCandidates(fix: Loc | null): { name: string; label: string }[] {
  const out: { name: string; label: string }[] = []
  const seen = new Set<string>()
  const push = (name: string, label: string) => {
    if (name && !seen.has(name)) { seen.add(name); out.push({ name, label }) }
  }
  // 방금 내린 역이 가장 확실한 출발역이다. 앱이 직접 본 도착이 묵은 GPS보다 낫다.
  // 믿을 만한 새 측위가 1km 넘게 떨어진 곳을 가리킬 때만 양보한다. 그새 다른 곳으로 옮긴 것이다.
  if (lastArrived && Date.now() - lastArrivedAt < RECENT_ARRIVAL_MS) {
    const c = COORDS.find(c => c.name === lastArrived)
    const moved = fix && !uncertain(fix) && c && distanceM(fix.latitude, fix.longitude, c.lat, c.lon) > 1000
    if (!moved) push(lastArrived, `${lineLabel(lastArrived)}  방금 도착`)
  }
  // 주행 중에 여정을 나왔다면 타던 열차를 마지막으로 본 역이 묵은 GPS보다 낫다(지하에서는 GPS가 멈춘다. 리뷰 3라운드).
  const rode = resume?.departedAt && Date.now() - resume.at < RESUME_MS ? resume.lastSeen : ''
  if (rode && (!fix || uncertain(fix))) push(rode, `${lineLabel(rode)}  타던 열차 위치`)
  if (fix) {
    const unc = uncertain(fix)
    const near = nearest(fix.latitude, fix.longitude, COORDS, unc ? 12 : 8)
    // 묵은 위치 근처에 아는 역이 있으면 그게 정답일 가능성이 크다.
    const score = (n: Near) =>
      n.meters - (unc && n.name === lastArrived ? 800 : 0) - (unc && recents.includes(n.name) ? 400 : 0)
    for (const n of [...near].sort((a, b) => score(a) - score(b))) {
      push(n.name, `${lineLabel(n.name)}  ${dist(n.meters, unc)}`)
    }
  }
  push(lastArrived, `${lineLabel(lastArrived)}  지난 도착`)
  for (const r of recents) push(r, `${lineLabel(r)}  최근`)
  if (!out.length) for (const d of dests) push(d, `${lineLabel(d)}  자주 가는 곳`)
  return out
}

let originGen = 0
let originTop = ''
let originWatch: ReturnType<typeof setInterval> | null = null
let originUnsub: (() => void) | null = null

function stopOriginWatch(): void {
  if (originWatch) clearInterval(originWatch)
  originWatch = null
  if (originUnsub) {
    originUnsub()
    originUnsub = null
    Promise.resolve(bridge.stopAppLocationUpdates()).catch(() => {})
  }
}

async function renderOrigin(fix: Loc | null): Promise<boolean> {
  const cands = originCandidates(fix)
  if (!cands.length) return false
  rows = cands.map(c => c.name)
  originTop = rows[0]
  const items = S.rows(rows, n => cands.find(c => c.name === n)!.label)
  // 방금 떠난 여정을 5분 동안 되돌릴 수 있다. 둘째 줄에 둔다. 첫 줄(가장 가까운 역)을 습관처럼 누르면
  // 옛 여정이 되살아났다(리뷰 2라운드).
  if (resume && Date.now() - resume.at < RESUME_MS) {
    items.splice(1, 0, `← ${resume.trip.to} 안내 이어가기`)
    rows.splice(1, 0, '__resume')
  }
  // 한도가 가까우면 떠나기 전에 알린다. 도중에 끊기는 것보다 낫다.
  if (used >= QUOTA_WARN) {
    items.unshift(`오늘 조회 ${used}/${QUOTA_DAY} · KST 자정에 초기화`)
    rows = ['', ...rows]
  }
  if (!(await showList(items, () => S.listHead(Date.now(), '출발역')))) {
    rows = []
    await showLive(() => S.loading(Date.now(), '목록을 표시하지 못했습니다', '다시 그리는 중', '더블탭: 종료'))
  }
  return true
}

// 사용자가 고르기 전까지 새 측위를 받아 목록을 고쳐 나간다. 맨 위 역이 바뀔 때만 다시 그린다.
function startOriginWatch(gen: number, since: number): void {
  const onFix = async (l: Loc) => {
    if (gen !== originGen || mode !== 'origin' || busy || menuOpen) return
    // 이 화면에 오래 머물면 GPS를 끈다. 배터리를 먹으면서 아무도 안 보는 목록을 고치는 일은 없다.
    if (Date.now() - since > ORIGIN_WATCH_MS) return stopOriginWatch()
    const t = tsMs(l.timestamp)
    if (t != null && t < since) return          // 요청 전에 찍힌 묵은 값이다
    log('gps push', l.latitude, l.longitude, 'acc', l.accuracy, 'ts', l.timestamp, 'age', ageSec(l))
    const cands = originCandidates(l)
    if (cands.length && (cands[0].name !== originTop || !rows.length)) {
      log('gps refine', originTop || '-', '->', cands[0].name)
      await renderOrigin(l)
    }
  }
  if (simFeed) {
    originWatch = every(() => { void simLocation().then(l => { if (l) void onFix(l) }) }, 3000)
  } else {
    originUnsub = bridge.onAppLocationChanged(l => { void onFix(l) })
    Promise.resolve(bridge.startAppLocationUpdates({ accuracy: AppLocationAccuracy.High, intervalMs: 3000 }))
      .catch(e => log('gps updates unsupported', e))
  }
}

// 여정을 떠나기 직전 상태. 5분 동안 출발역 목록 맨 위에 '← 청담 안내 이어가기'로 되돌린다.
type Resume = {
  at: number; mode: Mode; trip: Plan; legIndex: number; stops: string[]; train: Arrival | null; fixes: Fix[]
  boardedAt: number; departedAt: number; approach: string; approachStatus: number
  lastSeen: string; prevSeen: string; atStatus: number; note: string; origin: string
}
// 두 갈래다. resume는 출발역 목록의 '이어가기'(실수로 여정을 나갔을 때). repickFrom은 주행 중 다시 고르기에서 돌아갈 추적.
// 하나로 쓰다가, 버린 여정 A가 새 여정 B의 열차 목록에서 더블탭하면 되살아났다(리뷰 2라운드).
let resume: Resume | null = null
let repickFrom: Resume | null = null
const RESUME_MS = 5 * 60_000
async function resumeTrip(r: Resume): Promise<void> {
  stopOriginWatch()
  ;({ trip, legIndex, stops, train, fixes, boardedAt, departedAt, approach, approachStatus, lastSeen, prevSeen, atStatus, note, origin } = r)
  log('resume', r.mode, r.trip.to)
  if (r.mode === 'riding' && train) {
    mode = 'riding'
    menuOpen = false
    stopPolling()
    heardAt = Date.now()
    nextPollAt = Date.now()
    schedulePoll(pollGen, 0, 'resume')
    return render()
  }
  if (r.mode === 'transfer') return arrive()
  return startLeg(legIndex)
}

const snapshot = (): Resume => ({
  at: Date.now(), mode, trip: trip!, legIndex, stops, train, fixes: fixes.map(f => ({ ...f })),
  boardedAt, departedAt, approach, approachStatus, lastSeen, prevSeen, atStatus, note, origin,
})
// 주행 중에 열차를 다시 고르러 가면(놓침 탭, 메뉴) 지금 추적을 남겨 둔다. 목록 맨 위 '← 타고 있음 · 계속 안내',
// 더블탭, 또는 20초 동안 아무것도 안 고르면 그대로 돌아온다. 실수 탭으로 하차 안내를 잃지 않는다(리뷰 2라운드).
async function repick(why: string): Promise<void> {
  repickFrom = snapshot()
  log('repick', why)
  stopPolling()
  // 출발 직후의 탭 한 번은 실수일 수 있다(안경을 고쳐 쓰다 누름). 목록이 뜬 뒤 9초 안에 아무것도 안 고르면
  // 원래 추적으로 돌아간다(showPickList). 메뉴에서 일부러 고른 '열차 다시 고르기'는 돌아가지 않는다.
  repickAuto = why === 'missed train'
  repickUntil = 0
  return showPick(false)
}
// 목록 커서 이동은 앱에 알려지지 않으므로 머리줄에 초읽기를 둔다('9초 뒤 복귀'. 두 자리 초는 32칸을 넘어 9초로 정했다).
// 처리 중(busy)이면 1초 뒤 다시 본다. 건너뛰면 추적이 멈춘 채 남았다(리뷰 3라운드).
function armReturn(snap: Resume, ms: number): void {
  later(() => {
    if (repickFrom !== snap || mode !== 'pick') return
    if (busy) return armReturn(snap, 1000)
    void backToRide('timeout')
  }, ms)
}
async function backToRide(why: string): Promise<void> {
  const r = repickFrom
  repickFrom = null
  if (!r) return
  log('back to ride', why)
  return resumeTrip(r)
}

// intentional: 메뉴의 '처음으로'처럼 일부러 나갔다. 되돌리기를 남기지 않는다.
async function showOrigin(intentional = false): Promise<void> {
  if (trip && (mode === 'riding' || mode === 'transfer' || mode === 'pick') && !intentional) {
    const base = repickFrom ?? snapshot()
    // 같은 여정을 또 나가면 5분을 새로 주지 않는다
    resume = resume && resume.trip === base.trip ? { ...base, at: resume.at } : base
    log('left trip, resumable', resume.mode, trip.to)
  } else if (intentional) { resume = null; ride = null }
  repickFrom = null
  mode = 'origin'
  trip = null
  train = null
  menuOpen = false
  stopPolling()
  stopTransferWatch()
  stopOriginWatch()
  const gen = ++originGen
  const since = Date.now()
  // 위치가 금방 오면 목록으로 바로 간다. 늦으면(실기기에서 최대 10초) 탭이 먹혔다는 것부터 보인다.
  const slow = later(() => {
    if (gen === originGen) void showLive(() => S.loading(Date.now(), '출발역 찾는 중', '위치 받는 중'))
  }, 300)
  const quick = await quickFix()
  clearTimeout(slow)
  log('gps', quick?.latitude, quick?.longitude, 'acc', quick?.accuracy, 'ts', quick?.timestamp, 'age', quick ? ageSec(quick) : null)
  if (gen !== originGen) return
  // 일단 지금 아는 것으로 띄운다. 묵은 위치든 지난 도착역이든, 없는 것보다 낫다.
  const shown = await renderOrigin(quick)
  if (!shown) {
    rows = []
    // 위치도, 이력도, 자주 가는 곳도 없다. 이때만 사용자에게 말한다.
    await showLive(() => S.loading(Date.now(), '출발역을 정하는 중', '위치 받는 중',
      dests.length ? '' : '자주 가는 곳을 넣어두면 위치 없이도 시작합니다'))
  }
  // 위치가 없거나 묵었으면 새 측위를 계속 받아 고쳐 나간다.
  if (!quick || uncertain(quick)) startOriginWatch(gen, since)
}

// ---------- 도착지 ----------

async function showDest(): Promise<void> {
  mode = 'dest'
  // 이 출발역에서 최근에 간 곳을 위로 올린다. 안경에서 스크롤은 비싸다. 한 번도 안 간 곳은 폰에 넣은 순서다.
  const recent = [...prefs.keys()].filter(k => k.startsWith(`${origin}>`)).map(k => k.slice(origin.length + 1)).reverse()
  const rank = (d: string) => { const i = recent.indexOf(d); return i < 0 ? recent.length + dests.indexOf(d) : i }
  const shown = dests.filter(d => d !== origin).sort((a, b) => rank(a) - rank(b))
  if (!shown.length) {
    rows = []
    return showLive(() => S.notice(Date.now(), '갈 곳이 없습니다', '폰 화면에서 자주 가는 곳을 넣으세요', '탭: 출발역 다시 고르기'))
  }
  rows = shown
  // 경로가 없는 곳도 숨기지 않는다. 사용자가 일부러 넣은 것이고,
  // 목록에서 사라지면 저장이 안 된 줄 안다. 왜 못 가는지 그 자리에서 말한다.
  const plans = new Map(shown.map(d => [d, plan(origin, d)]))
  const xfer = (p: Plan) => (p.legs.length > 1 ? ` · 환승 ${p.legs.length - 1}` : '')
  const items = S.rows(shown,
    d => { const p = plans.get(d); return p ? `${tripStops(p)}정거장 · 약 ${tripMinutes(p)}분${xfer(p)}` : '경로 없음' },
    d => { const p = plans.get(d); return p ? `약 ${tripMinutes(p)}분${xfer(p)}` : '경로 없음' },
    d => { const p = plans.get(d); return p ? `약 ${tripMinutes(p)}분` : '경로 없음' },
  )
  if (!(await showList(items, () => S.listHead(Date.now(), `${origin} →`, '도착지')))) {
    rows = []
    await showLive(() => S.notice(Date.now(), '목록을 표시하지 못했습니다', '', '탭: 출발역 다시 고르기'))
  }
}

// 출발역에 노선이 여럿이면 어느 노선으로 떠날지 사용자가 고른다.
// 최단 경로만 내밀면 "호선을 지맘대로 고른다"는 말을 듣는다.
const routeKey = (p: Plan) => p.legs.map(l => `${l.line}:${l.stops.length}`).join('/')

function routeOptions(dest: string): Plan[] {
  // 최선 경로를 먼저 넣는다. 방면별 탐색만 돌리면 최선이 빠지는 경우가 있다.
  // 실측: 1637개 경로 중 10건에서 가장 빠른 길이 선택지에 없었다.
  const best = plan(origin, dest)
  if (!best) return []
  const seen = new Set([routeKey(best)])
  const out = [best]
  // 선택지의 단위는 노선이 아니라 (노선, 방면)이다. 노선만 보면 양쪽 방향이
  // 한 후보로 뭉개져 빠른 쪽만 남는다. 하계에는 7호선뿐이지만
  // 중계 방면과 공릉 방면은 전혀 다른 여정이다.
  for (const d of departures(origin)) {
    const p = planHop(origin, dest, d.line, d.next)
    if (!p || seen.has(routeKey(p))) continue
    seen.add(routeKey(p))
    out.push(p)
  }
  // 아무도 고르지 않을 선택지는 뺀다. 환승 3~4번짜리를 내밀면 목록이 쓸모없어진다.
  // 실측으로 정한 경계다(쓸모없는 선택지 131건 → 46건, 최선은 하나도 잃지 않음).
  const legCap = best.legs.length + 1
  const timeCap = tripMinutes(best) + 15
  const kept = out.filter((p, i) => i === 0 || (p.legs.length <= legCap && tripMinutes(p) <= timeCap))
  // 빠른 것부터. 정거장 수에 환승 시간을 더해 견준다.
  kept.sort((a, b) => tripMinutes(a) - tripMinutes(b))
  // 지난번에 고른 길이 있으면 맨 위로 올린다. 바꾸고 싶으면 아래를 고르면 된다.
  const liked = prefs.get(`${origin}>${dest}`)
  if (liked) {
    const i = kept.findIndex(p => routeKey(p) === liked)
    if (i > 0) kept.unshift(...kept.splice(i, 1))
  }
  return kept
}

async function chooseRoute(dest: string): Promise<void> {
  options = routeOptions(dest)
  if (!options.length) {
    // 'line' 모드에 빈 선택지를 두면 탭이 도착지 목록으로 돌아간다. 문구가 그렇게 약속한다.
    mode = 'line'
    rows = []
    // 실시간 미지원 노선(인천·김포·용인·의정부)의 역은 그래프에 없어서 여기로 온다
    return showLive(() => S.notice(Date.now(), '경로를 찾지 못했습니다', `${origin} → ${dest}`, '탭: 도착지 다시 고르기'))
  }
  if (options.length === 1) return startTrip(options[0])

  mode = 'line'
  // 같은 노선이 방면만 다르게 두 번 나올 수 있다. 자리번호로 고른다.
  rows = options.map((_, i) => String(i))
  const liked = prefs.get(`${origin}>${dest}`)
  const mark = (p: Plan) => (routeKey(p) === liked ? '★ ' : '')
  const head = (p: Plan) => `${mark(p)}${p.legs[0].line} ${p.legs[0].stops[1]} 방면`
  // 어디서 갈아타는지가 선택의 핵심이다. '환승 2'만으로는 두 길을 구별할 수 없었다.
  const via = (p: Plan) => (p.legs.length > 1 ? `${p.legs.slice(1).map(l => l.stops[0]).join('·')} 환승` : '직통')
  // '약'은 붙이지 않는다. 행마다 넘침 여부가 달라 어떤 행엔 붙고 어떤 행엔 빠지는 것이 더 어색했다.
  const items = S.tiers(
    options.map(p => `${head(p)}  ${via(p)} · ${tripMinutes(p)}분`),
    options.map(p => `${head(p)}  환승 ${p.legs.length - 1} · ${tripMinutes(p)}분`),
    options.map(p => `${head(p)}  ${tripMinutes(p)}분`),
  )
  log('options', items.join(' / '))
  if (!(await showList(items, () => S.listHead(Date.now(), `${origin} → ${dest}`, `→ ${dest}`, '경로')))) {
    rows = []
    await showLive(() => S.notice(Date.now(), '노선 목록을 표시하지 못했습니다', '', '탭: 도착지 다시 고르기'))
  }
}

async function startTrip(picked: Plan): Promise<void> {
  trip = picked
  const dest = picked.to
  await rememberOrigin(origin)
  // 고른 길을 기억한다. 다음에 같은 구간이면 맨 위에 둔다.
  // 지웠다가 다시 넣어 맨 뒤로 보낸다. 순서가 곧 최근 사용 순서다(목적지 정렬에 쓴다).
  prefs.delete(`${origin}>${dest}`)
  prefs.set(`${origin}>${dest}`, routeKey(picked))
  const flat = [...prefs].slice(-40).map(([k, v]) => `${k}\t${v}`).join('\n')
  void bridge.setLocalStorage('prefs', flat)
  log('plan', origin, '->', dest, trip.legs.map(l => `${l.line}[${l.stops.slice(0, 3).join('·')}…${l.stops[l.stops.length - 1]}]`).join(' ▶ '))
  // 클로저 안에서는 let trip의 null 좁히기가 풀린다. 인자 picked가 같은 값이다.
  await showLive(() => S.route({
    now: Date.now(), from: picked.from, to: picked.to, legs: picked.legs,
    stops: tripStops(picked), minutes: tripMinutes(picked),
    quota: used >= QUOTA_WARN ? `오늘 조회 ${used}/${QUOTA_DAY}` : undefined,
  }))
  routeShownAt = Date.now()
  await startLeg(0, true)
}

// 경로 요약 화면을 최소한 이만큼 보여준다. 조회가 빨리 끝나면 0.3초 만에 목록에 덮여 아무도 못 읽었다.
const ROUTE_HOLD_MS = 1500
let routeShownAt = 0

// ---------- 탈 열차 ----------

let pickWalk = 0          // 지금 구간에서 걸어서 닿는 데 드는 초(환승이면 >0)
async function startLeg(i: number, quiet = false, walkSec = 0): Promise<void> {
  stopTransferWatch()
  legIndex = i
  autoRepicks = 0
  emptySince = 0
  pickWalk = walkSec
  stops = leg().stops
  train = null
  approach = ''
  note = ''
  stranded = false
  await showPick(true, quiet, walkSec)
}

// autoBoard: 후보가 1대면 바로 태운다. 사용자가 "다시 고르기"로 왔을 때는 끈다.
// 켜 둔 채로 다시 고르면 같은 열차를 또 태워서 아무 일도 없는 것처럼 보인다.
// quiet: 경로 요약 화면이 이미 '열차를 확인하는 중'을 보이고 있다. 그 위에 로딩을 덮지 않는다.
// walkSec: 환승처럼 걸어가야 하면 그보다 빨리 오는 열차는 자동으로 태우지 않는다(닿을 수 없다, 리뷰 1라운드).
// prefer: 이 시각(ms)에 가장 가까이 오는 열차를 앱이 태운다(자동 다시 고르기). 목록을 띄워 사용자에게 떠넘기지 않는다.
async function showPick(autoBoard = true, quiet = false, walkSec = 0, prefer = 0): Promise<void> {
  mode = 'pick'
  pickGen += 1
  const gen = pickGen
  const from = stops[0]
  const ln = leg().line
  // 조회에 시간이 걸린다. 탭이 먹혔다는 것을 먼저 보여준다.
  if (!quiet) await showLive(() => S.loading(Date.now(), `${ln} 열차 확인 중`, '', backHint(), from))
  const hold = () => (quiet ? new Promise<void>(r => later(r, Math.max(0, routeShownAt + ROUTE_HOLD_MS - Date.now()))) : null)
  let all: Arrival[]
  try {
    all = await arrivals(from)
    await hold()
  } catch (e) {
    await hold()
    log('arrivals failed', e)
    rows = []
    if (e instanceof BurstError) {
      // 시간이 되면 앱이 알아서 다시 조회한다. 초가 줄어드는 게 보이고, 더블탭으로 언제든 나갈 수 있다.
      const until = Date.now() + e.waitSec * 1000
      retryPick(e.waitSec + 1, 'burst')
      return showLive(() => S.loading(Date.now(), '조회가 잦아 잠시 쉽니다',
        `${Math.max(0, Math.ceil((until - Date.now()) / 1000))}초 뒤 다시 확인`, backHint(), from))
    }
    // 한도 소진은 기다려도 낫지 않는다. 자정까지는 앱이 할 수 있는 게 없다.
    if (e instanceof QuotaError) return showLive(() => S.notice(Date.now(), e.message, `오늘 ${used}/${QUOTA_DAY} · KST 자정에 초기화`, backHint()))
    if (e instanceof ApiError) return showLive(() => S.notice(Date.now(), e.message, 'KST 자정에 초기화됩니다', backHint()))
    const wait = FAST_POLL ? 5 : 20
    const until = Date.now() + wait * 1000
    retryPick(wait, 'error')
    return showLive(() => S.loading(Date.now(), '도착 정보를 받지 못했습니다',
      `${Math.max(0, Math.ceil((until - Date.now()) / 1000))}초 뒤 다시 확인`, `탭: 지금 확인\n${backHint()}`, from))
  }
  if (queuedDouble || gen !== pickGen) return   // 사용자가 이미 다른 데로 갔다
  picksAt = Date.now()
  const candidates = pickCandidates(all, repickFrom?.train?.trainNo)
  log('candidates', candidates.length, '| 다음역', stops[1], '| 온 방면', all.filter(a => a.line === ln).map(a => a.toward).join(',') || '없음',
    '| 조회이름', arrivalName(from), walkSec ? `| 걸어서 ${walkSec}초` : '')

  if (!candidates.length) {
    rows = []
    // 새벽(01~05시)에 조회가 비었으면 운행이 끝난 것이다. 시각만으로 막으면 1시 넘어 달리는 막차를 막았다(리뷰 2라운드).
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false })) % 24
    if (hour >= 1 && hour < 5 && !MOCK_API) {
      log('no trains at night')
      return showLive(() => S.notice(Date.now(), '지금은 운행 시간이 아닙니다', '첫차는 5시 30분 무렵입니다', `탭: 다시 확인\n${backHint()}`, `${from} ${ln}`))
    }
    // 앱이 알아서 다시 본다. 간격을 늘려 가다가 10분이 지나면 멈춘다. 막차가 끝났을 수 있다(리뷰 1라운드: 무한 재조회).
    if (!emptySince) emptySince = Date.now()
    const waited = Date.now() - emptySince
    if (waited > (FAST_POLL ? 40_000 : 600_000)) {
      log('no trains, stop retrying after', Math.round(waited / 1000) + 's')
      return showLive(() => S.notice(Date.now(), '열차가 오지 않습니다', '막차가 끝났을 수 있습니다', `탭: 다시 확인\n${backHint()}`, `${from} ${ln}`))
    }
    const wait = FAST_POLL ? 8 : waited < 120_000 ? 30 : 60
    const until = Date.now() + wait * 1000
    retryPick(wait, 'no candidates')
    return showLive(() => S.loading(Date.now(), `${stops[1] ?? toward()} 방면 열차가 아직 없습니다`,
      `${Math.max(0, Math.ceil((until - Date.now()) / 1000))}초 뒤 다시 확인`, `탭: 지금 확인\n${backHint()}`, `${from} ${ln}`))
  }
  emptySince = 0
  if (prefer) {
    return board(closest(candidates, a => picksAt + a.etaSec * 1000, prefer))
  }
  // 환승 뒤 자동 진행: 걸어서 닿을 수 있는 첫 열차를 태운다. 닿을 열차가 없으면 목록을 보인다.
  if (autoBoard && walkSec) {
    const reachable = candidates.filter(a => a.etaSec >= walkSec)
    if (reachable.length) return board(reachable[0])
  } else if (candidates.length === 1 && autoBoard) return board(candidates[0])

  await showPickList(candidates, from, ln)
  // 목록을 보는 동안 20초마다 다시 조회한다. 떠난 열차는 빠지고 새 열차가 들어온다. 10분 뒤에는 멈춘다(조회 예산).
  schedulePickRefresh(gen, Date.now() + 10 * 60_000)
}

// 같은 노선, 같은 방향만. 방향은 "…방면" 역이 다음 역과 같은지로 가른다. updnLine은 읽지 않는다.
// 이름 표기가 어긋나 0대가 되면 방향을 거르지 않는다. "도착 정보 없음"으로 막히는 것보다 낫다.
// 이 역을 이미 떠난 열차(arvlCd 2)와 놓친 열차(exclude)는 뺀다. 떠난 열차를 '곧 도착'으로 맨 위에 두고
// 후보가 하나면 자동으로 태웠다(리뷰 2라운드).
function pickCandidates(all: Arrival[], exclude?: string): Arrival[] {
  const sameLine = all.filter(a => a.trainNo && a.line === leg().line && a.code !== 2 && a.trainNo !== exclude
    && reaches(leg().line, stops, a.dest))
  const sameWay = sameLine.filter(a => a.toward === stops[1])
  return (sameWay.length ? sameWay : sameLine).sort((a, b) => a.etaSec - b.etaSec).slice(0, 18)
}

// 목록 항목은 도착 시각(조회 시각 기준)이다. '3분'처럼 상대 시간을 쓰면 목록을 보는 동안 줄지 않아 틀려졌다.
// 머리줄이 초 단위 현재시각이라 곧바로 견줄 수 있다. 1분 안이면 '곧 도착'. 막차는 표시한다.
const pickLabel = (a: Arrival, level: number) => {
  const at = a.etaSec < 60 ? '곧 도착' : S.hhmm(picksAt + a.etaSec * 1000)
  const tail = `${a.express ? ' 급행' : ''}${a.last ? ' 막차' : ''}`
  return level === 0 ? `${at}  ${a.toward} 방면 · ${a.dest}행${tail}` : level === 1 ? `${at}  ${a.toward} 방면${tail}` : `${at}  ${a.toward} 방면`
}
let pickShown = ''
let repickUntil = 0
let repickAuto = false
async function showPickList(candidates: Arrival[], from: string, ln: string): Promise<void> {
  picks = candidates
  rows = candidates.map(a => a.trainNo)
  const items = S.tiers(...[0, 1, 2].map(l => candidates.map(a => pickLabel(a, l))))
  // 다시 그릴지는 열차 번호가 바뀌었는지로 정한다. 분 표기만 바뀌어도 다시 그리면 커서가 맨 위로 돌아갔다(리뷰 2라운드).
  pickShown = candidates.map(a => a.trainNo).join(',')
  if (repickFrom) {
    items.unshift('← 타고 있음 · 계속 안내')
    rows.unshift('__back')
  }
  const head = () => S.listHead(Date.now(),
    ...(repickFrom && repickUntil > Date.now() ? [`${Math.ceil((repickUntil - Date.now()) / 1000)}초 뒤 복귀`] : []), `${from} ${ln}`, ln)
  // 첫 그림부터 초읽기가 보이게 미리 잡고, 목록이 실제로 뜬 순간부터 다시 9초를 센다.
  const arm = repickFrom && repickAuto && !repickUntil ? repickFrom : null
  if (arm) repickUntil = Date.now() + 9_000
  const shown = await showList(items, head)
  if (arm) {
    repickUntil = shown ? Date.now() + 9_000 : 0
    if (shown) armReturn(arm, 9_000)
  }
  if (!shown) {
    rows = []
    retryPick(FAST_POLL ? 5 : 15, 'list failed')
    await showLive(() => S.loading(Date.now(), '열차 목록을 다시 그리는 중', '', backHint(), from))
  }
}
function schedulePickRefresh(gen: number, until: number): void {
  pickRefreshing = true
  later(async () => {
    if (gen !== pickGen || mode !== 'pick' || busy || !picks.length || Date.now() > until) { pickRefreshing = false; return }
    try {
      const all = await arrivals(stops[0])
      if (gen !== pickGen || mode !== 'pick' || busy) return
      const next = pickCandidates(all, repickFrom?.train?.trainNo)
      // 열차 번호가 바뀔 때만 다시 그린다(떠난 열차가 빠지거나 새 열차가 들어올 때). 도착 시각 기준도 그때만 바꾼다.
      if (next.length && next.map(a => a.trainNo).join(',') !== pickShown) {
        picksAt = Date.now()
        log('pick refresh', next.length)
        await showPickList(next, stops[0], leg().line)
      }
    } catch (e) { log('pick refresh failed', e) }
    schedulePickRefresh(gen, until)
  }, FAST_POLL ? 8_000 : 20_000)
}

let picks: Arrival[] = []
let picksAt = 0          // 목록의 도착 정보를 받은 시각. 도착 예정은 여기서부터 센다
let emptySince = 0       // 열차가 없다고 처음 본 시각. 10분이 지나면 재조회를 멈춘다
// 자동 재시도. 사용자가 탭하거나 다른 흐름이 시작되면 세대가 바뀌어 옛 타이머는 아무것도 하지 않는다.
let pickGen = 0
let autoRepicks = 0
let pickRetrying = false
let pickRefreshing = false
function retryPick(sec: number, why: string): void {
  const g = pickGen
  pickRetrying = true
  log('pick retry in', sec + 's', why)
  later(() => { pickRetrying = false; if (g === pickGen && mode === 'pick' && !busy) void showPick(true, false, pickWalk) }, sec * 1000)
}

async function board(a: Arrival): Promise<void> {
  train = a
  // 도착 예정은 도착 정보를 받은 시각부터 센다. 탭한 시각부터 세면 목록을 오래 볼수록 늦게 나왔다.
  boardedAt = picksAt || Date.now()
  departedAt = 0
  resume = null
  repickFrom = null
  approach = ''
  fixes = []
  atStatus = -1
  lastPollFailed = false
  lastSeen = ''
  prevSeen = ''
  note = ''
  stranded = false
  menuOpen = false
  mode = 'riding'
  log('boarded', a.trainNo, leg().line, 'eta', a.etaSec)
  const r = ride ??= { at: Date.now(), used, writes: allWrites + writes, bytes: allBytes + writeBytes }
  void logBattery('boarded').then(b => { r.battery ??= b })
  await show(S.waiting({
    now: Date.now(), line: leg().line, toward: a.dest || a.toward,
    at: '', from: stops[0], arriveAt: boardedAt + a.etaSec * 1000, refresh: refresh(), hint: hintNow(),
  }))
  stopPolling()
  misses = 0
  heardAt = Date.now()
  nextPollAt = Date.now()
  // 탭 핸들러 안에서는 busy라 poll이 조회를 건너뛴다. 실기기에서 첫 조회가 20초 늦었다. 핸들러가 끝난 직후에 돈다.
  schedulePoll(pollGen, 0, 'boarded')
}

// 폴링 예약은 언제나 하나뿐이다. 새로 걸기 전에 걸려 있던 것을 지운다.
// 타이머가 어떤 이유로 겹쳐 불려도 사슬이 둘로 갈라지지 않는다.
function schedulePoll(gen: number, ms: number, why: string): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = later(() => { pollTimer = null; void poll(gen, why) }, ms)
}

// ---------- 추적 ----------

async function poll(gen: number, why = 'timer'): Promise<void> {
  if (gen !== pollGen || mode !== 'riding') return
  if (!busy) {
    try {
      log('poll', why, 'gen', gen)
      let me = (await positions(leg().line, train!.trainNo)).find(t => t.trainNo === train!.trainNo)
      if (gen !== pollGen) return   // 기다리는 사이에 다른 흐름이 시작됐다
      lastPollFailed = false
      showFails = 0
      if (me) heardAt = Date.now()
      if (!me) {
        misses += 1
        log('train not in feed', train!.trainNo, 'misses', misses)
        // 타기 전에 세 번 연속 없으면 열차번호가 바뀌었거나 잘못 잡은 것이다. 앱이 다시 고른다(두 번까지).
        if (misses >= 3 && autoRepicks < 2 && !fixes.length) {
          autoRepicks += 1
          log('auto repick', autoRepicks)
          stopPolling()
          // 열차번호가 바뀌었거나 잘못 잡았다. 원래 예정 시각에 가장 가까운 열차를 앱이 다시 태운다(리뷰 3라운드:
          // 이유 없이 목록을 띄우고 추적을 멈췄다). 같은 열차면 같은 열차를 다시 기다린다.
          return showPick(true, true, 0, boardedAt + train!.etaSec * 1000)
        }
        // 열차가 피드에서 사라졌다. 폴링은 느려지고(pollDelay), 10분이 넘으면 멈춘다.
        // 끝없이 15초마다 조회하던 것을 막는다(리뷰 2라운드). 타기 전(자동 다시 고르기를 다 쓴 뒤)에도 같다(리뷰 3라운드 전 점검).
        if (Date.now() - heardAt > 10 * 60_000) {
          log('train lost for 10 min, stop')
          stopPolling()
          mode = 'arrived'
          rows = []
          return showLive(() => S.notice(Date.now(), '열차 정보가 끊겼습니다', '10분 넘게 위치가 안 보입니다', '탭: 처음으로\n더블탭: 종료', leg().line))
        }
      } else if (me.status === 3 && me.station === stops[0] && !fixes.length) {
        // 전역출발: 앞 역을 떠나 출발역으로 오는 중이다. 아직 타지 않았다.
        misses = 0
        approach = me.station
        approachStatus = 3
        approachAt = me.at
        log('train approaching', me.station, '접근', 'at', new Date(me.at).toTimeString().slice(0, 8))
      } else if (stops.includes(me.station)) {
        // 전역출발(3)은 경로상 한 역 앞을 떠난 것이다. 이 역에 닿은 것으로 치면 위치가 한 역 앞서간다.
        if (me.status === 3 && stops.indexOf(me.station) > 0) me = { ...me, station: stops[stops.indexOf(me.station) - 1], status: 2 }
        misses = 0
        approach = ''
        atStatus = me.status
        const last = fixes[fixes.length - 1]
        const now = Date.now()
        if (!last || last.station !== me.station) {
          fixes.push({ station: me.station, at: me.at, seen: now, status: me.status })
          // 열차 이동을 진단 기록에 남긴다. 이게 없으면 주행 중엔 req 줄만 보여 어디쯤인지 모른다.
          log('fix', me.station, S.statusWord(me.status), 'left', stopsLeft(stops, me.station), 'pace', Math.round(paceMs(stops, fixes) / 1000) + 's')
        } else {
          // 같은 역을 다시 봤다. 서 있는 열차를 다음 역으로 밀지 않게 확인 시각을 갱신한다. 상태가 바뀌면 사건 시각도.
          last.seen = now
          if (me.status !== last.status) { last.status = me.status; last.at = me.at }
        }
        // 출발역을 떠났다. 이때부터 2분 동안 탭 한 번이 '못 탔으면 다음 열차'다.
        if (!departedAt && (me.station !== stops[0] || me.status === 2)) { departedAt = now; log('departed', stops[0]) }
        // 두 정거장 전이면 메뉴를 닫는다. 메뉴가 하차 안내를 가리면 안 된다(리뷰 1라운드).
        if (menuOpen && stopsLeft(stops, me.station) <= 2) { closeMenu('near stop'); }
      } else if (!fixes.length) {
        // 고른 열차가 아직 승강장에 오지 않았다. 오는 중이다.
        misses = 0
        approach = me.station
        approachStatus = me.status
        approachAt = me.at
        log('train approaching', me.station, 'at', new Date(me.at).toTimeString().slice(0, 8))
      } else {
        // 타고 있는데 경로 밖 역이 관측됐다. 반대 방향, 지나침, 지선 이탈 중 하나다.
        misses = 0
        atStatus = me.status
        applyDeviation(deviation(leg(), me.station, lastSeen || null, me.status, trip!.to), me.station, me.at)
      }
      if (me && me.station !== lastSeen) { prevSeen = lastSeen; lastSeen = me.station }
    } catch (e) {
      // 일시적 실패는 화면을 바꾸지 않는다. render가 추정으로 처리한다.
      // 'The string did not match the expected pattern'처럼 메시지만으로 출처를 모르는 오류가 있었다.
      const st = e instanceof Error && e.stack ? ' @ ' + e.stack.split('\n').slice(0, 3).join(' | ') : ''
      log('poll failed', e instanceof Error ? e.name : typeof e, String(e) + st)
      if (e instanceof BurstError) {
        // 실패가 아니다. 화면은 그대로 두고 풀리는 시각에 맞춰 다음 폴링을 잡는다.
        if (gen === pollGen && mode === 'riding') {
          pollWait = e.waitSec * 1000
          nextPollAt = Date.now() + pollWait
          schedulePoll(gen, pollWait, 'burst')
        }
        return
      }
      lastPollFailed = true
      if (e instanceof QuotaError) {
        stopPolling()
        mode = 'arrived'
        rows = []
        return showLive(() => S.notice(Date.now(), e.message, `오늘 ${used}/${QUOTA_DAY}`, '탭: 처음으로\n더블탭: 종료'))
      }
      if (e instanceof ApiError) {
        // 한도 소진 같은 것은 기다려도 낫지 않는다. 숨기지 않고 말한다.
        stopPolling()
        mode = 'arrived'
        rows = []
        return showLive(() => S.notice(Date.now(), e.message, '자정에 초기화됩니다', '탭: 처음으로\n더블탭: 종료'))
      }
    }
    await render()
    // 모아 둔 진단 기록을 조회 직후에 보낸다. 통신을 따로 깨우지 않는다(리뷰 1라운드).
    flushLog()
  }
  if (gen === pollGen && mode === 'riding') {
    pollWait = pollDelay()
    nextPollAt = Date.now() + pollWait
    schedulePoll(gen, pollWait, 'timer')
  }
}

// 이탈 판정 결과를 여정에 반영한다. 구간을 다시 써서 기존 환승·도착 흐름이 그대로 이어받게 한다.
function applyDeviation(d: Deviation, seen: string, at: number): void {
  log('deviation', d.kind, d.kind === 'getOff' ? `${d.reason} at ${d.at}` : '', 'seen', seen, 'prev', lastSeen || '-')
  if (d.kind === 'on' || d.kind === 'unknown') return
  const done = trip!.legs.slice(0, legIndex)
  if (d.kind === 'continue') {
    // 이 열차를 그대로 탄다. 남은 여정만 새 경로로 바꾼다.
    trip = { from: trip!.from, to: trip!.to, legs: [...done, ...d.plan.legs] }
    stops = leg().stops
    fixes = [{ station: seen, at }]
    note = '경로 변경'
    return
  }
  // 내려야 한다. 현재 구간을 [지금 역, 내릴 역]으로 다시 쓰면 하차 안내와 환승 화면이 그대로 이어진다.
  const cur = { line: leg().line, stops: d.at === seen ? [seen] : [seen, d.at] }
  trip = { from: trip!.from, to: trip!.to, legs: [...done, cur, ...(d.plan?.legs ?? [])] }
  stops = cur.stops
  fixes = [{ station: seen, at }]
  note = d.reason === 'wrongWay' ? '반대 방향' : d.reason === 'missed' ? '지나침' : '지선 이탈'
  stranded = !d.plan && d.at !== trip.to
}

// 주행 중 탭 메뉴. 8초 뒤 스스로 닫힌다. 두 정거장 전이 되면 곧바로 닫힌다(폴링에서).
// 메뉴가 열린 채로 하차 안내를 가리면 안 된다(리뷰 1라운드: 안경을 고쳐 쓰다 탭이 들어가면 하차 안내가 안 떴다).
let menuTimer: ReturnType<typeof setTimeout> | null = null
let menuUntil = 0
async function showMenu(): Promise<void> {
  menuOpen = true
  rows = [...MENU]
  menuUntil = Date.now() + 8000
  // 메뉴가 예고 없이 사라지지 않게 머리줄에 닫힘 초읽기를 둔다(리뷰 2라운드).
  if (!(await showList([...MENU], () => S.listHead(Date.now(), `${Math.max(0, Math.ceil((menuUntil - Date.now()) / 1000))}초 뒤 닫힘`, '메뉴')))) { menuOpen = false; await render(); return }
  if (menuTimer) clearTimeout(menuTimer)
  menuTimer = later(() => closeMenu('timeout'), 8000)
}
function closeMenu(why: string): void {
  if (menuTimer) { clearTimeout(menuTimer); menuTimer = null }
  if (!menuOpen) return
  menuOpen = false
  log('menu closed', why)
  void render()
}

async function replanHere(): Promise<void> {
  // 아직 안 탔다. 사용자는 이 구간의 출발역 승강장에 있다. 다가오는 열차의 위치는 사용자의 위치가 아니다.
  // 실제로 겪었다: 하계에서 기다리는데 공릉에서 오는 열차를 보고 '공릉에서 재탐색'을 해 상봉 환승 경로로 바꿨다.
  if (!fixes.length || !lastSeen) {
    stopPolling()
    origin = stops[0]
    return chooseRoute(trip!.to)
  }
  const d = deviation(leg(), lastSeen, prevSeen || null, atStatus, trip!.to)
  // 바꿀 것이 없어도 확인했다고 말한다. 화면이 그대로면 탭이 먹혔는지 모른다.
  if (d.kind === 'on') { flashNote('경로 그대로'); return render() }
  if (d.kind === 'unknown') { flashNote('판단 보류'); return render() }
  applyDeviation(d, lastSeen, Date.now())
  return render()
}

// 잠깐만 머리줄에 띄우는 말. 그새 다른 말로 바뀌었으면 건드리지 않는다.
function flashNote(text: string, ms = 6000): void {
  note = text
  later(() => { if (note === text) { note = ''; void render() } }, ms)
}
// 여정이 있는 텍스트 화면의 더블탭은 한 번 더 확인한다. 3초 안에 또 두 번 탭하면 처음으로(되돌리기는 5분).
// 확인 문구는 화면 맨 아래 조작 안내 줄에 뜬다(show가 바꿔 끼운다). 틱이 3초 뒤 지운다.
let confirmUntil = 0
const CONFIRM = '더블탭 한 번 더: 처음으로'
// 출발 직후 2분은 탭 한 번이 '다음 열차 고르기'다. 놓쳤을 때 메뉴를 거치지 않고 바로 복구한다(리뷰 1라운드).
const MISS_WINDOW_MS = 120_000
const inMissWindow = () => mode === 'riding' && departedAt > 0 && Date.now() - departedAt < MISS_WINDOW_MS
const hintNow = () => (inMissWindow() ? '탭: 못 탔으면 다음 열차' : '탭: 메뉴')

async function render(): Promise<void> {
  if (rendering || menuOpen) return
  rendering = true
  try { await renderNow() } finally { rendering = false }
}

async function renderNow(): Promise<void> {
  const now = Date.now()
  const guess = locate(stops, fixes, now)

  if (!guess) {
    // 아직 타지 않았다. 열차가 오는 중이거나, 열차를 못 찾았다.
    // 세 번 연속 못 찾기 전에는 오류로 단정하지 않는다. 한 번 놓친 것은 흔하다.
    if (approach || misses < 3) {
      // 열차가 어디 있는지 보이면 도착 예정을 그 위치로 다시 센다. 도착 정보(조회 시각 기준)는 금방 낡는다.
      // '1정거장 전'인데 '약 5분'이라고 했다(리뷰 2라운드). 한 정거장 약 110초, 역에 서 있으면 30초를 더한다.
      const n = !approach ? -1 : approachStatus === 3 && approach === stops[0] ? 1 : hops(leg().line, approach, stops[0])
      // 전역출발(3)은 앞 역을 막 떠난 것이다. 그 역까지 약 80초를 더한다(리뷰 3라운드).
      const extra = approachStatus === 0 || approachStatus === 1 ? 30_000 : approachStatus === 3 && approach !== stops[0] ? 80_000 : 0
      const observed = n >= 0 && approachAt ? approachAt + n * 110_000 + extra : 0
      return show(S.waiting({
        now, line: leg().line, toward: train!.dest || train!.toward,
        at: approach ? `${approach} ${S.statusWord(approachStatus)}`.trim() : '',
        away: n > 0 && approach !== stops[0] ? `${n}정거장 전` : undefined,
        from: stops[0], arriveAt: observed || boardedAt + train!.etaSec * 1000,
        refresh: refresh(), hint: hintNow(),
      }))
    }
    return show(S.loading(now, '열차를 찾는 중', `${train!.trainNo}번 위치가 아직 안 보입니다`, '탭: 메뉴\n더블탭: 처음으로', leg().line))
  }

  const left = stopsLeft(stops, stops[guess.index])
  if (left <= 0) return arrive()

  const pace = paceMs(stops, fixes)
  const lastFix = fixes[fixes.length - 1]
  const dest = stops[stops.length - 1]
  // 하차·환승역 도착 예정. 마지막 관측에 고정한다(현재시각으로 세면 톱니처럼 흔들렸다).
  const legAt = legEta(stops, fixes, now)

  // 두 정거장 안이면 신호가 끊겨도 하차 화면이 먼저다. 끊김 3분이 넘으면 '신호 끊김'이 '다음 역에서 내리세요'를
  // 가렸다(리뷰 3라운드). 추정이라고 적고 마지막 관측이 몇 분 전인지 붙인다.
  if (left <= 2) {
    return show(S.alight({
      now, stopsLeft: left, dest, next: stops[guess.index + 1], arriveAt: legAt,
      note: note || undefined, then: trip!.legs[legIndex + 1]?.line,
      estimated: guess.estimated > 0 || guess.stale, refresh: refresh(), hint: hintNow(),
      seenMin: guess.stale ? Math.max(1, Math.round((now - (lastFix.seen ?? lastFix.at)) / 60_000)) : undefined,
    }))
  }

  if (guess.stale) {
    return show(S.lost({
      now, last: lastFix.station,
      agoSec: Math.round((now - (lastFix.seen ?? lastFix.at)) / 1000),
      guess: stops[guess.index],
      dest, stopsLeft: left,
      bar: S.track(stops.length, guess.index, guess.estimated),
      refresh: refresh(), hint: hintNow(),
    }))
  }

  const nextLeg = trip!.legs[legIndex + 1]
  // 지금 어디인지. 관측이면 전광판과 같은 말(진입·도착·출발), 추정이면 추정이라고 말한다.
  // 도착한 채 1분 반 넘게 서 있으면 '정차 중'이다(지연). 앞으로 밀지 않는다.
  const dwelling = guess.estimated === 0 && lastFix.status === 1 && now - lastFix.at > 90_000
  const at = guess.estimated > 0
    ? { station: stops[guess.index], label: '부근 (추정)' }
    : { station: stops[guess.index], label: dwelling ? '정차 중' : S.statusWord(atStatus) || '통과' }
  await show(S.riding({
    now, line: leg().line, note: note || undefined,
    at, refresh: refresh(),
    next: stops[guess.index + 1],
    legDest: dest, stopsLeft: left, paceMs: pace, legAt,
    pathLen: stops.length, index: guess.index, estimated: guess.estimated, hint: hintNow(),
    transfer: nextLeg
      ? {
          line: nextLeg.line,
          finalDest: trip!.to,
          // 남은 시간은 이번 구간의 관측 속도로 센다. 지금 타고 있는 열차의 실제 속도다.
          finalAt: legAt + TRANSFER_MIN * 60_000 + restMinutes(legIndex + 1, pace) * 60_000,
        }
      : undefined,
  }))
}

async function arrive(): Promise<void> {
  stopPolling()
  rows = []
  if (stranded) {
    mode = 'arrived'
    return showLive(() => S.notice(Date.now(), `${stops[stops.length - 1]}에서 내리세요`, '여기서는 도착지까지 경로를 찾지 못했습니다', '탭: 처음으로\n더블탭: 종료'))
  }
  const nextLeg = trip!.legs[legIndex + 1]
  if (nextLeg) {
    mode = 'transfer'
    startTransferWatch()
    // 최종 도착 예정은 지금 한 번 정해 고정한다(현재시각으로 세면 매분 밀렸다). 걷기·기다림을 환승 1회 4분으로 친다.
    // restMinutes(legIndex + 1)는 그 뒤의 환승만 센다. 지금 하는 환승을 빼먹어 4분 이르게 말했다(리뷰 3라운드).
    const finalAt = Date.now() + (TRANSFER_MIN + restMinutes(legIndex + 1)) * 60_000
    return showLive(() => S.transfer({
      now: Date.now(), note: note || undefined,
      station: stops[stops.length - 1],
      from: leg().line, to: nextLeg.line,
      // 환승 뒤 첫 구간의 다음 역. 승강장 표지와 같은 기준이라 그 자리에서 확인된다.
      toward: nextLeg.stops[1] ?? nextLeg.stops[nextLeg.stops.length - 1],
      rest: trip!.legs.slice(legIndex + 1).reduce((n, l) => n + l.stops.length - 1, 0),
      finalAt,
      finalDest: trip!.to,
    }))
  }
  mode = 'arrived'
  resume = null
  void logBattery('arrived').then(rideSummary)
  lastArrived = stops[stops.length - 1]
  lastArrivedAt = Date.now()
  void bridge.setLocalStorage('lastArrived', `${lastArrived}\t${lastArrivedAt}`)
  await showLive(() => S.arrived(Date.now(), lastArrived))
}

// 환승 화면에서 타던 열차가 떠나면 다음 열차를 자동으로 찾는다. 탭은 "지금 바로"다.
// 안 내리고 계속 탄 경우는 잡지 못한다. 그때는 메뉴의 재탐색이 있다.
let transferPoll: ReturnType<typeof setInterval> | null = null
let transferTimer: ReturnType<typeof setTimeout> | null = null
function stopTransferWatch(): void {
  if (transferPoll) clearInterval(transferPoll)
  if (transferTimer) clearTimeout(transferTimer)
  transferPoll = transferTimer = null
}
function startTransferWatch(): void {
  stopTransferWatch()
  const at = stops[stops.length - 1]
  // 환승역 앞의 역들. 타던 열차가 아직 여기 있으면 환승역에 닿기 전이다.
  // 주행 화면은 속도 추정으로 열차보다 먼저 도착을 선언할 수 있다. 그때 앞 역의 열차를 '떠났다'로 읽으면
  // 사용자가 아직 타고 있는데 다음 열차를 고른다(2026-09-26 시뮬레이터에서 발견).
  const before = stops.slice(0, -1)
  const tn = train?.trainNo
  const ln = leg().line
  const idx = legIndex
  const limit = FAST_POLL ? 20_000 : 90_000
  let deadline = Date.now() + limit
  const advance = (why: string) => {
    stopTransferWatch()
    if (mode === 'transfer' && legIndex === idx && !busy) { log('transfer auto', why); void startLeg(idx + 1, false, FAST_POLL ? 0 : TRANSFER_WALK_SEC) }
  }
  if (!tn) { transferTimer = later(() => advance('timeout'), limit); return }
  transferPoll = every(() => {
    if (mode !== 'transfer') return stopTransferWatch()
    if (Date.now() > deadline) return advance('timeout')
    positions(ln, tn).then(list => {
      const me = list.find(t => t.trainNo === tn)
      if (!me) return
      if (before.includes(me.station)) { deadline = Date.now() + limit; log('transfer wait: train still at', me.station); return }
      if (me.station !== at || me.status === 2) advance(`old train ${me.station} ${S.statusWord(me.status)}`)
    }).catch(e => log('transfer watch failed', e))
  }, FAST_POLL ? 5_000 : 20_000)
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
    if (!pick) return showOrigin()   // 안내행이나 실패 화면은 rows가 비어 있다
    if (pick === '__resume' && resume) { const r = resume; resume = null; return resumeTrip(r) }
    // 되돌리기는 여기서 지우지 않는다. 새 열차를 탈 때(board) 지운다. 출발역을 잘못 눌러 뒤로 와도 남는다(리뷰 3라운드).
    stopOriginWatch()
    origin = pick
    return showDest()
  }
  if (mode === 'dest') {
    const pick = rows[index]
    if (!pick) return showOrigin()
    return chooseRoute(pick)
  }
  if (mode === 'line') {
    const p = options[Number(rows[index])]
    return p ? startTrip(p) : showDest()
  }
  if (mode === 'pick') {
    if (rows[index] === '__back') return backToRide('tap')
    const a = picks.find(p => p.trainNo === rows[index])
    return a ? board(a) : showPick()          // 실패 화면에서 탭하면 다시 확인
  }
  // 주행 중 탭은 메뉴다. 도착 조회 같은 비용 있는 동작은 메뉴에서 고른 뒤에만 일어난다.
  if (mode === 'riding') {
    if (menuOpen) {
      if (menuTimer) { clearTimeout(menuTimer); menuTimer = null }
      menuOpen = false
      const pick = rows[index]
      if (pick === '현위치에서 재탐색') return replanHere()
      if (pick === '열차 다시 고르기') return repick('menu')
      if (pick === '처음으로') return showOrigin(true)
      return render()   // 계속 보기 또는 알 수 없는 행
    }
    // 출발 직후라면 탭 한 번이 '다음 열차'다. 놓쳤을 때 메뉴를 거치지 않는다.
    if (inMissWindow()) return repick('missed train')
    return showMenu()
  }
  if (mode === 'transfer') return startLeg(legIndex + 1, false, FAST_POLL ? 0 : TRANSFER_TAP_WALK_SEC)
  return showOrigin()                                            // arrived
}

// 처리 중에 들어온 더블탭은 버리지 않는다. '처음으로'와 '종료'는 언제든 먹어야 한다.
// 실제로 겪었다: 경로 요약을 보여주는 1.5초와 도착 조회 동안 더블탭이 사라졌다.
// 탭은 버린다. 목록 번호가 바뀐 다음 화면에 떨어지면 엉뚱한 것을 고른다.
let queuedDouble = false

const tapState = (): DoubleTapState => ({
  mode, menuOpen, legIndex, boarded: !!train, hasTrip: !!trip, textPage: pageIsText,
  confirming: Date.now() < confirmUntil, repick: !!repickFrom && mode === 'pick',
})
// 열차 고르기 화면들의 더블탭 안내. 실제 동작과 같은 말을 쓴다.
const backHint = () => doubleTapHint({ ...tapState(), textPage: true })

let lastInputAt = Date.now()
async function handle(type: OsEventTypeList, index: number): Promise<void> {
  lastInputAt = Date.now()
  busy = true
  showFails = 0   // 사람이 만졌다. 화면 재구성을 다시 시도한다
  try {
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      // 루트 화면의 더블탭은 반드시 종료여야 한다 (Even Hub 요구사항)
      // 도착 화면도 '더블탭: 종료'라고 적혀 있다. 예전에는 처음으로 가서 문구와 달랐다.
      const action = doubleTapAction(tapState())
      log('double tap', mode, action)
      if (action === 'exit') {
        stopPolling(); stopOriginWatch(); stopTransferWatch()
        await bridge.shutDownPageContainer(1)
      } else if (action === 'closeMenu') closeMenu('double tap')
      // 목록에서는 한 단계 뒤로. 처음으로 튀지 않는다(리뷰 1라운드).
      else if (action === 'toOrigin') await showOrigin()
      else if (action === 'toDest') await showDest()
      else if (action === 'toRoute') await (options.length > 1 ? chooseRoute(trip!.to) : showDest())
      else if (action === 'backToRide') await backToRide('double tap')
      // 여정이 있는 텍스트 화면은 한 번 더 묻는다. 목록 화면은 확인 문구를 띄울 자리가 없어 되돌리기(5분)로 대신한다.
      else if (action === 'confirm') {
        confirmUntil = Date.now() + 3000
        if (mode === 'riding') await render()
        else if (current) await show(current())
      } else await showOrigin()
    } else if (type === OsEventTypeList.CLICK_EVENT) {
      await onTap(index)
    }
  } catch (e) {
    log('event failed', e)
    stopPolling()
    mode = 'origin'
    rows = []
    await showLive(() => S.notice(Date.now(), '오류', String(e).slice(0, 60), '탭: 처음으로\n더블탭: 종료'))
  } finally {
    busy = false
  }
  if (queuedDouble) {
    queuedDouble = false
    log('queued double tap')
    await handle(OsEventTypeList.DOUBLE_CLICK_EVENT, 0)
  }
}

const unsubscribe = bridge.onEvenHubEvent(async event => {
  const type = eventTypeOf(event.listEvent) ?? eventTypeOf(event.textEvent) ?? eventTypeOf(event.sysEvent)
  if (type === OsEventTypeList.SYSTEM_EXIT_EVENT || type === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    // 누가 앱을 끝냈는지 남긴다. 예전에는 기록이 없어 '안내가 꺼졌다'의 원인을 로그로 가를 수 없었다.
    log('exit', type === OsEventTypeList.SYSTEM_EXIT_EVENT ? 'system' : 'abnormal', 'mode', mode)
    void keepTrail()
    clearInterval(shadowLog)
    endLog()
    stopPolling()
    stopOriginWatch()
    stopTransferWatch()
    clearInterval(ticker)
    return unsubscribe()
  }
  if (type === null) return
  if (busy) {
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) queuedDouble = true
    return
  }
  // 하드웨어가 첫 항목의 currentSelectItemIndex를 생략한다
  await handle(type, event.listEvent?.currentSelectItemIndex ?? 0)
})

// 할 일 없는 화면을 10분 동안 아무도 안 만지면 앱을 끝낸다. 매초 시계를 쓰는 BLE와 배터리를 아낀다(리뷰 1라운드).
// 여정 중(주행·환승·열차 고르기)은 끝내지 않는다. 열차가 안 와서 재조회를 멈춘 화면은 한가한 화면이다.
// 기준은 마지막 입력과 화면(모드)이 바뀐 때 중 늦은 쪽이다. 마지막 입력만 보면 주행 내내 안경을 안 만진
// 사용자는 도착하자마자(16초 만에) 앱이 꺼졌다(장시간 시험에서 발견).
const IDLE_EXIT_MS = 10 * 60_000
let idleMode: Mode = mode
let idleSince = Date.now()
const idleTimer = every(() => {
  if (mode !== idleMode) { idleMode = mode; idleSince = Date.now() }
  // 주행·환승, 그리고 재조회나 목록 갱신이 도는 열차 고르기만 바쁘다. 나머지는 모두 한가한 화면이다
  // (새벽 안내, 한도 안내, 갱신을 멈춘 목록도 끝없이 쓰던 빈틈을 막는다, 리뷰 2라운드).
  const active = mode === 'riding' || mode === 'transfer' || (mode === 'pick' && (pickRetrying || pickRefreshing))
  const idle = !active
  if (!idle || busy || Date.now() - Math.max(lastInputAt, idleSince) < IDLE_EXIT_MS) return
  log('idle exit', mode)
  stopPolling(); stopOriginWatch(); stopTransferWatch()
  clearInterval(ticker); clearInterval(idleTimer)   // 종료를 한 번만 요청한다. 호스트가 안 닫아도 매분 되풀이하지 않는다
  void bridge.shutDownPageContainer(1)
}, 30_000)

// 안경 배터리를 주행 중 5분마다 남긴다. 한 시간 주행의 %/h를 실제 로그로 잰다(리뷰 1라운드: 수치가 없다).
async function logBattery(why: string): Promise<number | undefined> {
  try {
    const st = (await bridge.getDeviceInfo())?.status
    log('battery', why, 'glasses', st?.batteryLevel ?? '?', st?.isCharging ? 'charging' : '', 'wearing', st?.isWearing ?? '?')
    return st?.isCharging ? undefined : st?.batteryLevel
  } catch (e) {
    log('battery failed', e)
  }
}
// 주행 한 번의 요약을 도착 때 한 줄로 남긴다. 첫 실제 출근에서 안경 배터리 %/h·요청·쓰기 수치가 바로 나온다(리뷰 3라운드).
// ponytail: 첫 탑승부터 도착까지 하나로 센다. 여정을 버리고 새 여정을 타면 둘이 합쳐진다. 따로 셀 일이 생기면 startTrip에서 비운다.
let ride: { at: number, used: number, writes: number, bytes: number, battery?: number } | null = null
function rideSummary(end: number | undefined): void {
  const r = ride
  ride = null
  if (!r) return
  const min = (Date.now() - r.at) / 60_000
  const perHour = r.battery != null && end != null && min >= 10 ? ((r.battery - end) / min * 60).toFixed(1) : '?'
  log('ride summary', 'min', min.toFixed(1), 'req', used - r.used, 'writes', allWrites + writes - r.writes,
    'bytes', allBytes + writeBytes - r.bytes, 'battery', r.battery ?? '?', '->', end ?? '?', '%/h', perHour, 'sec', S.clock.seconds)
}
every(() => { if (mode === 'riding' || mode === 'transfer') void logBattery('ride') }, 5 * 60_000)

// Vite HMR은 모듈을 다시 실행한다. 정리하지 않으면 옛 타이머와 이벤트 핸들러가 살아남아
// 여러 루프가 같은 화면을 덮어쓴다. 개발 중에만 쌓이지만 디버깅을 통째로 망친다.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopPolling()
    clearInterval(ticker)
    unsubscribe()
  })
}

const APP = import.meta.env?.VITE_APP_NAME ?? 'G2P for Metro'
const booting = () => S.loading(Date.now(), APP, '출발역 찾는 중')
const started = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(full(booting())))
log('startup', started, location.href)
// 위치가 늦게 오면(실기기에서 최대 10초) 시작 화면이 오래 남는다. 그동안에도 스피너가 돈다.
pageIsText = started === 0
current = booting
await showOrigin()
