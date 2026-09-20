import test from 'node:test'
import assert from 'node:assert/strict'
import * as S from './screen.ts'

const fits = (s: string, what: string) =>
  assert.ok(S.bytes(s) <= S.PAGE_BYTES, `${what}: ${S.bytes(s)}바이트`)

test('bytes는 UTF-8 바이트를 센다', () => {
  assert.equal(S.bytes('가'), 3)
  assert.equal(S.bytes('ab'), 2)
})

test('fitItems는 항목과 페이지 바이트 한도를 지킨다', () => {
  const items = Array.from({ length: 8 }, () => '가'.repeat(40))
  const out = S.fitItems(items)
  assert.equal(out.length, 8)
  assert.ok(out.every(i => S.bytes(i) <= S.ITEM_BYTES))
  assert.ok(S.bytes(out.join('')) <= S.PAGE_BYTES)
  assert.deepEqual(S.fitItems(['잠실  2·8  120m']), ['잠실  2·8  120m'])
})

test('track은 관측, 추정, 남은 역, 하차역을 그린다', () => {
  assert.equal(S.track(6, 3, 0), '●━●━●━●━○━◎')
  // index=3, estimated=2 이면 2번과 3번 칸이 추정이다
  assert.equal(S.track(6, 3, 2), '●━●━◌━◌━○━◎')
  assert.equal(S.track(6, 0, 0), '●━○━○━○━○━◎')
  assert.equal(S.track(6, 5, 0), '●━●━●━●━●━◎')
})

test('track은 길면 앞을 줄인다', () => {
  const bar = S.track(30, 20, 0, 12)
  assert.ok(bar.startsWith('⋯'), bar)
  assert.ok(bar.endsWith('◎'), bar)
  assert.ok(bar.length <= 24, bar)
})

test('riding은 다음 역을 강조하고 환승을 알린다', () => {
  const s = S.riding({
    line: '2호선', toward: '성수', next: '역삼', dest: '교대',
    stopsLeft: 4, paceMs: 120_000, pathLen: 7, index: 3, estimated: 0,
    transfer: { station: '교대', line: '3호선' },
  })
  assert.ok(s.replace(/ /g, '').includes('역삼'), s)   // 자간을 벌리므로 공백을 지우고 본다
  assert.ok(s.includes('4정거장') && s.includes('교대'))
  assert.ok(s.includes('3호선'))
  fits(s, 'riding')
})

test('riding은 환승이 없으면 환승 줄을 넣지 않는다', () => {
  const s = S.riding({
    line: '2호선', toward: '성수', next: '역삼', dest: '강남',
    stopsLeft: 4, paceMs: 120_000, pathLen: 7, index: 3, estimated: 0,
  })
  assert.ok(!s.includes('▸'), s)
  fits(s, 'riding 환승 없음')
})

test('alight는 남은 정거장에 따라 말을 바꾼다', () => {
  const two = S.alight({ stopsLeft: 2, dest: '강남', next: '역삼', minutes: 4 })
  const one = S.alight({ stopsLeft: 1, dest: '강남', next: '강남', minutes: 2 })
  assert.ok(two.includes('두  정 거 장  뒤'), two)
  assert.ok(one.includes('다 음 역 에 서  내 립 니 다'), one)
  // "다음다음에"라는 어색한 말이 남아 있으면 안 된다
  assert.ok(!two.replace(/ /g, '').includes('다음다음'), two)
  fits(two, 'alight 2')
  fits(one, 'alight 1')
})

test('모든 안내 화면에 탭 복구 경로가 있다', () => {
  const screens = [
    S.arrived('강남'),
    S.transfer({ station: '교대', from: '2호선', to: '3호선', toward: '경복궁' }),
    S.waiting({ line: '7호선', toward: '장암', trainNo: '7273', at: '수락산', from: '노원', etaSec: 180 }),
    S.lost({ last: '선릉', agoSec: 52, guess: '역삼', dest: '강남', stopsLeft: 3, bar: S.track(6, 3, 2) }),
    S.notice('머리말', '본문', '탭: 처음으로'),
  ]
  for (const s of screens) {
    assert.ok(s.includes('탭'), `탭 복구 경로가 없습니다:\n${s}`)
    fits(s, '안내 화면')
  }
})

test('waiting은 열차의 실제 위치와 도착 예정을 보여준다', () => {
  const s = S.waiting({ line: '7호선', toward: '장암', trainNo: '7273', at: '수락산', from: '노원', etaSec: 180 })
  assert.ok(s.replace(/ /g, '').includes('수락산'), s)
  assert.ok(s.includes('3분') && s.includes('노원'), s)
  // 도착 예정이 없으면 시간을 지어내지 않는다
  const zero = S.waiting({ line: '7호선', toward: '장암', trainNo: '7273', at: '수락산', from: '노원', etaSec: 0 })
  assert.ok(!zero.includes('분 뒤'), zero)
})

test('실제 경로로 만든 화면이 모두 한도를 지킨다', async () => {
  const { plan } = await import('./route.ts')
  for (const [a, b] of [['잠실', '경복궁'], ['서울역', '수원'], ['노원', '여의도'], ['까치산', '성수'], ['노원', '하계']]) {
    const p = plan(a, b)!
    fits(S.route(p), `route ${a}→${b}`)
    const leg = p.legs[0]
    const dest = leg.stops[leg.stops.length - 1]
    fits(S.riding({
      line: leg.line, toward: dest, next: leg.stops[1], dest,
      stopsLeft: leg.stops.length - 1, paceMs: 120_000,
      pathLen: leg.stops.length, index: 0, estimated: 0,
      transfer: p.legs[1] ? { station: dest, line: p.legs[1].line } : undefined,
    }), `riding ${a}→${b}`)
    fits(S.alight({ stopsLeft: 2, dest, next: leg.stops[1], minutes: 4 }), `alight ${a}→${b}`)
  }
})

test('rows는 한도를 넘으면 글자를 자르지 않고 곁가지를 버린다', () => {
  const short = ['강남', '교대', '잠실']
  assert.deepEqual(S.rows(short, () => '3정거장'), ['강남  3정거장', '교대  3정거장', '잠실  3정거장'])

  const long = Array.from({ length: 20 }, () => '동대문역사문화공원')
  const out = S.rows(long, () => '40정거장 · 환승 2')
  assert.ok(S.fitsAll(out), `${S.bytes(out.join(''))}바이트`)
  // 잘린 곁가지가 남아 있으면 안 된다
  assert.ok(out.every(r => !r.includes('환') || r.includes('환승')), out[0])
})
