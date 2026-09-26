import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePositions, parseArrivals, towardOf, ApiError } from './api.ts'

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

test('파서는 빈 응답에 빈 배열을 준다', () => {
  assert.deepEqual(parsePositions({}), [])
  assert.deepEqual(parseArrivals({}), [])
  assert.deepEqual(parseArrivals(null), [])
})

test('서울 API 오류를 삼키지 않는다', () => {
  // 오류도 HTTP 200에 본문으로 온다. 빈 목록으로 넘기면 "도착 정보 없음"으로 둔갑한다.
  const quota = { status: 500, code: 'ERROR-337', message: '데이터요청은 일일 호출건수 최대 1000건을 넘을 수 없습니다. ', total: 0 }
  assert.throws(() => parsePositions(quota), (e: Error) => {
    assert.ok(e instanceof ApiError && e.code === 'ERROR-337')
    assert.ok(e.message.includes('1000건'), e.message)
    return true
  })
  assert.throws(() => parseArrivals(quota), ApiError)

  // INFO-200은 오류가 아니다. 그 역에 올 열차가 지금 없다는 뜻이다.
  assert.deepEqual(parseArrivals({ status: 500, code: 'INFO-200', message: '해당하는 데이터가 없습니다.' }), [])
  assert.deepEqual(parsePositions({ errorMessage: { code: 'INFO-000' } }), [])
  assert.deepEqual(parsePositions({}), [])
  assert.deepEqual(parseArrivals(null), [])
})

test('키 오류도 그대로 말한다', () => {
  assert.throws(() => parsePositions({ code: 'ERROR-338', message: '해당 인증키로는 실시간 서비스를 사용할 수 없습니다.' }),
    (e: Error) => e instanceof ApiError && e.message.includes('실시간'))
})

test('arrivals는 확인된 이름이면 빈 결과에 예비 이름을 다시 부르지 않는다', async () => {
  // 탭마다 3건씩 나가 하루 한도와 폭주 가드를 갉아먹던 동작이다.
  const { arrivals } = await import('./api.ts')
  const { hasArrivalName } = await import('./stations.ts')
  const calls: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url))
    return { ok: true, status: 200, json: async () => ({ realtimeArrivalList: [] }) }
  }) as unknown as typeof fetch
  try {
    assert.equal(hasArrivalName('하계'), true)
    await arrivals('하계')
    assert.equal(calls.length, 1, `확인된 역은 1번: ${calls.join(', ')}`)

    calls.length = 0
    assert.equal(hasArrivalName('아차산'), false)
    await arrivals('아차산')
    assert.ok(calls.length >= 2, `미확인 역은 예비 이름까지: ${calls.join(', ')}`)
    assert.ok(calls.some(c => c.includes(encodeURIComponent('아차산(어린이대공원후문)'))), calls.join(', '))
  } finally {
    globalThis.fetch = realFetch
  }
})

test('기기 로그는 모아서 보내고 분당 한도를 넘으면 버린 줄 수만 남긴다', async () => {
  const { batcher } = await import('./api.ts')
  const sent: string[] = []
  let t = 0
  const b = batcher(s => sent.push(s), { now: () => t, schedule: () => undefined, perMin: 200, maxChars: 100_000 })
  for (let i = 0; i < 500; i++) b.push(`line ${i}`)
  assert.equal(sent.length, 0, '10초가 지나기 전에는 보내지 않는다')
  b.flush()
  assert.equal(sent.length, 1)
  const lines = sent[0].split('\n')
  assert.equal(lines.filter(l => l.startsWith('line')).length, 200)
  assert.ok(lines.at(-1)!.includes('300줄 버림'), lines.at(-1))
  b.flush()
  assert.equal(sent.length, 1, '빈 버퍼는 보내지 않는다. 타이머가 두 번 불려도 한 번만 나간다')
  t = 60_000
  b.push('next')
  b.flush()
  assert.equal(sent.at(-1), 'next')
})

test('보내지 못한 로그 묶음은 되돌렸다가 다음에 보낸다', async () => {
  const { batcher } = await import('./api.ts')
  const sent: string[] = []
  let online = false
  const b = batcher(s => { sent.push(s); return Promise.resolve(online) }, { schedule: () => undefined, keepChars: 40 })
  b.push('터널 안 1'); b.flush()
  await Promise.resolve(); await Promise.resolve()
  b.push('터널 안 2')
  online = true
  b.flush()
  await Promise.resolve()
  assert.equal(sent.at(-1), '터널 안 1\n터널 안 2', '실패한 묶음이 앞에, 새 줄이 뒤에 온다')
  // 되돌린 것이 한도를 넘으면 오래된 것부터 버리고 버렸다고 남긴다
  online = false
  for (let i = 0; i < 5; i++) { b.push(`줄 ${i} ${'x'.repeat(10)}`); b.flush(); await Promise.resolve(); await Promise.resolve() }
  online = true
  b.flush(); await Promise.resolve()
  assert.ok(sent.at(-1)!.startsWith('(전송 실패로 로그'), sent.at(-1))
  assert.ok(!sent.at(-1)!.includes('줄 0'), '오래된 줄부터 버린다')
  assert.ok(sent.at(-1)!.includes('줄 4'), sent.at(-1))
})
