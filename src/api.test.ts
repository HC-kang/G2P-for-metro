import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePositions, parseArrivals, towardOf } from './api.ts'

// 2026-09-20 실측 응답
const POS = {
  errorMessage: { code: 'INFO-000', total: 37 },
  realtimePositionList: [
    { subwayId: '1002', subwayNm: '2호선', statnNm: '신도림', trainNo: '2324',
      updnLine: '0', statnTnm: '성수종착', trainSttus: '1', directAt: '0',
      recptnDt: '2026-09-20 18:38:29' },
    { subwayId: '1002', subwayNm: '2호선', statnNm: '잠실새내', trainNo: '2301',
      updnLine: '1', statnTnm: '성수종착', trainSttus: '2', directAt: '1',
      recptnDt: '2026-09-20 18:38:38' },
  ],
}

const ARR = {
  errorMessage: { code: 'INFO-000', total: 22 },
  realtimeArrivalList: [
    { subwayId: '1001', statnNm: '서울', updnLine: '상행', trainLineNm: '광운대행 - 시청방면',
      btrainSttus: '일반', barvlDt: '0', btrainNo: '0146', arvlMsg2: '서울 출발' },
    { subwayId: '1065', statnNm: '서울', updnLine: '하행', trainLineNm: '인천공항2터미널행 - 공덕방면',
      btrainSttus: '급행', barvlDt: '180', btrainNo: 'A2203', arvlMsg2: '2분 후 도착' },
  ],
}

test('parsePositions는 필드를 정규화한다', () => {
  const [a, b] = parsePositions(POS)
  assert.equal(a.trainNo, '2324')
  assert.equal(a.station, '신도림')
  assert.equal(a.status, 1)
  assert.equal(a.express, false)
  assert.equal(a.terminal, '성수종착')
  assert.ok(a.at > 0)
  assert.equal(b.express, true)
})

test('parseArrivals는 방면 역을 뽑는다', () => {
  const [a, b] = parseArrivals(ARR)
  assert.equal(a.trainNo, '0146')
  assert.equal(a.toward, '시청', '"광운대행 - 시청방면"의 방면은 시청입니다')
  assert.equal(b.toward, '공덕')
  assert.equal(a.dest, '광운대', '행선지는 승강장 전광판이 보여주는 종착역입니다')
  assert.equal(b.dest, '인천공항2터미널')
  assert.equal(b.etaSec, 180)
  assert.equal(b.express, true)
  assert.equal(a.line, '1호선')
})

test('towardOf는 (급행) 꼬리와 괄호 별칭을 처리한다', () => {
  assert.equal(towardOf('동인천행 - 구로방면 (급행)'), '구로')
  assert.equal(towardOf('불암산행 - 총신대입구(이수)방면'), '총신대입구')
  assert.equal(towardOf('별내행 - 몽촌토성(평화의문)방면'), '몽촌토성')
  assert.equal(towardOf('성수행 - 역삼방면'), '역삼')
  assert.equal(towardOf(''), '')
  assert.equal(towardOf('이상한 문자열'), '')
})

test('파서는 빈 응답과 오류 응답에 빈 배열을 준다', () => {
  assert.deepEqual(parsePositions({}), [])
  assert.deepEqual(parseArrivals({}), [])
  assert.deepEqual(parsePositions({ status: 500, code: 'ERROR-338' }), [])
  assert.deepEqual(parseArrivals(null), [])
})
