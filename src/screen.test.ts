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
  // top은 wide()로 자간을 넣으므로 '역삼'이 '역 삼'이 된다. 공백을 지우고 본다.
  assert.ok(b.top.replace(/ /g, '').includes('역삼'), b.top)
  assert.ok(b.mid.includes('4') && b.mid.includes('강남'))
  assert.ok(b.bottom.includes('교대') && b.bottom.includes('3호선'))
  assert.ok(bytes(b.top + b.mid + b.bottom) <= PAGE_BYTES)
})

test('ridingBoxes는 환승이 없으면 목적지를 보여준다', () => {
  const b = ridingBoxes({ next: '역삼', stopsLeft: 4, paceMs: 120_000, dest: '강남', pathLen: 7, index: 3, estimated: 0 })
  assert.ok(b.bottom.includes('강남'))
})

test('ridingBoxes는 긴 경로에서도 한도를 지킨다', () => {
  const b = ridingBoxes({
    next: '동대문역사문화공원', stopsLeft: 42, paceMs: 120_000, dest: '동대문역사문화공원',
    pathLen: 50, index: 7, estimated: 3,
    transfer: { station: '동대문역사문화공원', line: '경의중앙선', stopsAway: 42 },
  })
  assert.ok(bytes(b.top + b.mid + b.bottom) <= PAGE_BYTES, `${bytes(b.top + b.mid + b.bottom)}바이트`)
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

test('실제 경로로 만든 화면도 한도를 지킨다', async () => {
  const { plan } = await import('./route.ts')
  for (const [a, b] of [['잠실', '경복궁'], ['서울역', '수원'], ['노원', '여의도'], ['까치산', '성수']]) {
    const p = plan(a, b)!
    assert.ok(bytes(planScreen(p)) <= PAGE_BYTES, `planScreen ${a}→${b}: ${bytes(planScreen(p))}바이트`)
    const leg = p.legs[0]
    const boxes = ridingBoxes({
      next: leg.stops[1], stopsLeft: leg.stops.length - 1, paceMs: 120_000,
      dest: leg.stops[leg.stops.length - 1], pathLen: leg.stops.length, index: 0, estimated: 0,
      transfer: p.legs[1] ? { station: leg.stops[leg.stops.length - 1], line: p.legs[1].line, stopsAway: leg.stops.length - 1 } : undefined,
    })
    const n = bytes(boxes.top + boxes.mid + boxes.bottom)
    assert.ok(n <= PAGE_BYTES, `ridingBoxes ${a}→${b}: ${n}바이트`)
  }
})
