// G2 화면 문자열. 576x288, 4비트 녹색, 폰트 크기 고정.
// 크기로 위계를 만들 수 없으므로 여백과 자간으로 만든다.
// 한도는 모두 UTF-8 바이트다(tiro 실기기 실측). 한글 1자는 3바이트다.
export const PAGE_BYTES = 950
export const ITEM_BYTES = 62

const enc = new TextEncoder()
export const bytes = (s: string): number => enc.encode(s).length

// 한 줄에 들어가는 칸 수. 한글과 도형 문자는 2칸, 그 밖은 1칸으로 센다.
// 실기기에서 재지 않은 값이다. 넘치면 줄이 접혀 아래가 밀린다.
// 가로줄 34개(68칸)를 넣었다가 화면이 깨진 적이 있다. 보수적으로 잡는다.
export const MAX_COLS = 32
// 시뮬레이터 실측(2026-09-24): 11줄이면 마지막 줄이 반쯤 잘리고 스크롤바가 선다. 10줄까지 보인다.
export const MAX_LINES = 10
export const cols = (s: string): number =>
  Math.max(0, ...s.split('\n').map(l => [...l].reduce((n, c) => n + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)))

// 목록 페이지에는 머리줄(시계와 제목) 컨테이너가 함께 올라간다. 그 몫을 목록 예산에서 뺀다.
export const LIST_BYTES = PAGE_BYTES - 64

// 목록 항목은 62바이트, 페이지 전체는 950바이트를 넘으면 하드웨어가 거부한다.
export function fitItems(items: string[], budget = LIST_BYTES): string[] {
  for (let len = ITEM_BYTES; len > 1; len--) {
    const cut = items.map(i => i.slice(0, len))
    if (cut.every(i => bytes(i) <= ITEM_BYTES) && bytes(cut.join('')) <= budget) return cut
  }
  return items.map(i => i.slice(0, 1))
}

// 자르지 않고 한도 안에 드는지만 본다. 곁가지를 붙일지 말지 정할 때 쓴다.
export const fitsAll = (items: string[], budget = LIST_BYTES): boolean =>
  items.every(i => bytes(i) <= ITEM_BYTES) && bytes(items.join('')) <= budget

// 항목마다 따로 단계를 내린다. 긴 이름 하나 때문에 모든 행의 곁가지가 사라지면 안 된다.
// 실제로 겪었다: '동대문역사문화공원' 한 줄이 62바이트를 넘자 목적지 전체가 이름만 남았다.
// 글자를 중간에서 자르지 않는다. '온수행 급행'이 '온수행 급'이 되면 뜻이 바뀐다.
export function tiers(...levels: string[][]): string[] {
  const last = levels[levels.length - 1]
  const each = levels[0].map((_, i) => levels.find(l => l[i] !== undefined && bytes(l[i]) <= ITEM_BYTES)?.[i] ?? last[i] ?? levels[0][i])
  if (fitsAll(each)) return each
  for (const level of levels) if (fitsAll(level)) return level   // 페이지 전체가 넘치면 한꺼번에 내린다
  return fitItems(last)
}

// 이름에 곁가지를 붙인다. 곁가지는 자세한 것부터 주고, 넘치는 항목만 다음 단계로 내려간다.
export const rows = (names: string[], ...metas: ((n: string) => string)[]): string[] =>
  tiers(...metas.map(m => names.map(n => `${n}  ${m(n)}`)), names)

// 시각. 화면마다 보여주므로 순수 함수로 두고 테스트에서 고정값을 넣는다.
export const hhmm = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const hhmmss = (ms: number): string =>
  `${hhmm(ms)}:${String(new Date(ms).getSeconds()).padStart(2, '0')}`

