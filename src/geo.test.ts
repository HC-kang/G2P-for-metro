import test from 'node:test'
import assert from 'node:assert/strict'
import { distanceM, nearest, pointsToNext } from './geo.ts'

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

test('주행 중 위치는 다음 역에 가깝고 믿을 만할 때만 한 칸 옮긴다', async () => {
  const { COORDS } = await import('./stations.ts')
  const at = (n: string) => { const c = COORDS.find(c => c.name === n)!; return { lat: c.lat, lon: c.lon } }
  const 공릉 = at('공릉'), 태릉 = at('태릉입구')
  const near = (p: { lat: number; lon: number }, dLat = 0.0005) => ({ lat: p.lat + dLat, lon: p.lon })   // 약 55m 떨어진 승강장
  // 공릉에 선 채 공릉 근처 측위: 옮기지 않는다
  assert.equal(pointsToNext({ ...near(공릉), accM: 30, ageMs: 5_000 }, 공릉, 태릉, 60_000), false)
  // 태릉입구 근처 측위(오차 30m, 5초 전): 옮긴다
  assert.equal(pointsToNext({ ...near(태릉), accM: 30, ageMs: 5_000 }, 공릉, 태릉, 60_000), true)
  // 같은 측위라도 묵었거나(25초), 오차가 크거나(300m), 공릉에 닿은 지 40초가 안 됐으면 옮기지 않는다
  assert.equal(pointsToNext({ ...near(태릉), accM: 30, ageMs: 25_000 }, 공릉, 태릉, 60_000), false)
  assert.equal(pointsToNext({ ...near(태릉), accM: 300, ageMs: 5_000 }, 공릉, 태릉, 60_000), false)
  assert.equal(pointsToNext({ ...near(태릉), accM: 30, ageMs: 5_000 }, 공릉, 태릉, 20_000), false)
  // 두 역 사이(터널 한가운데) 측위: 옮기지 않는다
  const mid = { lat: (공릉.lat + 태릉.lat) / 2, lon: (공릉.lon + 태릉.lon) / 2 }
  assert.equal(pointsToNext({ ...mid, accM: 30, ageMs: 5_000 }, 공릉, 태릉, 60_000), false)
})
