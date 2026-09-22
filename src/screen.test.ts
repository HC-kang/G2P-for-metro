import test from 'node:test'
import assert from 'node:assert/strict'
import * as S from './screen.ts'

// 2026-09-20 18:42 KST 고정. 시각이 들어가는 화면을 결정적으로 만든다.
const T = new Date('2026-09-20T18:42:00+09:00').getTime()
const R = { inSec: 12, totalSec: 20, failed: false }

const ok = (s: string, what: string) => {
  assert.ok(S.bytes(s) <= S.PAGE_BYTES, `${what}: ${S.bytes(s)}바이트\n${s}`)
  assert.ok(S.cols(s) <= S.MAX_COLS, `${what}: ${S.cols(s)}칸\n${s}`)
  assert.ok(s.split('\n').length <= S.MAX_LINES, `${what}: ${s.split('\n').length}줄\n${s}`)
}

const riding = (over: Partial<Parameters<typeof S.riding>[0]> = {}) => S.riding({
  now: T, line: '2호선', at: { station: '삼성', label: '출발' }, refresh: R,
  next: '역삼', legDest: '교대',
  stopsLeft: 4, paceMs: 120_000, pathLen: 7, index: 3, estimated: 0, ...over,
})

const waiting = () => S.waiting({ now: T, line: '7호선', toward: '장암', at: '수락산', from: '노원', etaSec: 180, refresh: R })
const transfer = () => S.transfer({ now: T, station: '교대', from: '2호선', to: '3호선', toward: '경복궁', rest: 3, minutes: 10 })
const lost = () => S.lost({ now: T, last: '선릉', agoSec: 52, guess: '역삼', dest: '강남', stopsLeft: 3, bar: S.track(6, 3, 2), refresh: R })
const alight = (n: number) => S.alight({ now: T, stopsLeft: n, dest: '하계', next: '중계', minutes: n * 2 })

test('bytes와 cols', () => {
  assert.equal(S.bytes('가'), 3)
  assert.equal(S.cols('가나'), 4)
  assert.equal(S.cols('ab'), 2)
  assert.equal(S.cols('가\nabc'), 3)
})

test('hhmm은 시각을 두 자리로 준다', () => {
  assert.equal(S.hhmm(T), '18:42')
  assert.equal(S.hhmmss(T), '18:42:00')
  assert.equal(S.hhmmss(T + 7_000), '18:42:07')
  assert.equal(S.hhmm(new Date('2026-09-20T09:05:00+09:00').getTime()), '09:05')
})

test('ago는 데이터가 얼마나 묵었는지 말한다', () => {
  assert.equal(S.ago(0), '0초 전')
  assert.equal(S.ago(8), '8초 전')
  assert.equal(S.ago(59), '59초 전')
  assert.equal(S.ago(60), '1분 전')
  assert.equal(S.ago(190), '3분 전')
  assert.equal(S.ago(-1), '')   // 아직 받은 것이 없으면 시간을 지어내지 않는다
})

test('주행 화면이 갱신 막대와 초읽기를 보여준다', () => {
  // 폴링이 도는지, 곧 바뀌는지 화면만 보고 알 수 있어야 한다
  assert.ok(riding().includes('12초 뒤 갱신'), riding())
  assert.ok(waiting().includes('12초 뒤 갱신'), waiting())
  // 막대는 실기기에서 보인 것이 확인된 글리프(━ ─)만 쓴다. 다 차면 갱신이다
  const bar = (inSec: number) => S.refreshLine({ inSec, totalSec: 20, failed: false }).slice(0, 7)
  assert.equal(bar(20), '───────')
  assert.equal(bar(10), '━━━━───')      // 절반 지남 → 3.5 → 4칸
  assert.equal(bar(0), '━━━━━━━')
  assert.ok(/^[━─]{7}$/.test(bar(7)), '막대 글리프는 ━ ─ 뿐이어야 합니다: ' + bar(7))
  // 전각 막대 7칸 + 가장 긴 문구가 32칸 안에 든다
  assert.ok(S.cols('  ' + S.refreshLine({ inSec: 7, totalSec: 20, failed: true })) <= S.MAX_COLS)
  // 초읽기는 두 자리 고정. 자릿수가 바뀌어도 줄이 흔들리지 않는다
  const tail = (inSec: number) => S.refreshLine({ inSec, totalSec: 20, failed: false }).slice(7)
  assert.equal(tail(12), ' 12초 뒤 갱신')
  assert.equal(tail(9), '  9초 뒤 갱신')
  assert.equal(tail(12).length, tail(9).length)
  assert.ok(S.refreshLine({ inSec: 7, totalSec: 20, failed: true }).includes(' 7초 뒤 재시도'))
  assert.ok(riding({ refresh: { inSec: 0, totalSec: 20, failed: false } }).includes('갱신 중'))
})