// 다음 갱신까지 차오르는 막대. 다 차면 갱신된다.
// 글리프는 ━ ─ 만 쓴다. 실기기에서 보인 것이 확인된 글리프다.
// ◐◓◑◒ 같은 것은 폰트에 없으면 조용히 빠져서 스피너가 멈춘 것처럼 보인다.
// 초읽기는 두 자리로 고정한다. 자릿수가 바뀌면 줄이 흔들린다.
export type Refresh = { inSec: number; totalSec: number; failed: boolean }
// ━ ─ 는 전각이라 한 칸이 2칸을 먹는다. 7칸이면 가장 긴 문구(' 7초 뒤 재시도')까지 31칸이다.
const BAR_CELLS = 7
export function refreshLine(r: Refresh): string {
  const sec = Math.max(0, r.inSec)
  const total = Math.max(1, r.totalSec)
  const filled = Math.min(BAR_CELLS, Math.round(((total - sec) / total) * BAR_CELLS))
  const bar = '━'.repeat(filled) + '─'.repeat(BAR_CELLS - filled)
  const n = String(sec).padStart(2, ' ')
  if (r.failed) return `${bar} ${n}초 뒤 재시도`
  return sec === 0 ? `${bar} 갱신 중` : `${bar} ${n}초 뒤 갱신`
}

// 자간을 벌려 강조한다. 크기를 못 바꾸므로 이것이 유일한 강조 수단이다.
const wide = (s: string) => [...s].join(' ')

// 넘치면 자간을 포기한다. '동대문역사문화공원'처럼 긴 이름은 벌리면 줄이 접힌다.
// 강조는 가독성에 양보한다.
const hero = (s: string, used: number): string => {
  const w = wide(s)
  return cols(w) + used <= MAX_COLS ? w : s
}

const PAD = '  '
const IN = '      '

// 한 줄에 들어가면 한 줄로, 넘치면 두 줄로 쓴다.
// '동대문역사문화공원'만으로 20칸이라 뒤에 무엇이든 붙이면 넘친다.
const pair = (a: string, b: string, indent = PAD): string[] => {
  const one = `${indent}${a} ${b}`
  return cols(one) <= MAX_COLS ? [one] : [`${indent}${a}`, `${indent}${b}`]
}
// 조사 '으로/로'. 받침이 없거나 ㄹ 받침이면 '로'다. '공항철도으로'라고 쓰고 있었다.
export const ro = (w: string): string => {
  const c = w.charCodeAt(w.length - 1) - 0xac00
  return c >= 0 && c < 11172 && c % 28 !== 0 && c % 28 !== 8 ? `${w}으로` : `${w}로`
}
const mins = (ms: number, stops: number) => Math.max(1, Math.round((ms * stops) / 60_000))

// 진행 띠. ● 지나옴, ◌ 추정, ○ 남음, ◎ 하차역.
// 구분자를 넣지 않는다. '━'는 전각이라 12개를 이으면 46칸이 되어 줄이 접힌다.
export function track(len: number, index: number, estimated: number, cells = 10): string {
  const marks: string[] = []
  for (let i = 0; i < len; i++) {
    if (i === len - 1) marks.push('◎')
    else if (i > index) marks.push('○')
    else if (i > index - estimated) marks.push('◌')
    else marks.push('●')
  }
  // 하차역 쪽이 중요하다. 앞을 줄인다. ⋯는 안경 폰트에서 확인되지 않았다. 확인된 ─로 앞이 더 있다고 보인다.
  return marks.length <= cells ? marks.join('') : '─' + marks.slice(marks.length - (cells - 1)).join('')
}

// 한 줄이 넘치면 띄어쓰기에서 접는다. 기기가 제멋대로 접으면 들여쓰기가 깨지고 아래가 밀린다.
// 역 이름은 '동대문역사문화공원'처럼 20칸짜리가 있어 문구마다 따로 막을 수 없다. 여기서 한 번에 막는다.
const wrap = (line: string): string[] => {
  if (cols(line) <= MAX_COLS) return [line]
  const indent = /^ */.exec(line)![0]
  const out: string[] = []
  let rest = [...line]
  while (cols(rest.join('')) > MAX_COLS) {
    let width = 0, space = -1, hard = rest.length
    for (let i = 0; i < rest.length; i++) {
      width += rest[i].charCodeAt(0) > 0x2000 ? 2 : 1
      if (width > MAX_COLS) { hard = i; break }
      if (rest[i] === ' ' && i > indent.length) space = i
    }
    const at = space > 0 ? space : hard
    out.push(rest.slice(0, at).join('').trimEnd())
    rest = [...indent, ...rest.slice(at).join('').trimStart()]
  }
  return [...out, rest.join('')]
}

