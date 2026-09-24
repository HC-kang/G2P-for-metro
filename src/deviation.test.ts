import test from 'node:test'
import assert from 'node:assert/strict'
import { plan, deviation, tripMinutesOf } from './route.ts'

const leg = (from: string, to: string) => plan(from, to)!.legs[0]

test('경로 안의 역이면 on', () => {
  const l = leg('하계', '상봉')            // 7호선 하계·공릉·태릉입구·먹골·중화·상봉
  assert.equal(deviation(l, '공릉', '하계', 2, '홍대입구').kind, 'on')
  assert.equal(deviation(l, '하계', null, 1, '홍대입구').kind, 'on')
})

test('출발역에서 반대로 탔으면 wrongWay, 떠났으면 다음 역에서 내린다', () => {
  const l = leg('하계', '상봉')
  const d = deviation(l, '중계', '하계', 2, '홍대입구')   // 하계→중계는 반대 방향
  assert.equal(d.kind, 'getOff'); if (d.kind !== 'getOff') return
  assert.equal(d.reason, 'wrongWay')
  assert.equal(d.at, '노원', '이미 떠났으니 다음 역(노원)에서 내린다')
  assert.ok(d.plan && d.plan.from === '노원' && d.plan.to === '홍대입구')
})

test('역에 서 있으면(도착) 그 역에서 내린다', () => {
  const l = leg('하계', '상봉')
  const d = deviation(l, '중계', '하계', 1, '홍대입구')
  assert.equal(d.kind, 'getOff'); if (d.kind !== 'getOff') return
  assert.equal(d.at, '중계')
})

test('하차역을 지나쳤으면 missed, 되돌아가는 경로를 준다', () => {
  const l = leg('노원', '하계')            // 노원·중계·하계, 목적지 하계
  const d = deviation(l, '공릉', '하계', 2, '하계')   // 하계를 지나 공릉
  assert.equal(d.kind, 'getOff'); if (d.kind !== 'getOff') return
  assert.equal(d.reason, 'missed')
  assert.equal(d.at, '태릉입구', '떠났으니 다음 역에서 내려 되돌아간다')
  assert.ok(d.plan && d.plan.legs[0].line === '7호선' && d.plan.legs[0].stops[1] === '공릉')
})

test('지선으로 빠지면 diverted', () => {
  const l = leg('신도림', '홍대입구')       // 2호선 본선 신도림→…→홍대입구
  const d = deviation(l, '도림천', '신도림', 2, '홍대입구')   // 신정지선
  assert.equal(d.kind, 'getOff'); if (d.kind !== 'getOff') return
  assert.equal(d.reason, 'diverted')
  assert.equal(d.at, '양천구청')
  assert.ok(d.plan && d.plan.to === '홍대입구')
})

test('반대로 돌아도 비슷하면 그냥 타고 간다 (2호선 순환)', () => {
  const l = leg('시청', '강남')            // 내선 21정거장
  const d = deviation(l, '충정로', '시청', 2, '강남')   // 외선으로 출발
  assert.equal(d.kind, 'continue', JSON.stringify(d)); if (d.kind !== 'continue') return
  assert.equal(d.plan.legs[0].line, '2호선')
  assert.equal(d.plan.legs[0].stops[0], '충정로')
  assert.equal(d.plan.legs[0].stops[1], '아현')
  assert.ok(Math.abs(tripMinutesOf(d.plan) - tripMinutesOf(plan('충정로', '강남')!)) <= 6)
})

test('관측된 역이 최종 목적지면 거기서 내린다', () => {
  const l = leg('노원', '중계')
  const d = deviation(l, '하계', '중계', 1, '하계')
  assert.deepEqual(d, { kind: 'getOff', at: '하계', plan: null, reason: 'diverted' })
})

test('그래프에 없는 역이면 unknown', () => {
  assert.equal(deviation(leg('하계', '상봉'), '없는역', '하계', 2, '홍대입구').kind, 'unknown')
})

test('방향을 모르면(prev 없음, 이웃 둘) 지금 역에서 내린다', () => {
  const l = leg('하계', '상봉')
  const d = deviation(l, '노원', null, 2, '홍대입구')
  assert.equal(d.kind, 'getOff'); if (d.kind !== 'getOff') return
  assert.equal(d.at, '노원')
})

test('폴링이 하차역을 건너뛰어도 지나침을 잡는다', () => {
  const l = leg('노원', '하계')            // 노원·중계·하계
  const d = deviation(l, '공릉', '중계', 2, '하계')   // 중계 다음 관측이 공릉(하계를 건너뜀)
  assert.equal(d.kind, 'getOff'); if (d.kind !== 'getOff') return
  assert.equal(d.reason, 'missed')
  assert.equal(d.at, '태릉입구', '경로 쪽 이웃(하계)을 뒤로 잡아 앞(태릉입구)에서 내린다')
})