test('statusWord는 전광판과 같은 말을 쓴다', () => {
  assert.equal(S.statusWord(0), '진입')
  assert.equal(S.statusWord(1), '도착')
  assert.equal(S.statusWord(2), '출발')
  assert.equal(S.statusWord(9), '')
})

test('fitItems는 항목과 페이지 바이트 한도를 지킨다', () => {
  const items = Array.from({ length: 8 }, () => '가'.repeat(40))
  const out = S.fitItems(items)
  assert.ok(out.every(i => S.bytes(i) <= S.ITEM_BYTES))
  assert.ok(S.bytes(out.join('')) <= S.PAGE_BYTES)
  assert.deepEqual(S.fitItems(['잠실  2호선·8호선  120m']), ['잠실  2호선·8호선  120m'])
})

test('rows는 한도를 넘으면 글자를 자르지 않고 곁가지를 버린다', () => {
  assert.deepEqual(S.rows(['강남', '교대'], () => '3정거장'), ['강남  3정거장', '교대  3정거장'])
  const out = S.rows(Array.from({ length: 20 }, () => '동대문역사문화공원'), () => '40정거장 · 약 80분 · 환승 2')
  assert.ok(S.fitsAll(out), `${S.bytes(out.join(''))}바이트`)
  assert.ok(out.every(r => !r.includes('환') || r.includes('환승')), out[0])
})

test('track은 관측, 추정, 남은 역, 하차역을 그린다', () => {
  assert.equal(S.track(6, 3, 0), '●●●●○◎')
  assert.equal(S.track(6, 3, 2), '●●◌◌○◎')   // index=3, estimated=2 → 2·3번 칸이 추정
  assert.equal(S.track(6, 0, 0), '●○○○○◎')
  const bar = S.track(30, 20, 0, 10)
  assert.ok(bar.startsWith('⋯') && bar.endsWith('◎') && bar.length === 10, bar)
})

test('riding은 지금 어디인지와 다음 역을 함께 보여준다', () => {
  const s = riding()
  assert.ok(s.includes('삼성 출발'), `지금 어디인지 보여야 합니다:\n${s}`)
  assert.ok(s.replace(/ /g, '').includes('역삼'), s)   // 자간을 벌리므로 공백을 지우고 본다
  assert.ok(s.includes('현재시각 18:42'), s)
  assert.ok(s.includes('교대 18:50 도착'), s)          // 4정거장 × 2분
  assert.ok(s.includes('4정거장'), s)
  ok(s, 'riding')
})

test('riding은 추정 구간임을 밝힌다', () => {
  const s = riding({ at: { station: '삼성', label: '부근 (추정)' }, estimated: 2 })
  assert.ok(s.includes('삼성 부근 (추정)'), s)
  assert.ok(s.includes('◌'), '추정 구간은 진행 띠에도 나타나야 합니다')
  ok(s, 'riding 추정')
})

test('riding은 환승이 있으면 환승과 최종 도착을 보여준다', () => {
  const s = riding({ transfer: { line: '3호선', finalDest: '강남', finalMinutes: 22 } })
  assert.ok(s.includes('교대 18:50 환승'), s)
  assert.ok(s.includes('3호선으로'), s)
  assert.ok(s.includes('강남 19:04 도착'), s)          // 18:42 + 22분
  ok(s, 'riding 환승')
})

test('alight는 남은 정거장에 따라 말을 바꾼다', () => {
  const two = alight(2), one = alight(1)
  assert.ok(two.includes('두  정 거 장  뒤'), two)
  assert.ok(one.includes('다 음 역 에 서  내 립 니 다'), one)
  assert.ok(one.includes('18:44 도착'), one)
  assert.ok(!two.replace(/ /g, '').includes('다음다음'), '어색한 말이 남아 있습니다')
  ok(two, 'alight 2')
  ok(one, 'alight 1')
})

test('transfer는 환승 뒤 남은 여정을 보여준다', () => {
  const s = transfer()
  assert.ok(s.includes('3호선') && s.includes('경복궁'))
  assert.ok(s.includes('남은 3정거장') && s.includes('18:52 도착 예정'), s)
  assert.ok(s.includes('방면 승강장으로'), s)
  ok(s, 'transfer')
})