// 화면 하나를 통째로 쓴다. 빈 줄이 위계를 만든다.
// 가로줄은 쓰지 않는다. 글리프 폭을 실기기에서 재지 않았고, 넘치면 아래가 밀린다.
// 접어서 10줄을 넘으면 빈 줄부터 아래에서 위로 버린다. 여백이 내용보다 먼저 양보한다.
const screen = (...lines: (string | null)[]) => {
  const out = lines.filter(l => l !== null).flatMap(l => l.split('\n')).flatMap(wrap)
  for (let i = out.length - 1; out.length > MAX_LINES && i > 0; i--) if (out[i] === '') out.splice(i, 1)
  return out.join('\n')
}

// 모든 화면의 첫 줄. 화면에는 도착 예정 시각도 나오므로 현재 시각임을 '지금'으로 밝힌다.
// 오른쪽 정렬은 폭을 알아야 하므로 쓰지 않는다.
const head = (now: number, context = '') => `${PAD}현재시각 ${hhmmss(now)}${context ? `  ${context}` : ''}`
// 머리줄 문맥 후보 가운데 한 줄에 들어가는 첫 것을 쓴다. 하나도 안 들어가면 시계만 둔다.
const fitHead = (now: number, ...contexts: string[]) =>
  head(now, contexts.find(c => cols(head(now, c)) <= MAX_COLS) ?? '')
// 목록 화면의 머리줄. 목록 위에 따로 얹는 텍스트 컨테이너에 들어간다.
// 목록에도 현재시각이 있어야 한다(사용자 요구: 모든 화면에 현재시각). 제목이 이 목록이 무엇인지 말한다.
export const listHead = fitHead

// 기다리는 화면에는 반드시 스피너를 넣는다. "앱이 진짜 돌고 있나"를 보이는 것이 목적이다(사용자 원칙).
// 안경 폰트에 있는 글리프만 쓴다(2026-09-24 실기기 확인: ▁▂▃▄▅▆▇█ ●○◌◎ ◐◑ ━─ ←→↑↓ ▶▷ ★☆♥).
// 점자(⠋⠙…)·◓◒·░▒▓·✓✗⏳⌛⚠는 없다. 없는 글리프는 조용히 빠져 멈춘 것처럼 보인다.
// 파도가 왼쪽으로 흐른다. 틱이 1초라 한 칸씩 움직인다. 역 진행 띠(●○◌◎)와 모양이 겹치지 않는다.
const WAVE = ['▁', '▃', '▅', '▇', '▅', '▃']
export const spin = (now: number): string => {
  const t = Math.floor(now / 1000)
  return WAVE.map((_, j) => WAVE[(t + j) % WAVE.length]).slice(0, 4).join('')
}

// 무언가를 기다리는 화면. 머리줄 오른쪽에서 스피너가 돈다.
// 제목과 본문은 [앞, 뒤] 쌍으로 주면 넘칠 때 두 줄로 나뉜다. '공릉(서울산업대입구)에 오는 열차가…'는 한 줄에 안 들어간다.
type Text = string | [string, string]
const lines = (t: Text): string[] => typeof t === 'string' ? [`${PAD}${t}`] : pair(t[0], t[1])
export function loading(now: number, title: Text, body: Text, hint = ''): string {
  return screen(head(now, spin(now)), '', ...lines(title), '', ...(body ? lines(body) : []), '',
    ...hint.split('\n').filter(Boolean).map(h => `${PAD}${h}`))
}

// 머리줄이 넘치면 행선지를 버리고 노선만 남긴다.
// '동대문역사문화공원행'은 그것만으로 20칸이다.
const context = (now: number, line: string, toward: string): string => {
  const full = `${line} · ${toward}행`
  return cols(head(now, full)) <= MAX_COLS ? full : line
}
// 무슨 열차를 기다리는지 제목에서 말한다. 머리줄에서 행선지가 밀려나도 여기서는 보인다.
const comingTitle = (toward: string): string => {
  const full = `${toward}행 열차가 오는 중`
  return cols(PAD + full) <= MAX_COLS ? full : `${toward}행`
}

