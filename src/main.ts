import {
  waitForEvenAppBridge,
  TextContainerProperty, ListContainerProperty, ListItemContainerProperty,
  CreateStartUpPageContainer, RebuildPageContainer, OsEventTypeList,
  AppLocationAccuracy,
} from '@evenrealities/even_hub_sdk'
import { COORDS } from './stations.ts'
import { plan, locate, paceMs, stopsLeft, type Plan, type Fix } from './route.ts'
import { nearest, MAX_ACCURACY_M, type Near } from './geo.ts'
import { arrivals, positions, type Arrival } from './api.ts'
import {
  fitItems, bytes, progressBar, ridingBoxes, alertScreen, transferScreen, lostScreen, planScreen,
  type Boxes,
} from './screen.ts'

const log = (...a: unknown[]) => {
  if (import.meta.env?.DEV) navigator.sendBeacon('/__log', a.map(String).join(' '))
}
window.addEventListener('error', e => log('error', e.message))
window.addEventListener('unhandledrejection', e => log('rejection', e.reason))

const bridge = await waitForEvenAppBridge()

// ---------- G2 화면 ----------

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

// ---------- 폰 설정 화면 ----------
// 자주 가는 도착지만 받는다. 키 입력란은 없다. 실시간 키는 워커가 들고 있다.

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

// ---------- 상태 ----------

type Mode = 'origin' | 'dest' | 'pick' | 'riding' | 'transfer' | 'arrived'
let mode: Mode = 'origin'
let rows: string[] = []      // 현재 목록의 각 행이 뜻하는 값
let origin = ''
let trip: Plan | null = null
let legIndex = 0
let stops: string[] = []
let trainNo = ''
let candidates: Arrival[] = []
let fixes: Fix[] = []
let busy = false
let pollTimer: ReturnType<typeof setTimeout> | null = null

const GPS_TIMEOUT_MS = 5000
const POLL_MS = 10_000
const leg = () => trip!.legs[legIndex]

function stopPolling(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

// ---------- ORIGIN: GPS로 출발역 ----------

async function nearbyStations(): Promise<Near[]> {
  try {
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
  stopPolling()
  await showFull('출발역을 찾는 중...')
  const near = await nearbyStations()
  const names = [...near.map(n => n.name), ...recents.filter(r => !near.some(n => n.name === r))]
  if (!names.length) {
    rows = []
    return showFull('출발역을 찾지 못했습니다.\n폰에서 도착지를 먼저 넣으세요.\n탭: 다시 시도 · 더블탭: 종료')
  }
  const label = new Map(near.map(n => [n.name, `${n.name}  ${n.meters}m`]))
  const items = names.map(n => label.get(n) ?? `${n}  (최근)`)
  rows = names
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

// ---------- DEST: 도착지 ----------

async function showDest(): Promise<void> {
  mode = 'dest'
  const list = dests.filter(d => d !== origin)
  if (!list.length) {
    rows = []
    return showFull('폰 화면에서 자주 가는 도착지를 넣으세요.\n탭: 출발역 다시 고르기 · 더블탭: 종료')
  }
  rows = list
  if (!(await showList(list.map(d => `${origin} → ${d}`)))) {
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
  log('plan', origin, dest, trip.legs.map(l => `${l.line}:${l.stops.length - 1}`).join(' '))
  await showFull(planScreen(trip))
  await startLeg(0)
}

// ---------- PICK: 탈 열차 ----------

async function startLeg(i: number): Promise<void> {
  legIndex = i
  stops = leg().stops
  trainNo = ''
  await showPick()
}

async function showPick(): Promise<void> {
  mode = 'pick'
  const from = stops[0]
  const all = await arrivals(from)
  const sameLine = all.filter(a => a.trainNo && a.line === leg().line)
  // 방향은 "…방면" 역이 다음 역과 같은지로 가른다.
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
    return showFull(`${from}\n${stops[stops.length - 1]} 방면 도착 정보가 없습니다.\n탭: 다시 확인 · 더블탭: 처음으로`)
  }
  if (candidates.length === 1) return board(candidates[0].trainNo)

  rows = candidates.map(a => a.trainNo)
  const items = candidates.map(a =>
    `${a.etaSec > 0 ? `${Math.max(1, Math.round(a.etaSec / 60))}분` : a.msg} ${a.express ? '급행 ' : ''}${a.toward}방면`)
  if (!(await showList(items))) {
    rows = []
    await showFull('열차 목록을 표시하지 못했습니다.\n탭: 다시 확인')
  }
}

async function board(no: string): Promise<void> {
  trainNo = no
  fixes = []
  mode = 'riding'
  log('boarded', no, leg().line)
  await showFull(`${no}번 열차\n추적을 시작합니다...`)
  stopPolling()
  await poll()
}

// ---------- RIDING: 추적 ----------

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

// ---------- 이벤트 ----------

// CLICK_EVENT는 0이고 protobuf가 0을 생략한다. eventType이 없으면 클릭이다.
function eventTypeOf(e?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!e) return null
  return e.eventType ?? OsEventTypeList.CLICK_EVENT
}

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
    return pick ? board(pick) : showPick()      // 실패 화면에서 탭하면 다시 확인
  }
  if (mode === 'riding') { stopPolling(); return showPick() }   // 엉뚱한 열차를 잡았을 때
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
    await showFull(`오류\n${e}\n탭: 처음으로 · 더블탭: 종료`)
  } finally {
    busy = false
  }
})

const started = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer(fullPage('출발역을 찾는 중...')))
log('startup', started, location.href)
await showOrigin()