test('waiting은 열차의 실제 위치와 도착 예정을 보여준다', () => {
  const s = waiting()
  assert.ok(s.replace(/ /g, '').includes('수락산'), s)
  assert.ok(s.includes('18:45 도착') && s.includes('약 3분'), s)
  // 도착 예정이 없으면 시간을 지어내지 않는다
  const zero = S.waiting({ now: T, line: '7호선', toward: '장암', at: '수락산', from: '노원', etaSec: 0, refresh: R })
  assert.ok(!zero.includes('도착 ·') && zero.includes('노원 도착을 기다립니다'), zero)
  ok(s, 'waiting')
})

test('모든 화면이 현재시각을 밝히고 한도를 지킨다', () => {
  const screens: [string, string][] = [
    ['riding', riding()],
    ['riding 환승', riding({ transfer: { line: '3호선', finalDest: '강남', finalMinutes: 22 } })],
    ['alight2', alight(2)], ['alight1', alight(1)],
    ['arrived', S.arrived(T, '하계')],
    ['transfer', transfer()], ['waiting', waiting()], ['lost', lost()],
    ['notice', S.notice(T, '머리말', '본문입니다', '탭: 처음으로\n더블탭: 종료')],
  ]
  for (const [name, s] of screens) {
    assert.ok(s.split('\n')[0].includes('현재시각 18:42:00'), `${name}: 첫 줄에 초 단위 현재시각이 없습니다\n${s}`)
    ok(s, name)
  }
  // 도착 예정 시각에는 '현재시각'이 붙지 않아야 한다
  assert.ok(riding().includes('교대 18:50 도착'))
})

test('빠져나갈 수 없는 화면이 없다', () => {
  for (const [name, s] of [
    ['arrived', S.arrived(T, '하계')], ['transfer', transfer()],
    ['waiting', waiting()], ['lost', lost()],
    ['notice', S.notice(T, '머리말', '본문', '탭: 처음으로')],
  ] as [string, string][]) {
    assert.ok(s.includes('탭'), `${name}에 탭 복구 경로가 없습니다:\n${s}`)
  }
})

test('실제 경로로 만든 화면이 모두 한도를 지킨다', async () => {
  const { plan } = await import('./route.ts')
  for (const [a, b] of [['잠실', '경복궁'], ['서울역', '수원'], ['노원', '여의도'], ['까치산', '성수'], ['노원', '하계'], ['디지털미디어시티', '동대문역사문화공원']]) {
    const p = plan(a, b)!
    const stops = p.legs.reduce((n, l) => n + l.stops.length - 1, 0)
    ok(S.route({ now: T, from: p.from, to: p.to, legs: p.legs, stops, minutes: stops * 2 }), `route ${a}→${b}`)
    const leg = p.legs[0]
    const legDest = leg.stops[leg.stops.length - 1]
    ok(riding({
      line: leg.line, at: { station: leg.stops[0], label: '출발' }, next: leg.stops[1], legDest,
      stopsLeft: leg.stops.length - 1, pathLen: leg.stops.length, index: 0,
      transfer: p.legs[1] ? { line: p.legs[1].line, finalDest: p.to, finalMinutes: stops * 2 } : undefined,
    }), `riding ${a}→${b}`)
    ok(S.alight({ now: T, stopsLeft: 2, dest: legDest, next: leg.stops[1], minutes: 4 }), `alight ${a}→${b}`)
    ok(S.arrived(T, p.to), `arrived ${a}→${b}`)
  }
})

test('tiers는 자르지 않고 단계를 내린다', () => {
  const full = ['3분  공릉방면  석남행 급행', '8분  중계방면  장암행']
  assert.deepEqual(S.tiers(full, ['x']), full)   // 들어가면 그대로

  // 20개가 들어가지 않으면 다음 단계로 내려간다. 글자를 자르지 않는다.
  const long = Array.from({ length: 20 }, () => '12분  동대문역사문화공원방면  인천공항2터미널행 급행')
  const mid = Array.from({ length: 20 }, () => '12분  동대문역사문화공원방면')
  const out = S.tiers(long, mid)
  assert.deepEqual(out, mid)
  assert.ok(S.fitsAll(out))
  assert.ok(out.every(r => r.endsWith('방면')), '중간에서 잘린 항목이 있습니다')
})

test('route 화면은 한도 경고를 붙일 수 있다', () => {
  const p = { now: T, from: '잠실', to: '강남', legs: [{ line: '2호선', stops: ['잠실', '강남'] }], stops: 1, minutes: 2 }
  assert.ok(!S.route(p).includes('오늘 조회'))
  const warned = S.route({ ...p, quota: '오늘 조회 850/1000' })
  assert.ok(warned.includes('850/1000'), warned)
  ok(warned, 'route 경고')
})