// 데이터가 얼마나 묵었는지. 폴링이 도는지 화면만 보고 알 수 있어야 한다.
export const ago = (sec: number): string =>
  sec < 0 ? '' : sec < 60 ? `${sec}초 전` : `${Math.floor(sec / 60)}분 전`

// 열차 상태. realtimePosition의 trainSttus다. 승강장 전광판과 같은 표현이다.
export const statusWord = (status: number): string =>
  status === 0 ? '진입' : status === 1 ? '도착' : status === 2 ? '출발' : ''

// 주행 중. 지금 어디인지와 다음 역이 함께 보여야 한다.
// 노선 방면은 머리줄로 물러선다. 이미 탄 뒤에는 어디쯤인지가 더 급하다.
export function riding(a: {
  now: number; line: string; note?: string
  at: { station: string; label: string }
  refresh: Refresh
  next: string; legDest: string; stopsLeft: number; paceMs: number
  pathLen: number; index: number; estimated: number
  transfer?: { line: string; finalDest: string; finalMinutes: number }
}): string {
  const left = mins(a.paceMs, a.stopsLeft)
  return screen(
    // 경로를 바꿨거나 내려야 하면 머리줄에 짧게 밝힌다. 줄을 더 쓰지 않는다(10줄 한도).
    a.note ? fitHead(a.now, `${a.line} · ${a.note}`, a.note) : head(a.now, a.line),
    '',
    `${PAD}${a.at.station} ${a.at.label}`,
    `${PAD}${refreshLine(a.refresh)}`,
    '',
    `${PAD}다음   ${hero(a.next, 9)}`,
    `${PAD}${track(a.pathLen, a.index, a.estimated)}`,
    ...(a.transfer
      ? [
          ...pair(a.legDest, `${hhmm(a.now + left * 60_000)} 환승`),
          `${PAD}${a.stopsLeft}정거장 · ${ro(a.transfer.line)}`,
          ...pair(a.transfer.finalDest, `${hhmm(a.now + a.transfer.finalMinutes * 60_000)} 도착`),
        ]
      : [
          ...pair(a.legDest, `${hhmm(a.now + left * 60_000)} 도착`),
          `${PAD}${a.stopsLeft}정거장 · 약 ${left}분`,
        ]),
  )
}

// 하차 임박. 화면 전체를 이 한 가지에 내준다.
// then: 여기서 갈아탈 노선. 환승역인데 최종 하차와 똑같이 보이면 어디로 갈아타는지 모른다.
export function alight(a: { now: number; stopsLeft: number; dest: string; next: string; minutes: number; note?: string; then?: string }): string {
  const title = a.stopsLeft <= 1 ? '다 음 역 에 서  내 립 니 다' : '두  정 거 장  뒤'
  const foot = a.stopsLeft <= 1 ? `${hhmm(a.now + a.minutes * 60_000)} 도착` : `${a.next} 다음 · 약 ${a.minutes}분`
  const indent = a.stopsLeft <= 1 ? PAD + PAD : IN
  return screen(head(a.now, a.note ?? (a.then ? '환승' : '')), '', `${indent}${title}`, '',
    `${IN}${PAD}${hero(a.dest, 8)}`, a.then ? `${IN}${PAD}${ro(a.then)} 환승` : null, '', `${indent}${foot}`)
}

export function arrived(now: number, dest: string): string {
  return screen(head(now), '', `${IN}${PAD}${hero(dest, 8)}`, '', `${IN}${wide('내리세요')}`, '',
    `${PAD}탭: 처음으로`, `${PAD}더블탭: 종료`)
}

export function transfer(a: { now: number; station: string; from: string; to: string; toward: string; rest: number; minutes: number; finalDest: string; note?: string }): string {
  return screen(
    head(a.now, a.note ?? '환승'), '', `${IN}${hero(a.station, 6)}`, '',
    // 같은 노선으로 되돌아가는 경우 '7호선 → 7호선'은 뜻이 없다. 반대 방향임을 말한다.
    a.from === a.to ? `${PAD}${a.from} 반대 방향 열차로` : `${PAD}${a.from} → ${a.to}`,
    `${PAD}${a.toward} 방면 승강장으로`,
    // 최종 목적지 이름이 있어야 이 환승이 어디로 가는 길인지 안다. '남은 17정거장 ·'만 있었다.
    ...pair(`${a.finalDest} ${hhmm(a.now + a.minutes * 60_000)} 도착`, `· ${a.rest}정거장`),
    // 사용자에게 시키지 않는다. 타던 열차가 떠나면 앱이 다음 열차를 찾는다. 탭은 지름길일 뿐이다.
    `${PAD}다음 열차를 찾는 중  ${spin(a.now)}`,
    `${PAD}탭: 지금 바로`,
  )
}

