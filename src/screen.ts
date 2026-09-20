// G2 화면 문자열. 576x288, 4비트 녹색, 폰트 크기 고정.
// 크기로 위계를 만들 수 없으므로 여백, 자간, 가로줄 하나로 만든다.
// 한도는 모두 UTF-8 바이트다(tiro 실기기 실측). 한글 1자는 3바이트다.
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

// 자르지 않고 한도 안에 드는지만 본다. 곁가지를 붙일지 말지 정할 때 쓴다.
export const fitsAll = (items: string[]): boolean =>
  items.every(i => bytes(i) <= ITEM_BYTES) && bytes(items.join('')) <= PAGE_BYTES

// 이름에 곁가지를 붙이되, 한도를 넘으면 곁가지를 통째로 버린다.
// 글자를 중간에서 자르면 "환승 2"가 "환"이 되어 읽을 수 없다.
export function rows(names: string[], meta: (n: string) => string): string[] {
  const rich = names.map(n => `${n}  ${meta(n)}`)
  return fitsAll(rich) ? rich : fitItems(names)
}

// 자간을 벌려 강조한다. 크기를 못 바꾸므로 이것이 유일한 강조 수단이다.
const wide = (s: string) => [...s].join(' ')
const RULE = '─'.repeat(34)
const PAD = '   '
const mins = (ms: number, stops: number) => Math.max(1, Math.round((ms * stops) / 60_000))

// 노선도를 본뜬 진행 띠. ● 지나옴, ◌ 추정, ○ 남음, ◎ 하차역.
export function track(len: number, index: number, estimated: number, cells = 12): string {
  const marks: string[] = []
  for (let i = 0; i < len; i++) {
    if (i === len - 1) marks.push('◎')
    else if (i > index) marks.push('○')
    else if (i > index - estimated) marks.push('◌')
    else marks.push('●')
  }
  // 하차역 쪽이 중요하다. 앞을 줄인다.
  return marks.length <= cells ? marks.join('━') : '⋯' + marks.slice(marks.length - (cells - 1)).join('━')
}

// 모든 화면은 컨테이너 하나를 꽉 채운다. 빈 줄이 위계를 만든다.
const screen = (...lines: (string | null)[]) => lines.filter(l => l !== null).join('\n')

// 주행 중. 다음 역이 주인공이고, 나머지는 물러선다.
export function riding(a: {
  line: string; toward: string; next: string; dest: string
  stopsLeft: number; paceMs: number
  pathLen: number; index: number; estimated: number
  transfer?: { station: string; line: string }
}): string {
  return screen(
    `${PAD}${a.line} · ${a.toward}행`,
    '',
    `${PAD}다음  ${wide(a.next)}`,
    '',
    `${PAD}${RULE}`,
    `${PAD}${track(a.pathLen, a.index, a.estimated)}  ${a.dest}`,
    `${PAD}${a.stopsLeft}정거장 · 약 ${mins(a.paceMs, a.stopsLeft)}분`,
    a.transfer ? '' : null,
    a.transfer ? `${PAD}▸ ${a.transfer.station}에서 ${a.transfer.line}` : null,
  )
}

// 하차 임박. 화면 전체를 이 한 가지에 내준다.
export function alight(a: { stopsLeft: number; dest: string; next: string; minutes: number }): string {
  const head = a.stopsLeft <= 1 ? '다 음 역 에 서  내 립 니 다' : '두  정 거 장  뒤'
  const foot = a.stopsLeft <= 1 ? `약 ${a.minutes}분 뒤 도착` : `${a.next} 다음 · 약 ${a.minutes}분`
  return screen('', `${PAD}${head}`, '', `${PAD}${PAD}${wide(a.dest)}`, '', `${PAD}${RULE}`, `${PAD}${foot}`)
}

export function arrived(dest: string): string {
  return screen('', `${PAD}${PAD}${wide(dest)}`, '', `${PAD}${PAD}내 리 세 요`, '', `${PAD}${RULE}`, `${PAD}탭: 처음으로 · 더블탭: 종료`)
}

export function transfer(a: { station: string; from: string; to: string; toward: string }): string {
  return screen(
    '', `${PAD}환승`, `${PAD}${PAD}${wide(a.station)}`, '',
    `${PAD}${a.from} → ${a.to} · ${a.toward} 방면`, '',
    `${PAD}${RULE}`, `${PAD}탭하면 열차를 고릅니다`,
  )
}

// 고른 열차가 아직 승강장에 오지 않았다. 기다리는 동안 실제 위치를 보여준다.
export function waiting(a: { line: string; toward: string; trainNo: string; at: string; from: string; etaSec: number }): string {
  const eta = a.etaSec > 0 ? `약 ${Math.max(1, Math.round(a.etaSec / 60))}분 뒤 ${a.from} 도착` : `${a.from} 도착을 기다립니다`
  return screen(
    `${PAD}${a.line} · ${a.toward}행`, '',
    `${PAD}열차가 오는 중`, '',
    `${PAD}현재  ${wide(a.at)}`,
    `${PAD}${eta}`, '',
    `${PAD}${RULE}`, `${PAD}탭: 열차 다시 고르기`,
  )
}

// 관측이 끊겼다. 추정임을 화면이 스스로 말한다.
export function lost(a: { last: string; agoSec: number; guess: string; dest: string; stopsLeft: number; bar: string }): string {
  return screen(
    `${PAD}신호 끊김 · ${a.last} 이후 ${a.agoSec}초`, '',
    `${PAD}추정  ${wide(a.guess)} 부근`, '',
    `${PAD}${RULE}`,
    `${PAD}${a.bar}  ${a.dest}`,
    `${PAD}${a.stopsLeft}정거장`, '',
    `${PAD}탭: 열차 다시 고르기`,
  )
}

// 경로를 계산한 직후. 탭이 필요 없다. 곧 열차 목록으로 넘어간다.
export function route(a: { from: string; to: string; legs: { line: string; stops: string[] }[] }): string {
  const body = a.legs.map((l, i) =>
    (i ? `${PAD}${PAD}▸ ${l.stops[0]} 환승\n` : '') + `${PAD}${l.line}  ${l.stops.length - 1}정거장`,
  )
  return screen(
    `${PAD}${a.from} ${wide('→')} ${a.to}`, '',
    ...body, '',
    `${PAD}${RULE}`, `${PAD}열차를 확인하는 중`,
  )
}

// 안내와 오류. 어떤 화면에서든 탭으로 빠져나갈 수 있어야 한다.
export function notice(head: string, body: string, hint: string): string {
  return screen('', `${PAD}${head}`, '', `${PAD}${body}`, '', `${PAD}${RULE}`, `${PAD}${hint}`)
}
