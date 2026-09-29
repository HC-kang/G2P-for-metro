import test from 'node:test'
import assert from 'node:assert/strict'
import { plan, reaches, stopsLeft } from './route.ts'

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

test('locate의 추정은 하차역 바로 앞에서 멈추고, 하차역은 관측으로만 도착한다', () => {
  // 추정으로 도착을 선언하면 폴링이 멈추거나 열차보다 먼저 환승 화면이 떴다
  assert.equal(locate(S, [{ station: 'D', at: 0 }], 10_000_000)!.index, S.length - 2)
  assert.equal(locate(S, [{ station: S[S.length - 1], at: 0 }], 1000)!.index, S.length - 1)
})

test('관측이 역을 건너뛰어도 속도는 한 역 40초 밑으로 내려가지 않는다', async () => {
  const { paceMs, MIN_PACE_MS } = await import('./route.ts')
  assert.equal(paceMs(S, [{ station: S[0], at: 0 }, { station: S[4], at: 14_000 }]), MIN_PACE_MS)
})

test('locate는 관측이 없으면 null을 준다', () => {
  assert.equal(locate(S, [], 1000), null)
  assert.equal(locate(S, [{ station: 'Z', at: 0 }], 1000), null)
})

test('정차 중인 열차를 다시 관측하면 다음 역으로 밀지 않고, 도착 예정은 늦춘다', async () => {
  const { locate, legEta, FEED_LAG_MS } = await import('./route.ts')
  // 90초에 B 도착, 그 뒤 3분 동안 계속 B 도착으로 보였다(지연 정차)
  const f = [{ station: 'A', at: 0, status: 2 }, { station: 'B', at: 90_000, seen: 270_000, status: 1 }]
  assert.deepEqual(locate(S, f, 280_000), { index: 1, estimated: 0, stale: false }, '방금 다시 봤으니 B다')
  const etaMoving = legEta(S, [{ station: 'A', at: 0, status: 2 }, { station: 'B', at: 90_000, seen: 90_000, status: 1 }], 100_000)
  assert.ok(legEta(S, f, 280_000) > etaMoving, '서 있었던 만큼 도착 예정이 늦어진다')
  assert.equal(legEta(S, f, 280_000), 270_000 - FEED_LAG_MS + 4 * 90_000)
})

test('도착 예정은 현재시각이 흘러도 흔들리지 않는다', async () => {
  const { legEta } = await import('./route.ts')
  const f = [{ station: 'A', at: 0, status: 2 }, { station: 'B', at: 90_000, status: 2 }]
  assert.equal(legEta(S, f, 100_000), legEta(S, f, 150_000))
})

test('신호 끊김은 마지막 확인 시각부터 센다', async () => {
  const { locate, STALE_MS } = await import('./route.ts')
  const f = [{ station: 'B', at: 0, seen: 500_000, status: 1 }]
  assert.equal(locate(S, f, 500_000 + STALE_MS - 1)!.stale, false)
  assert.equal(locate(S, f, 500_000 + STALE_MS + 1)!.stale, true)
})

test('같은 노선 위 정거장 수를 센다', async () => {
  const { hops } = await import('./route.ts')
  assert.equal(hops('7호선', '중계', '하계'), 1)
  assert.equal(hops('7호선', '하계', '청담'), 14)
  assert.equal(hops('7호선', '하계', '없는역'), -1)
})

test('자동 탑승은 하차역까지 가는 열차만 고른다(행선지·지선)', () => {
  assert.equal(reaches('1호선', ['신도림', '구로', '부평'], '인천'), true)
  assert.equal(reaches('1호선', ['신도림', '구로', '부평'], '천안'), false)    // 구로에서 갈라지는 다른 지선
  assert.equal(reaches('5호선', ['천호', '강동', '둔촌동'], '하남검단산'), false)   // 강동에서 갈라지는 다른 지선
  assert.equal(reaches('5호선', ['천호', '길동'], '하남검단산'), true)
  assert.equal(reaches('5호선', ['천호', '거여'], '마천'), true)
  assert.equal(reaches('7호선', ['하계', '공릉', '태릉입구', '먹골'], '태릉입구'), false)   // 하차역 앞에서 끝남
  assert.equal(reaches('7호선', ['하계', '공릉', '태릉입구'], '석남'), true)
  assert.equal(reaches('7호선', ['하계', '공릉'], '모르는역'), true)             // 모르면 막지 않는다
})