// 고른 열차가 아직 승강장에 오지 않았다. 기다리는 동안 실제 위치를 보여준다.
export function waiting(a: { now: number; line: string; toward: string; at: string; from: string; etaSec: number; refresh: Refresh }): string {
  const eta = a.etaSec > 0
    ? `${hhmm(a.now + a.etaSec * 1000)} 도착 · 약 ${Math.max(1, Math.round(a.etaSec / 60))}분`
    : `${a.from} 도착을 기다립니다`
  return screen(
    head(a.now, context(a.now, a.line, a.toward)), '',
    `${PAD}${comingTitle(a.toward)}`, '',
    // 아직 위치를 못 받았으면 '현재 확인 중'이 아니라 '위치 확인 중'이라고 쓴다.
    `${PAD}${a.at ? `현재 ${a.at}` : `위치 확인 중  ${spin(a.now)}`}`,
    `${PAD}${refreshLine(a.refresh)}`,
    `${PAD}${eta}`, '',
    `${PAD}탭: 메뉴`,
    `${PAD}더블탭: 처음으로`,
  )
}

// 관측이 끊겼다. 추정임을 화면이 스스로 말한다.
export function lost(a: { now: number; last: string; agoSec: number; guess: string; dest: string; stopsLeft: number; bar: string; refresh: Refresh }): string {
  return screen(
    head(a.now, '신호 끊김'),
    `${PAD}마지막 관측  ${a.last}  ${ago(a.agoSec)}`,
    `${PAD}${refreshLine(a.refresh)}`, '',
    `${PAD}추정   ${hero(a.guess, 14)} 부근`, '',
    `${PAD}${a.bar}`,
    ...pair(a.dest, `${a.stopsLeft}정거장 남음`), '',
    `${PAD}탭: 메뉴`,
  )
}

// 경로를 계산한 직후. 탭이 필요 없다. 곧 열차 목록으로 넘어간다.
export function route(a: {
  now: number; from: string; to: string
  legs: { line: string; stops: string[] }[]
  stops: number; minutes: number; quota?: string
}): string {
  const page = (body: string[]) => screen(
    head(a.now),
    ...pair(`${a.from} →`, a.to),
    `${PAD}${a.stops}정거장 · ${hhmm(a.now + a.minutes * 60_000)} 도착 예정`, '',
    ...body, '',
    `${PAD}열차를 확인하는 중  ${spin(a.now)}`,
    a.quota ? `${PAD}${a.quota}` : null,
  )
  // 구간마다 한 줄. '서울역 환승 · 공항철도 2정거장'은 33칸이라 접혔다. 조사로 줄인다.
  const full = page(a.legs.map((l, i) => i
    ? `${PAD}${l.stops[0]}에서 ${l.line} ${l.stops.length - 1}정거장`
    : `${PAD}${l.line} ${l.stops.length - 1}정거장`))
  if (full.split('\n').length <= MAX_LINES) return full
  // 환승이 많고 역 이름이 길면 넘친다. 노선 순서와 환승역만 남긴다.
  return page([
    `${PAD}${a.legs.map(l => l.line).join(' → ')}`,
    `${PAD}${a.legs.slice(1).map(l => l.stops[0]).join('·')} 환승`,
  ])
}

// 안내와 오류. 어떤 화면에서든 탭으로 빠져나갈 수 있어야 한다.
export function notice(now: number, title: string, body: string, hint: string): string {
  return screen(head(now), '', `${PAD}${title}`, '', body ? `${PAD}${body}` : null, '',
    ...hint.split('\n').map(h => `${PAD}${h}`))
}
