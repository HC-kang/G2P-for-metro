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
  // 분 단위 시계(절전)에서는 움직이는 막대도 뺀다. 막대가 2초마다 차올라 주행 중 쓰기가 분당 34회였다.
  // 고정 문구면 쓰기는 조회로 내용이 바뀔 때와 매 분의 시계뿐이다.
  if (!clock.seconds) return r.failed ? '갱신 실패 · 곧 다시 시도' : `${total}초마다 갱신`
  if (r.failed) return `${bar} ${n}초 뒤 재시도`
  return sec === 0 ? `${bar} 갱신 중` : `${bar} ${n}초 뒤 갱신`
}

// 자간을 벌려 강조한다. 크기를 못 바꾸므로 이것이 유일한 강조 수단이다.
const wide = (s: string) => [...s].join(' ')

// 넘치면 자간을 포기한다. '동대문역사문화공원'처럼 긴 이름은 벌리면 줄이 접힌다.
// 강조는 가독성에 양보한다.
// 한글만으로 된 이름만 벌린다. '4·19민주묘지'를 벌리면 '4 · 1 9'처럼 숫자와 기호가 흩어졌다.
const hero = (s: string, used: number): string => {
  if (!/^[가-힣]+$/.test(s)) return s
  const w = wide(s)
  return cols(w) + used <= MAX_COLS ? w : s
}

const PAD = '  '
// 'HH:MM 도착 · 약 N분'의 N은 보이는 두 시각(도착 HH:MM, 현재 HH:MM)의 차다. 초로 반올림하면 도착 시각은 그대로인데
// 분이 1→2로 거꾸로 가는 일이 있었다(리뷰 3라운드).
const minsTo = (at: number, now: number): number => Math.max(1, Math.floor(at / 60_000) - Math.floor(now / 60_000))
const IN = '      '

// 한 줄에 들어가면 한 줄로, 넘치면 두 줄로 쓴다.
// '동대문역사문화공원'만으로 20칸이라 뒤에 무엇이든 붙이면 넘친다.
const pair = (a: string, b: string, indent = PAD): string[] => {
  const one = `${indent}${a} ${b}`
  return cols(one) <= MAX_COLS ? [one] : [`${indent}${a}`, `${indent}${b}`]
}
// 한 줄에 들어가면 ' · '로 잇고, 넘치면 구분점 없이 두 줄로 나눈다. 줄 머리·끝에 '·'가 남지 않는다(리뷰 2라운드).
const joinOrSplit = (a: string, b: string, indent = PAD): string[] => {
  const one = `${indent}${a} · ${b}`
  return cols(one) <= MAX_COLS ? [one] : [`${indent}${a}`, `${indent}${b}`]
}
// 조사 '으로/로'. 받침이 없거나 ㄹ 받침이면 '로'다. '공항철도으로'라고 쓰고 있었다.
export const ro = (w: string): string => {
  const c = w.charCodeAt(w.length - 1) - 0xac00
  return c >= 0 && c < 11172 && c % 28 !== 0 && c % 28 !== 8 ? `${w}으로` : `${w}로`
}

// 진행 띠. ● 지나옴, ▶ 지금(관측), ▷ 지금(추정), ◌ 추정으로 지나옴, ○ 남음, ◎ 하차역.
// 지금 위치에 다른 글리프를 쓴다. 전부 ●이면 '●●'에서 어디가 지금인지 가를 수 없었다(리뷰 1라운드).
// 구분자를 넣지 않는다. 모두 확인된 전각 글리프라 한 칸이 2칸이다.
export function track(len: number, index: number, estimated: number, cells = 10): string {
  const marks: string[] = []
  for (let i = 0; i < len; i++) {
    if (i === len - 1) marks.push('◎')
    else if (i === index) marks.push(estimated > 0 ? '▷' : '▶')
    else if (i > index) marks.push('○')
    else if (i > index - estimated) marks.push('◌')
    else marks.push('●')
  }
  if (marks.length <= cells) return marks.join('')
  // 길면 줄이되 지금 위치와 하차역은 반드시 남긴다. 줄인 자리는 '··'(2칸)로 보인다.
  // ─는 갱신 막대와 같은 글리프라 뜻이 겹쳤다(리뷰 1라운드). ⋯는 안경 폰트에서 확인되지 않았다.
  const GAP = '··'
  const from = Math.max(0, index - 1)
  if (from + cells >= marks.length) return GAP + marks.slice(marks.length - (cells - 1)).join('')
  const head = from > 0 ? GAP : ''
  return head + marks.slice(from, from + cells - 2 - (from > 0 ? 1 : 0)).join('') + GAP + '◎'
}

