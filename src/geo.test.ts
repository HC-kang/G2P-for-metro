import test from 'node:test'
import assert from 'node:assert/strict'
import { distanceM, nearest, missedAway } from './geo.ts'

// 실제 좌표 (subwayStationMaster)
const 서울역 = { name: '서울역', lat: 37.556228, lon: 126.972135 }
const 시청 = { name: '시청', lat: 37.565715, lon: 126.977088 }
const 종각 = { name: '종각', lat: 37.570161, lon: 126.982923 }

test('distanceM은 미터 거리를 준다', () => {
  assert.equal(distanceM(37.556228, 126.972135, 37.556228, 126.972135), 0)
  const d = distanceM(서울역.lat, 서울역.lon, 시청.lat, 시청.lon)
  assert.ok(d > 900 && d < 1300, `서울역-시청 거리가 ${d}m입니다`)
})

test('nearest는 가까운 순으로 준다', () => {
  const out = nearest(서울역.lat, 서울역.lon, [종각, 시청, 서울역])
  assert.deepEqual(out.map(o => o.name), ['서울역', '시청', '종각'])
  assert.equal(out[0].meters, 0)
})

test('nearest는 개수를 제한한다', () => {
  assert.equal(nearest(서울역.lat, 서울역.lon, [종각, 시청, 서울역], 2).length, 2)
  assert.deepEqual(nearest(0, 0, [], 3), [])
})

test('nearest는 같은 이름을 한 번만 준다', () => {
  const dup = [서울역, { ...서울역, lat: 서울역.lat + 0.0001 }, 시청]
  assert.deepEqual(nearest(서울역.lat, 서울역.lon, dup).map(o => o.name), ['서울역', '시청'])
})

test('실제 좌표로 가까운 역이 나온다', async () => {
  const { COORDS } = await import('./stations.ts')
  // 강남역 좌표에서 가장 가까운 역은 강남이어야 한다
  const gangnam = COORDS.find(c => c.name === '강남')!
  assert.equal(nearest(gangnam.lat, gangnam.lon, COORDS, 3)[0].name, '강남')
})

// 10-02·10-03 실기록 좌표: 멀리서 고른 열차가 떠난 뒤에도 지상에 있었다
test('고른 열차가 떠난 뒤에도 역 밖에 있었으면 놓친 것으로 본다', async () => {
  const { COORDS } = await import('./stations.ts')
  const at = (n: string) => { const c = COORDS.find(c => c.name === n)!; return { lat: c.lat, lon: c.lon } }
  const dep = 1_000_000
  const 하계 = at('하계'), 홍대 = at('홍대입구')
  const ahead7 = ['공릉', '태릉입구', '먹골'].map(at)
  const far = { lat: 37.6354525955175, lon: 127.06484040511386 }   // 10-03 16:40 하계에서 295m
  const before = { ...far, acc: 40, t: dep - 60_000 }
  // 고를 때 295m(오차 40m), 떠난 뒤 30초에도 거기 → 놓쳤다
  const d1 = missedAway([before, { ...far, acc: 40, t: dep + 30_000 }], 하계, ahead7, dep)
  assert.ok(d1 != null && Math.round(d1) === 295, String(d1))
  // 10-02 21:07 홍대입구에서 198m(오차 59m) → 놓쳤다
  const hongdae = { lat: 37.558145078326845, lon: 126.92517378318394 }
  assert.ok(missedAway([{ ...hongdae, acc: 59, t: dep - 90_000 }, { ...hongdae, acc: 59, t: dep + 25_000 }], 홍대, [at('신촌')], dep) != null)
  // 떠나기 전에 승강장(역 근처)에 닿았다 → 탔을 수 있다
  assert.equal(missedAway([before, { ...하계, acc: 30, t: dep - 10_000 }, { ...far, acc: 40, t: dep + 30_000 }], 하계, ahead7, dep), null)
  // 떠난 뒤 측위가 역 근처 → 탔을 수 있다
  assert.equal(missedAway([before, { ...하계, acc: 30, t: dep + 30_000 }], 하계, ahead7, dep), null)
  // 떠난 뒤 측위가 없거나, 오차가 크거나, 2분이 지난 뒤의 것이면 판단하지 않는다
  assert.equal(missedAway([before], 하계, ahead7, dep), null)
  assert.equal(missedAway([before, { ...far, acc: 400, t: dep + 30_000 }], 하계, ahead7, dep), null)
  assert.equal(missedAway([before, { ...far, acc: 40, t: dep + 200_000 }], 하계, ahead7, dep), null)
  // 다음 역(공릉) 근처면 열차 안일 수 있다(지상 구간)
  assert.equal(missedAway([before, { ...at('공릉'), acc: 30, t: dep + 90_000 }], 하계, ahead7, dep), null)
  // 걸어서 못 가는 거리로 튀었다(10-01: 열차 안 측위가 수 km 떨어진 한 점으로 잡혔다, 오차 67m. 좌표는 예시) → 판단하지 않는다
  assert.equal(missedAway([before, { lat: 37.6129, lon: 127.1033, acc: 67, t: dep + 60_000 }], 하계, ahead7, dep), null)
})
