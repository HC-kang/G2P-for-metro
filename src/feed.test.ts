import test from 'node:test'
import assert from 'node:assert/strict'
import { feedSize } from './api.ts'
import { locate, legEta, plan, DEFAULT_PACE_MS, type Fix } from './route.ts'
// @ts-expect-error 워커는 평범한 JS다
import { slimPositions } from '../worker/index.js'

// 10-12 출근: 7호선 위치 피드가 14분 동안 비었다. 고른 열차가 없는 것과 피드가 빈 것을 갈라야 한다.

test('워커는 거르기 전 노선 전체 열차 수를 feed로 준다', () => {
  const raw = JSON.stringify({ realtimePositionList: [
    { trainNo: '7101', statnNm: '중계', subwayId: '1007', trainSttus: '2', recptnDt: '2026-10-12 08:20:00', extra: 'x' },
    { trainNo: '7145', statnNm: '태릉입구', subwayId: '1007', trainSttus: '1', recptnDt: '2026-10-12 08:20:00' },
  ] })
  const one = slimPositions(raw, '7101')
  assert.equal(one.feed, 2)
  assert.equal(JSON.parse(one.body).realtimePositionList.length, 1)
  assert.equal(JSON.parse(one.body).realtimePositionList[0].extra, undefined)
  assert.equal(slimPositions(raw, '9999').feed, 2)   // 열차만 없다. 피드는 살아 있다
})

test('워커: 빈 목록과 INFO-200은 0, 읽을 수 없으면 -1', () => {
  assert.equal(slimPositions(JSON.stringify({ realtimePositionList: [] }), '7101').feed, 0)
  assert.equal(slimPositions(JSON.stringify({ status: 200, code: 'INFO-200', message: '해당하는 데이터가 없습니다.' }), null).feed, 0)
  assert.equal(slimPositions(JSON.stringify({ errorMessage: { code: 'INFO-200' } }), null).feed, 0)
  assert.equal(slimPositions('<html>', null).feed, -1)
  assert.equal(slimPositions(JSON.stringify({ code: 'ERROR-500' }), null).feed, -1)
})

test('앱: 헤더가 있으면 믿고, 없으면 거르지 않은 응답만 목록 길이로 센다', () => {
  assert.equal(feedSize('0', [], true), 0)
  assert.equal(feedSize('44', [], true), 44)
  assert.equal(feedSize(null, [], true), -1)            // 옛 워커 + 열차 거름: 모른다(예전 동작 유지)
  assert.equal(feedSize(null, [], false), 0)            // 노선 전체를 받았는데 비었다
  assert.equal(feedSize('', [{} as never], false), 1)
  assert.equal(feedSize('abc', [], true), -1)
})

test('피드가 빈 동안의 추정 기록은 시각으로 앞으로 밀리고 하차역 앞에서 멈춘다', () => {
  const p = plan('하계', '청담')!
  const stops = p.legs[0].stops
  const dep = 1_000_000
  const est: Fix = { station: stops[0], at: dep, seen: dep, status: 2, arr: dep, first: 2, est: true }
  const early = locate(stops, [est], dep + 30_000)!
  assert.ok(early.index <= 1)   // 떠난 직후는 출발역이나 다음 역 부근
  const later = locate(stops, [est], dep + 5 * DEFAULT_PACE_MS)!
  assert.ok(later.index >= 3 && later.index <= 6, `index ${later.index}`)
  assert.ok(later.estimated > 0)
  const end = locate(stops, [est], dep + 60 * 60_000)!
  assert.equal(end.index, stops.length - 2)   // 도착은 추정으로 선언하지 않는다
  const eta = legEta(stops, [est], dep + 60_000)
  assert.ok(eta > dep + (stops.length - 2) * 60_000 && eta < dep + stops.length * 4 * 60_000)
})