// 한 줄이 넘치면 띄어쓰기에서 접는다. 기기가 제멋대로 접으면 들여쓰기가 깨지고 아래가 밀린다.
// 역 이름은 '동대문역사문화공원'처럼 20칸짜리가 있어 문구마다 따로 막을 수 없다. 여기서 한 번에 막는다.
// 줄바꿈이 만든, 옮길 수 없는 한 어절 줄의 수. 전수 시험이 본다(리뷰 3라운드: 기계가 조판을 정했다).
export const layStats = { widows: 0 }
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
  // 마지막 줄에 한 어절만 남으면('…아직 / 없습니다') 윗줄의 마지막 어절을 함께 내린다(리뷰 3라운드).
  const last = rest.join('')
  const prev = out[out.length - 1]
  if (prev && !last.trim().includes(' ')) {
    const cut = prev.lastIndexOf(' ')
    const moved = `${indent}${prev.slice(cut + 1)} ${last.trimStart()}`
    if (cut > indent.length && cols(moved) <= MAX_COLS) return [...out.slice(0, -1), prev.slice(0, cut), moved]
    // 옮길 수 없는 한 어절 줄이다. 시험이 이 수를 보고 문구를 고치게 한다.
    if (/[가-힣]/.test(last)) layStats.widows += 1
  }
  return [...out, last]
}

// 화면 하나를 통째로 쓴다. 빈 줄이 위계를 만든다.
// 가로줄은 쓰지 않는다. 글리프 폭을 실기기에서 재지 않았고, 넘치면 아래가 밀린다.
// 접어서 10줄을 넘으면 빈 줄부터 아래에서 위로 버린다. 여백이 내용보다 먼저 양보한다.
const lay = (lines: (string | null)[]) => lines.filter(l => l !== null).flatMap(l => l.split('\n')).flatMap(wrap)
const screen = (...lines: (string | null)[]) => {
  const out = lay(lines)
  for (let i = out.length - 1; out.length > MAX_LINES && i > 0; i--) if (out[i] === '') out.splice(i, 1)
  return out.join('\n')
}
// 꼬리(갱신 막대·조작 안내)를 늘 9·10줄에 둔다. 이어지는 화면에서 아래 두 줄이 위아래로 뛰었다(리뷰 2라운드).
// 본문이 넘치면 본문의 빈 줄부터 버리고, 모자라면 빈 줄로 채운다.
const page = (body: (string | null)[], tail: (string | null)[]) => {
  const t = lay(tail)
  const b = lay(body)
  const room = MAX_LINES - t.length
  for (let i = b.length - 1; b.length > room && i > 0; i--) if (b[i] === '') b.splice(i, 1)
  while (b.length < room) b.push('')
  return [...b, ...t].join('\n')
}

// 모든 화면의 첫 줄. 화면에는 도착 예정 시각도 나오므로 현재 시각임을 '지금'으로 밝힌다.
// 오른쪽 정렬은 폭을 알아야 하므로 쓰지 않는다.
// 초 단위 시계를 끄면(폰 설정) 분 단위다. 안경 화면을 덜 자주 써서 배터리를 아낀다.
export const clock = { seconds: true }
const head = (now: number, context = '') => `${PAD}현재시각 ${clock.seconds ? hhmmss(now) : hhmm(now)}${context ? `  ${context}` : ''}`
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
// ▁▃▅▇ 파도는 신호 세기 아이콘처럼 읽혔다(리뷰 2라운드). 솟은 막대 하나가 옆으로 흐르게 한다.
const SPIN = ['▇▁▁▁', '▁▇▁▁', '▁▁▇▁', '▁▁▁▇']
export const spin = (now: number): string => SPIN[Math.floor(now / 1000) % SPIN.length]

