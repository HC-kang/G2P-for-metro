import test from 'node:test'
import assert from 'node:assert/strict'
import { plan, stopsLeft } from './route.ts'

const shape = (from: string, to: string) =>
  plan(from, to)?.legs.map(l => `${l.line}:${l.stops.length - 1}`).join(' ') ?? '실패'

test('plan은 환승 없는 경로를 한 구간으로 준다', () => {
  const p = plan('홍대입구', '강남')
  assert.equal(p?.legs.length, 1)
  assert.equal(p?.legs[0].line, '2호선')
  assert.equal(p?.legs[0].stops[0], '홍대입구')
  assert.equal(p?.legs[0].stops.at(-1), '강남')
  assert.equal(p!.legs[0].stops.length - 1, 17)
})

test('plan은 환승을 구간으로 나눈다', () => {
  const p = plan('잠실', '경복궁')
  assert.equal(p?.legs.length, 2)
  assert.equal(p?.legs[0].line, '2호선')
  assert.equal(p?.legs[1].line, '3호선')
  // 환승역은 앞 구간의 마지막이자 뒤 구간의 첫 역이다
  assert.equal(p?.legs[0].stops.at(-1), p?.legs[1].stops[0])
  assert.equal(p?.legs[0].stops.at(-1), '을지로3가')
  // 환승역이 앞 구간에 두 번 들어가면 안 된다
  assert.equal(p!.legs[0].stops.filter(s => s === '을지로3가').length, 1)
})

test('plan은 순환선의 짧은 쪽으로 돈다', () => {
  assert.equal(shape('충정로', '시청'), '2호선:1')
  assert.equal(shape('강남', '신촌'), '2호선:18')
})

test('plan은 지선과 알파벳 분기를 건넌다', () => {
  assert.equal(shape('신도림', '까치산'), '2호선:4')
  assert.equal(shape('성수', '신설동'), '2호선:4')
  const far = plan('서울역', '수원')
  assert.ok(far, '서울역 → 수원 경로를 찾아야 합니다')
  assert.equal(far!.legs.at(-1)!.stops.at(-1), '수원')
  assert.equal(far!.legs[0].stops[0], '서울역')
})

test('plan은 알 수 없는 역에 null을 준다', () => {
  assert.equal(plan('없는역', '강남'), null)
  assert.equal(plan('강남', '없는역'), null)
  assert.equal(plan('강남', '강남'), null)
})

test('stops[1]이 방향을 가른다', () => {
  // 방향 판정은 이 값 하나에 달려 있다(spec §10.3)
  assert.equal(plan('강남', '교대')!.legs[0].stops[1], '교대')
  assert.equal(plan('강남', '역삼')!.legs[0].stops[1], '역삼')
  assert.equal(plan('시청', '강남')!.legs[0].stops[1], '을지로입구')
})

test('stopsLeft는 남은 정거장 수를 준다', () => {
  const s = ['A', 'B', 'C', 'D']
  assert.equal(stopsLeft(s, 'A'), 3)
  assert.equal(stopsLeft(s, 'C'), 1)
  assert.equal(stopsLeft(s, 'D'), 0)
  assert.equal(stopsLeft(s, 'Z'), -1)
})

import { paceMs, locate, DEFAULT_PACE_MS } from './route.ts'

const S = ['A', 'B', 'C', 'D', 'E', 'F']

test('paceMs는 관측에서 역간 소요시간을 구한다', () => {
  assert.equal(paceMs(S, [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }, { station: 'C', at: 180_000 }]), 90_000)
})

test('paceMs는 관측이 부족하면 기본값을 준다', () => {
  assert.equal(paceMs(S, []), DEFAULT_PACE_MS)
  assert.equal(paceMs(S, [{ station: 'A', at: 0 }]), DEFAULT_PACE_MS)
})

test('paceMs는 같은 역 연속 관측을 하나로 묶는다', () => {
  assert.equal(paceMs(S, [{ station: 'A', at: 0 }, { station: 'A', at: 10_000 }, { station: 'B', at: 60_000 }]), 60_000)
})

test('locate는 최근 관측이면 추정하지 않는다', () => {
  const f = [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }]
  assert.deepEqual(locate(S, f, 100_000), { index: 1, estimated: 0, stale: false })
})

test('locate는 신호가 끊기면 관측 속도로 위치를 민다', () => {
  const f = [{ station: 'A', at: 0 }, { station: 'B', at: 45_000 }]
  // 100초 지났다. 45초에 한 정거장이므로 2정거장을 민다. STALE_MS 안이다.
  assert.deepEqual(locate(S, f, 145_000), { index: 3, estimated: 2, stale: false })
})

test('locate는 STALE_MS를 넘으면 stale이다', () => {
  const f = [{ station: 'A', at: 0 }, { station: 'B', at: 90_000 }]
  assert.equal(locate(S, f, 90_000 + 180_001)!.stale, true)
  assert.equal(locate(S, f, 90_000 + 179_000)!.stale, false)
})

test('locate는 경로 끝을 넘지 않는다', () => {
  assert.equal(locate(S, [{ station: 'D', at: 0 }], 10_000_000)!.index, S.length - 1)
})

test('locate는 관측이 없으면 null을 준다', () => {
  assert.equal(locate(S, [], 1000), null)
  assert.equal(locate(S, [{ station: 'Z', at: 0 }], 1000), null)
})