// 무언가를 기다리는 화면. 스피너는 '하는 일' 문구(제목) 끝에 붙는다. 모든 대기 화면이 같은 자리다(리뷰 1라운드).
// 제목과 본문은 [앞, 뒤] 쌍으로 주면 넘칠 때 두 줄로 나뉜다.
// ctx는 머리줄 문맥이다(예: '하계 7호선'). 역 이름을 제목에서 빼 한 단어짜리 줄이 생기지 않게 한다.
type Text = string | [string, string]
const lines = (t: Text): string[] => typeof t === 'string' ? [`${PAD}${t}`] : pair(t[0], t[1])
const hints = (hint: string) => hint.split('\n').map(h => h.trim()).filter(Boolean).map(h => `${PAD}${h}`)
export function loading(now: number, title: Text, body: Text, hint = '', ctx = ''): string {
  const t = lines(title)
  const b = body ? lines(body) : []
  // 스피너는 '하는 일' 문구 끝에 붙인다. 본문 끝에 들어가면 거기, 아니면 제목 끝, 둘 다 넘치면 제 줄에.
  // 스피너가 혼자 한 줄로 떨어지던 것(리뷰 2라운드)을 줄인다.
  const s = `  ${spin(now)}`
  const fit = (l: string) => cols(l + s) <= MAX_COLS
  if (b.length && fit(b[b.length - 1])) b[b.length - 1] += s
  else if (fit(t[t.length - 1])) t[t.length - 1] += s
  else (b.length ? b : t).push(`${PAD}${spin(now)}`)
  return page([fitHead(now, ctx), '', ...t, '', ...b], hints(hint))
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
// 3은 '전역출발'이다. 앞 역을 떠나 이 역으로 오는 중이다(5·6호선이 많이 쓴다, 09-29 실측).
export const statusWord = (status: number): string =>
  status === 0 ? '진입' : status === 1 ? '도착' : status === 2 ? '출발' : status === 3 ? '접근' : ''

// 주행 중. 지금 어디인지와 다음 역이 함께 보여야 한다.
// 노선 방면은 머리줄로 물러선다. 이미 탄 뒤에는 어디쯤인지가 더 급하다.
export function riding(a: {
  now: number; line: string; note?: string
  at: { station: string; label: string }
  refresh: Refresh
  next: string; legDest: string; stopsLeft: number; paceMs: number
  pathLen: number; index: number; estimated: number
  transfer?: { line: string; finalDest: string; finalAt: number }
  legAt: number          // 이번 구간 끝(하차·환승) 예정 시각. 마지막 관측에 고정한다(현재시각으로 세면 톱니처럼 흔들렸다)
  hint?: string          // 맨 아래 조작 안내. 기본 '탭: 메뉴'
}): string {
  const left = minsTo(a.legAt, a.now)
  return page([
    // 경로를 바꿨거나 내려야 하면 머리줄에 짧게 밝힌다.
    a.note ? fitHead(a.now, `${a.line} · ${a.note}`, a.note) : head(a.now, a.line),
    '',
    `${PAD}${a.at.station} ${a.at.label}`,
    '',
    `${PAD}다음   ${hero(a.next, 9)}`,
    `${PAD}${track(a.pathLen, a.index, a.estimated)}`,
    // 환승이 있으면 두 줄. 환승까지 남은 시간과 역 수(사용자 요구)는 첫 줄, 갈아탈 노선과 최종 도착은 둘째 줄.
    ...(a.transfer
      ? [
          ...joinOrSplit(`${a.legDest} 환승 ${when(a.now, a.legAt)}`, `${a.stopsLeft}정거장`),
          ...joinOrSplit(`→ ${a.transfer.line}`, finalLine(a.transfer.finalDest, a.transfer.finalAt)),
        ]
      : [
          ...pair(a.legDest, `${when(a.now, a.legAt)} 도착`),
          `${PAD}${a.stopsLeft}정거장 · 약 ${left}분`,
        ]),
  ], [`${PAD}${refreshLine(a.refresh)}`, `${PAD}${a.hint ?? '탭: 메뉴'}`])
}

// 최종 도착. 환승이 섞여 추정이라 '약'. 긴 역 이름(동대문역사문화공원)이면 '도착'을 뺀다(한 줄 32칸).
const finalLine = (dest: string, at: number): string =>
  [`${dest} 약 ${hhmm(at)} 도착`, `${dest} 약 ${hhmm(at)}`].find(t => cols(`${PAD}${t}`) <= MAX_COLS) ?? `${dest} 약 ${hhmm(at)}`

// 예정 시각. 이미 지났으면 지난 시각 대신 '곧'이라고 한다. 지난 시각을 보이면 앱이 멈춘 것처럼 읽힌다.
const when = (now: number, at: number) => (at - now < 30_000 ? '곧' : hhmm(at))

// 하차 임박. 화면 전체를 이 한 가지에 내준다.
// 조판 규칙(강조 화면 공통): 제목과 설명은 PAD, 강조 역 이름은 IN. 이어지는 화면에서 왼쪽 끝이 흔들리지 않는다.
// 자간은 역 이름에만 벌린다. 문장을 벌리면 음절 나열로 읽혔다(리뷰 1라운드).
// then: 여기서 갈아탈 노선. 환승역인데 최종 하차와 똑같이 보이면 어디로 갈아타는지 모른다.
// arriveAt: 하차역 도착 예정. 이미 지났으면 '곧 도착'. 이때가 내릴 준비를 할 때다(도착 관측은 피드 지연으로 늦다).
export function alight(a: {
  now: number; stopsLeft: number; dest: string; next: string; arriveAt: number
  note?: string; then?: string; estimated?: boolean; refresh: Refresh; hint?: string
  seenMin?: number   // 신호가 끊겼다. 마지막 관측이 몇 분 전인지
}): string {
  const verb = a.then ? '갈아타세요' : '내리세요'
  const title = a.stopsLeft <= 1 ? `다음 역에서 ${verb}` : `두 정거장 뒤 ${verb}`
  const soon = a.arriveAt - a.now < 30_000
  const est = a.estimated ? ' (추정)' : ''
  // 도착 시각은 바로 위 큰 역 이름(하차역)의 시각이다. '다음 자양 · 약 3분'은 3분이 자양까지로 읽혔다(리뷰 3라운드).
  // 그래서 시각을 앞에 두고 다음 역을 뒤에 둔다. 넘치면 구분점 없이 두 줄.
  // 신호가 끊겼으면 '(추정)'과 끊김을 한 줄로 합친다. 두 줄이면 역 이름 묶음 아래 빈 줄이 사라졌다(리뷰 3라운드).
  const detail = soon && a.stopsLeft <= 1 ? [`${PAD}곧 도착 · 문 쪽으로 이동하세요`]
    : a.seenMin ? [`${PAD}${when(a.now, a.arriveAt)} 도착 · 신호 끊김 ${a.seenMin}분`]
    : a.stopsLeft <= 1 ? [`${PAD}${hhmm(a.arriveAt)} 도착 예정${est}`]
    : joinOrSplit(`${when(a.now, a.arriveAt)} 도착`, `다음 ${a.next}${est}`)
  // 강조 블록: 역 이름과 그에 붙는 한 줄은 IN. 나머지 설명은 PAD. 하차·환승·도착 화면 공통.
  return page([head(a.now, a.note ?? (a.then ? '환승' : '하차')), '', `${PAD}${title}`, '',
    `${IN}${hero(a.dest, 6)}`, a.then ? `${IN}${ro(a.then)} 환승` : null, '', ...detail],
  [`${PAD}${refreshLine(a.refresh)}`, `${PAD}${a.hint ?? '탭: 메뉴'}`])
}

// 도착은 관측이 피드 지연만큼 늦게 뜬다(30~55초). 이미 내린 뒤일 수 있으니 명령이 아니라 확인이다.
export function arrived(now: number, dest: string): string {
  return page([head(now, '도착'), '', `${PAD}도착했습니다`, '', `${IN}${hero(dest, 6)}`],
    [`${PAD}탭: 처음으로`, `${PAD}더블탭: 종료`])
}

// finalAt: 최종 도착 예정. 환승역에 닿은 때 한 번 정해 고정한다(현재시각으로 세면 매분 밀렸다). 탈 열차가 정해지기 전이라 '약'.
export function transfer(a: { now: number; station: string; from: string; to: string; toward: string; rest: number; finalAt: number; finalDest: string; note?: string }): string {
  // 같은 노선으로 되돌아가는 경우 '7호선 → 7호선'은 뜻이 없다. 반대 방향임을 말한다.
  // 승강장 표지와 같은 말. '승강장으로'까지 붙이면 6칸 들여쓰기에서 넘쳐 접혔다.
  const go = a.from === a.to ? joinOrSplit(`${a.to} 반대 방향`, `${a.toward} 방면`, IN) : [`${IN}${a.to} ${a.toward} 방면`]
  return page([
    head(a.now, a.note ?? '환승'), '', `${PAD}여기서 갈아타세요`, '', `${IN}${hero(a.station, 6)}`, ...go, '',
    // 최종 목적지 이름이 있어야 이 환승이 어디로 가는 길인지 안다.
    ...joinOrSplit(`${a.finalDest} 약 ${hhmm(a.finalAt)} 도착`, `${a.rest}정거장`),
  ], [
    // 사용자에게 시키지 않는다. 타던 열차가 떠나면 앱이 다음 열차를 찾는다. 탭은 지름길일 뿐이다.
    `${PAD}다음 열차를 찾는 중  ${spin(a.now)}`,
    `${PAD}탭: 지금 찾기`,
  ])
}

// 고른 열차가 아직 승강장에 오지 않았다. 기다리는 동안 실제 위치를 보여준다.
// arriveAt: 조회 시각 기준 도착 예정(탭한 시각 기준이면 목록을 오래 볼수록 늦게 나왔다).
// at: 열차가 지금 있는 곳('중계 출발 · 1정거장 전'). 주행 화면과 같은 표기다('현재'를 붙이지 않는다).
export function waiting(a: { now: number; line: string; toward: string; at: string; away?: string; from: string; arriveAt: number; refresh: Refresh; hint?: string }): string {
  const eta = a.arriveAt - a.now >= 30_000
    ? `${hhmm(a.arriveAt)} 도착 · 약 ${minsTo(a.arriveAt, a.now)}분`
    : `곧 도착`
  return page([
    head(a.now, context(a.now, a.line, a.toward)), '',
    `${PAD}${comingTitle(a.toward)}`, '',
    // 아직 위치를 못 받았으면 '위치 확인 중'이라고 쓰고 스피너를 붙인다.
    ...(a.at ? (a.away ? joinOrSplit(a.at, a.away) : [`${PAD}${a.at}`]) : [`${PAD}위치 확인 중  ${spin(a.now)}`]),
    `${PAD}${eta}`,
  ], [`${PAD}${refreshLine(a.refresh)}`, `${PAD}${a.hint ?? '탭: 메뉴'}`])
}

// 관측이 끊겼다. 추정임을 화면이 스스로 말한다.
// '신호 끊김'은 조회가 실제로 실패하고 있을 때만 쓴다. 조회는 되는데 열차가 서 있으면 주행 화면의 '정차 중'이다.
export function lost(a: { now: number; last: string; agoSec: number; guess: string; dest: string; stopsLeft: number; bar: string; refresh: Refresh; hint?: string }): string {
  return page([
    head(a.now, '신호 끊김'), '',
    `${PAD}${a.guess} 부근 (추정)`,
    ...joinOrSplit(`마지막 관측 ${a.last}`, ago(a.agoSec)), '',
    `${PAD}${a.bar}`,
    ...pair(a.dest, `${a.stopsLeft}정거장 남음`),
  ], [`${PAD}${refreshLine(a.refresh)}`, `${PAD}${a.hint ?? '탭: 메뉴'}`])
}

// 경로를 계산한 직후. 탭이 필요 없다. 곧 열차 목록으로 넘어간다.
export function route(a: {
  now: number; from: string; to: string
  legs: { line: string; stops: string[] }[]
  stops: number; minutes: number; quota?: string
}): string {
  const page = (body: string[]) => screen(
    head(a.now),
    '',
    ...pair(`${a.from} →`, a.to),
    `${PAD}${a.stops}정거장 · ${hhmm(a.now + a.minutes * 60_000)} 도착 예정`,
    body.length ? '' : null,
    ...body, '',
    `${PAD}열차를 확인하는 중  ${spin(a.now)}`,
    a.quota ? `${PAD}${a.quota}` : null,
  )
  // 구간마다 한 줄. 직통이면 구간 줄을 뺀다('14정거장'이 두 번 나왔다).
  const widows = layStats.widows   // 넘쳐서 버리는 첫 시도의 줄바꿈은 세지 않는다
  const full = page(a.legs.length < 2 ? [`${PAD}${a.legs[0].line} 직통`] : a.legs.map((l, i) => i
    ? `${PAD}${l.stops[0]}에서 ${l.line} ${l.stops.length - 1}정거장`
    : `${PAD}${l.line} ${l.stops.length - 1}정거장`))
  if (full.split('\n').length <= MAX_LINES) return full
  layStats.widows = widows
  // 환승이 많고 역 이름이 길면 넘친다. 노선 순서와 환승역만 남긴다.
  // 환승역은 한 줄에 들어가면 한 줄, 넘치면 한 역씩 줄을 나눈다(기계가 이름 가운데를 끊지 않게).
  const via = a.legs.slice(1).map(l => l.stops[0])
  const one = `${PAD}환승 ${via.join(', ')}`
  return page([
    `${PAD}${a.legs.map(l => l.line).join(' → ')}`,
    ...(cols(one) <= MAX_COLS ? [one] : via.map((v, i) => `${PAD}${i ? '     ' : '환승 '}${v}`)),
  ])
}

// 안내와 오류. 어떤 화면에서든 탭으로 빠져나갈 수 있어야 한다.
export function notice(now: number, title: string, body: string, hint: string, ctx = ''): string {
  return page([fitHead(now, ctx), '', `${PAD}${title}`, '', body ? `${PAD}${body}` : null], hints(hint))
}
