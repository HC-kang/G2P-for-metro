import test from 'node:test'
import assert from 'node:assert/strict'
import { plan, reaches, stopsLeft, alternatives, routeChoices, type Plan } from './route.ts'

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

import { paceMs, locate, legEta, approachEta, travelMs, leftBefore, etaFromPosition, DEFAULT_PACE_MS, type Fix } from './route.ts'

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

test('locate는 조회가 끊기면 사건 시각부터 정차·달리는 시간·역당 시간으로 위치를 민다', () => {
  // A에 0초, B에 100초에 섰다(역당 100초). 그 뒤 조회가 끊겼다. 정차 50초(기본) 뒤 떠나 30초 뒤 C에 들어선다(180초)
  const f = [{ station: 'A', at: 0, status: 1 }, { station: 'B', at: 100_000, status: 1 }]
  assert.deepEqual(locate(S, f, 170_000), { index: 1, estimated: 0, stale: false })
  assert.deepEqual(locate(S, f, 185_000), { index: 2, estimated: 1, stale: false })
  // 그 뒤로는 역당 100초씩: D는 280초
  assert.deepEqual(locate(S, f, 285_000), { index: 3, estimated: 2, stale: true })
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

test('피드가 늦는 만큼 앞서 세되, 한참 지나도 다음 역이 안 보이면 서 있는 열차로 본다', async () => {
  const { locate, legEta } = await import('./route.ts')
  // A를 0초에 떠나 B에 90초에 섰다(달린 시간 90초, 역당 90초). 피드는 계속 'B 도착'만 보인다. 지연은 40초로 잰다.
  const at = (now: number) => [{ station: 'A', at: 0, status: 2 }, { station: 'B', at: 90_000, seen: now - 5_000, status: 1 }]
  // 정차 50초(기본) 뒤 140초에 떠나, 달리는 90초에서 15초를 뺀 75초 뒤(215초)에 C에 들어선다. 그 전에는 B
  assert.deepEqual(locate(S, at(200_000), 200_000, 40_000), { index: 1, estimated: 0, stale: false })
  // 215초가 지나면 C에 닿았다고 본다. 피드에는 아직 안 보일 때다(늦으니까)
  assert.deepEqual(locate(S, at(220_000), 220_000, 40_000), { index: 2, estimated: 1, stale: false })
  // 다음 역 기록이 보였어야 할 때를 넉넉히(110초) 넘겨도 'B 도착'뿐이다. 열차가 서 있는 것이다. 밀지 않는다
  assert.deepEqual(locate(S, at(340_000), 340_000, 40_000), { index: 1, estimated: 0, stale: false })
  // 제때 가는 동안의 도착 예정은 사건 시각에 고정되고, 서 있는 동안에는 늦어진다
  assert.equal(legEta(S, at(220_000), 220_000, 40_000), 215_000 + 3 * 90_000)
  assert.equal(legEta(S, at(340_000), 340_000, 40_000), 300_000 + 3 * 90_000)
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

// 09-30 실사용: 역에 이미 도착했는데 이전 역을 가리켰다. 피드는 '출발' 기록을 다음 역에 닿을 때까지 되풀이한다.
test('출발 기록은 되풀이돼도 떠난 시각부터 세어, 이 열차의 달리는 시간이 지나면 다음 역을 추정한다', () => {
  // A: 0초 도착, 60초 출발. B: 100초 도착(달린 시간 40초), 160초 출발. 폴링마다 'B 출발'을 다시 본다(seen 갱신)
  const f = [{ station: 'A', arr: 0, at: 60_000, seen: 60_000, status: 2 }, { station: 'B', arr: 100_000, at: 160_000, seen: 185_000, status: 2 }]
  assert.equal(travelMs(S, f), 40_000)
  assert.equal(paceMs(S, f), 100_000)   // 역에 닿은 시각끼리. 출발 시각을 섞으면 부풀었다
  // 떠난 지 20초: 아직 달리는 중
  assert.deepEqual(locate(S, f, 180_000), { index: 1, estimated: 0, stale: false })
  // 떠난 지 30초(달리는 40초에서 들어서는 15초를 뺀 25초 뒤): C에 들어섰다고 추정. 피드가 아직 'B 출발'이어도
  assert.deepEqual(locate(S, f, 190_000), { index: 2, estimated: 1, stale: false })
  // 피드가 살아 있는 동안에는 한 역까지만 앞선다(열차가 터널에 서 있을 수 있다)
  const alive = [f[0], { ...f[1], seen: 390_000 }]
  assert.equal(locate(S, alive, 400_000)!.index, 2)
})

test('하차 예정은 출발 기록이면 다음 역까지 달리는 시간, 그 뒤는 역당 시간으로 센다', () => {
  const f = [{ station: 'A', arr: 0, at: 60_000, status: 2 }, { station: 'B', arr: 100_000, at: 160_000, status: 2 }]
  // F까지 4역 남음: 160 + 25(다음 역에 들어서기까지) + 3 × 100(역당)
  assert.equal(legEta(S, f, 170_000), 160_000 + 25_000 + 3 * 100_000)
})

// 실기기 기록 재생. [역, 상태(0 진입·1 도착·2 출발), 사건 시각, 앱이 처음 본 시각]
// 화면이 가리킨 역과 실제 위치를 1초마다 견준다. 실제 위치는 사건 시각 기준(도착 기록이 없으면 진입+15초).
type Ev = [string, number, string, string]
function replay(stops: string[], rows: Ev[]): { behind: number; ahead: number } {
  const T = (x: string) => { const [h, m, s] = x.split(':').map(Number); return ((h * 60 + m) * 60 + s) * 1000 }
  const ev = rows.map(([station, status, at, seenAt]) => ({ station, status, at: T(at), seenAt: T(seenAt) }))
  const per = new Map<number, { stop: number; dep: number }>()
  for (const [i, st] of stops.entries()) {
    const es = ev.filter(e => e.station === st)
    if (!es.length) continue
    const a1 = es.find(e => e.status === 1), a0 = es.find(e => e.status === 0), d = es.find(e => e.status === 2)
    const stop = a1 ? a1.at : a0 ? a0.at + 15_000 : d!.at - 60_000
    per.set(i, { stop, dep: d ? d.at : stop + 60_000 })
  }
  const truth = (t: number) => { let v = -1; for (const [i, p] of per) if (t >= p.stop) v = t <= p.dep ? i : i + 0.5; return v }
  const fixes: Fix[] = []
  let lags: number[] = [], k = 0, behind = 0, ahead = 0, all = 0, aheadOf = ''
  const t0 = ev[0].seenAt
  for (let t = t0; t < ev[ev.length - 1].at; t += 1000) {
    while (k < ev.length && ev[k].seenAt <= t) {   // main.ts poll과 같은 기록 방식
      const e = ev[k++], last = fixes[fixes.length - 1]
      if (last) lags = [...lags.slice(-4), e.seenAt - e.at]
      if (!last || last.station !== e.station) fixes.push({ station: e.station, at: e.at, arr: e.at, first: e.status, stop: e.status === 1 ? e.at : undefined, seen: e.seenAt, status: e.status })
      else { last.status = e.status; last.at = e.at; if (e.status === 1) last.stop = e.at }
    }
    const last = fixes[fixes.length - 1]
    last.seen = t - ((t - t0) % 15_500)   // 폴링마다 같은 기록을 다시 본다
    const lag = lags.length ? Math.min(180_000, Math.max(10_000, [...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)])) : 40_000
    let g = locate(stops, fixes, t, lag)!
    if (g.estimated > 0) aheadOf = last.station   // main.ts renderNow와 같은 규칙
    else if (aheadOf === last.station && last.status === 2 && g.index < stops.length - 2) g = { ...g, index: g.index + 1, estimated: 1 }
    const tr = truth(t)
    if (tr < 0) continue
    all++
    if (g.index < Math.floor(tr)) behind++
    if (g.index > Math.ceil(tr)) ahead++
  }
  return { behind: behind / all, ahead: ahead / all }
}

// 09-30 퇴근(0.5.3, 7호선 강남구청→하계). 피드 지연 16~59초. 0.5.4까지는 이전 역을 가리킨 시간이 9%였다.
const RIDE_0930: Ev[] = [
  ['강남구청', 1, '18:19:07', '18:20:18'],
  ['강남구청', 2, '18:20:30', '18:20:48'],
  ['청담', 1, '18:21:38', '18:22:22'],
  ['청담', 2, '18:22:58', '18:23:56'],
  ['자양', 0, '18:24:28', '18:24:44'],
  ['자양', 1, '18:24:47', '18:25:32'],
  ['자양', 2, '18:26:02', '18:27:07'],
  ['건대입구', 1, '18:27:09', '18:27:42'],
  ['건대입구', 2, '18:28:43', '18:29:18'],
  ['어린이대공원', 0, '18:29:07', '18:29:35'],
  ['어린이대공원', 1, '18:29:22', '18:30:22'],
  ['어린이대공원', 2, '18:30:33', '18:31:12'],
  ['군자', 0, '18:31:08', '18:31:44'],
  ['군자', 1, '18:31:26', '18:32:16'],
  ['군자', 2, '18:32:57', '18:33:35'],
  ['중곡', 1, '18:33:52', '18:34:38'],
  ['중곡', 2, '18:34:56', '18:35:42'],
  ['용마산', 1, '18:35:43', '18:36:29'],
  ['용마산', 2, '18:36:51', '18:37:17'],
  ['사가정', 0, '18:37:21', '18:38:20'],
  ['사가정', 1, '18:37:36', '18:38:35'],
  ['사가정', 2, '18:38:43', '18:39:39'],
  ['면목', 1, '18:39:26', '18:40:10'],
  ['상봉', 0, '18:40:59', '18:41:44'],
  ['상봉', 1, '18:41:15', '18:42:16'],
  ['상봉', 2, '18:42:31', '18:42:47'],
  ['중화', 0, '18:43:21', '18:43:51'],
  ['중화', 1, '18:43:44', '18:44:22'],
  ['중화', 2, '18:44:45', '18:45:25'],
  ['먹골', 0, '18:45:17', '18:45:57'],
  ['먹골', 1, '18:45:34', '18:46:13'],
  ['태릉입구', 0, '18:46:57', '18:47:31'],
  ['태릉입구', 1, '18:47:20', '18:48:02'],
  ['공릉', 0, '18:49:02', '18:49:37'],
  ['공릉', 1, '18:49:16', '18:49:54'],
  ['공릉', 2, '18:50:21', '18:50:59'],
  ['하계', 1, '18:51:27', '18:52:01'],
]
test('09-30 퇴근 기록 재생: 이전 역을 가리키는 시간 5% 아래, 앞선 표시 1% 아래', () => {
  const r = replay(['강남구청', '청담', '자양', '건대입구', '어린이대공원', '군자', '중곡', '용마산', '사가정', '면목', '상봉', '중화', '먹골', '태릉입구', '공릉', '하계'], RIDE_0930)
  assert.ok(r.behind < 0.05, `이전 역 표시 ${Math.round(r.behind * 100)}%`)
  assert.ok(r.ahead < 0.01, `앞선 표시 ${Math.round(r.ahead * 100)}%`)
})

// 10-01 출근(0.5.4, 6호선 태릉입구→신당 방향 6074). 피드 지연 65~98초. 0.5.4는 이전 역을 가리킨 시간이 53%였다.
const RIDE_1001: Ev[] = [
  ['석계', 1, '08:05:59', '08:08:11'],
  ['돌곶이', 1, '08:07:49', '08:08:26'],
  ['돌곶이', 2, '08:09:01', '08:09:44'],
  ['상월곡', 1, '08:09:43', '08:11:17'],
  ['월곡', 1, '08:11:29', '08:13:04'],
  ['월곡', 2, '08:12:33', '08:13:49'],
  ['고려대', 2, '08:14:42', '08:15:20'],
  ['안암', 1, '08:15:27', '08:16:38'],
  ['보문', 1, '08:17:09', '08:18:25'],
  ['창신', 1, '08:18:48', '08:19:59'],
  ['동묘앞', 1, '08:20:38', '08:21:45'],
  ['신당', 1, '08:22:13', '08:23:31'],
  ['청구', 2, '08:25:12', '08:25:37'],
]
test('10-01 출근 기록 재생(피드가 1분 반 늦은 날): 이전 역을 가리키는 시간 3% 아래, 앞선 표시 1% 아래', () => {
  const r = replay(['태릉입구', '석계', '돌곶이', '상월곡', '월곡', '고려대', '안암', '보문', '창신', '동묘앞', '신당', '청구', '약수'], RIDE_1001)
  assert.ok(r.behind < 0.03, `이전 역 표시 ${Math.round(r.behind * 100)}%`)
  assert.ok(r.ahead < 0.01, `앞선 표시 ${Math.round(r.ahead * 100)}%`)
})

test('대기 화면 도착 예정은 앞 역의 상태로 보정한다(09-30 출근 실측)', () => {
  const t = (h: number, m: number, s: number) => ((h * 60 + m) * 60 + s) * 1000
  // 7131: 중계(하계 한 정거장 앞) 출발 09:20:25, 하계 도착 약 09:21:15(관측 09:21:45 - 피드 지연 약 30초)
  const eta = approachEta(t(9, 20, 25), 2, 1, false)
  assert.ok(Math.abs(eta - t(9, 21, 15)) <= 15_000, `출발 기준 ${(eta - t(9, 21, 15)) / 1000}초 어긋남`)
  // 같은 열차 중계 도착 09:19:25 기준으로도 비슷해야 한다(정차 약 60초)
  const eta1 = approachEta(t(9, 19, 25), 1, 1, false)
  assert.ok(Math.abs(eta1 - t(9, 21, 15)) <= 25_000, `도착 기준 ${(eta1 - t(9, 21, 15)) / 1000}초 어긋남`)
  // 출발역을 향한 전역출발(3)은 달리는 시간만 남았다
  assert.equal(approachEta(0, 3, 0, true), 60_000)
})

// 10-01 출근 실기록: 묵은 도착 정보 때문에 이미 떠난 열차를 태웠다. 세 번 모두 '이미 떠남'으로 판정해야 한다.
test('고르기 전에 이미 떠난 열차를 가려낸다(10-01 출근 실기록)', () => {
  const t = (x: string) => new Date(`2026-10-01T${x}`).getTime()
  const leg7 = ['하계', '공릉', '태릉입구', '먹골', '중화', '상봉']
  const leg6 = ['태릉입구', '석계', '돌곶이', '상월곡']
  // 7085: 08:02:18에 골랐는데 하계를 07:58:55에 떠났다
  assert.equal(leftBefore(leg7, { station: '하계', status: 2, at: t('07:58:55') }, t('08:02:18')), true)
  // 7087: 08:02:26에 골랐는데 08:02:14에 이미 다음 역 공릉에 도착해 있었다
  assert.equal(leftBefore(leg7, { station: '공릉', status: 1, at: t('08:02:14') }, t('08:02:26')), true)
  // 6074: 08:08:10에 골랐는데 08:05:59에 이미 석계에 있었다
  assert.equal(leftBefore(leg6, { station: '석계', status: 1, at: t('08:05:59') }, t('08:08:10')), true)
  // 09-30 퇴근 7276: 18:20:17에 골랐고 18:19:07부터 강남구청에 서 있었다. 탈 수 있는 열차다
  assert.equal(leftBefore(['강남구청', '청담'], { station: '강남구청', status: 1, at: t('18:19:07') }, t('18:20:17')), false)
  // 타자마자 고른 경우(떠난 지 30초): 타고 있을 수 있으니 바꾸지 않는다
  assert.equal(leftBefore(leg7, { station: '하계', status: 2, at: t('08:00:00') }, t('08:00:30')), false)
  // 고른 뒤에 떠난 열차는 당연히 그대로
  assert.equal(leftBefore(leg7, { station: '공릉', status: 0, at: t('08:05:00') }, t('08:02:00')), false)
})

test('환승역이 다른 길도 선택지로 찾는다(10-01: 사용자의 실제 경로가 없었다)', () => {
  const alts = alternatives('하계', '홍대입구')
  const shape = (p: { legs: { line: string; stops: string[] }[] }) => p.legs.map(l => `${l.line} ${l.stops[0]}→${l.stops[l.stops.length - 1]}`).join(' / ')
  const all = alts.map(shape)
  // 사용자가 실제로 탄 길
  assert.ok(all.includes('7호선 하계→태릉입구 / 6호선 태릉입구→신당 / 2호선 신당→홍대입구'), all.slice(0, 12).join('\n'))
  // 전에 내놓던 길도 그대로 있다
  assert.ok(all.includes('7호선 하계→상봉 / 경의중앙선 상봉→왕십리 / 2호선 왕십리→홍대입구'))
  // 직통이 있으면 직통도 나온다
  assert.ok(alternatives('하계', '청담').map(shape).includes('7호선 하계→청담'))
  // 모든 구간은 두 역 이상이고 이어져 있다
  for (const p of alts) for (let i = 1; i < p.legs.length; i++) assert.ok(p.legs[i].stops.length > 1 && p.legs[i - 1].stops.length > 1)
})

test('선택지: 빠른 순 여섯 개 안에 사용자의 실제 경로가 들어가고, 지난번에 고른 길은 맨 위다', () => {
  const key = (p: Plan) => p.legs.map(l => `${l.line}:${l.stops.length}`).join('/')
  const minutes = (p: Plan) => p.legs.reduce((n, l) => n + l.stops.length - 1, 0) * 2 + (p.legs.length - 1) * 4
  const shape = (p: Plan) => p.legs.map(l => `${l.line} ${l.stops[0]}→${l.stops[l.stops.length - 1]}`).join(' / ')
  const mine = '7호선 하계→태릉입구 / 6호선 태릉입구→신당 / 2호선 신당→홍대입구'
  const opts = routeChoices('하계', '홍대입구', { key, minutes })
  assert.equal(opts.length, 6)
  assert.ok(opts.map(shape).includes(mine), opts.map(shape).join('\n'))
  assert.deepEqual(opts.map(minutes), [...opts.map(minutes)].sort((a, b) => a - b), '빠른 순')
  // 한 번 고르면 다음부터 맨 위
  const liked = key(opts.find(p => shape(p) === mine)!)
  assert.equal(shape(routeChoices('하계', '홍대입구', { key, minutes, liked })[0]), mine)
  // 직통이 있으면 환승 2번짜리 대안을 늘어놓지 않는다
  assert.ok(routeChoices('신당', '홍대입구', { key, minutes }).every(p => p.legs.length <= 2))
  assert.equal(routeChoices('하계', '청담', { key, minutes }).length, 1)
})

// 10-02 실기록: 도착 API는 6098을 '228초 뒤'라고 했는데, 위치 피드는 태릉입구로 접근 중(전역출발 09:05:33)이었고 09:06:13에 도착했다.
test('후보 열차의 남은 시간은 위치 피드로 센다(10-02 태릉입구 6098)', () => {
  const t = (x: string) => new Date(`2026-10-02T${x}`).getTime()
  const leg6 = ['태릉입구', '석계', '돌곶이', '상월곡']
  // 고른 시각 09:06:18. 출발역으로 접근 중(3): 떠난 지 45초, 약 15초 남았다
  assert.equal(etaFromPosition('6호선', leg6, { station: '태릉입구', status: 3, at: t('09:05:33') }, t('09:06:18')), 15)
  // 승강장에 서 있다: 곧
  assert.equal(etaFromPosition('6호선', leg6, { station: '태릉입구', status: 1, at: t('09:06:13') }, t('09:06:40')), 0)
  // 서 있은 지 2분이 넘은 기록은 떠난 것으로 본다. 출발 기록과 다음 역 기록도 떠난 것이다
  assert.equal(etaFromPosition('6호선', leg6, { station: '태릉입구', status: 1, at: t('09:03:00') }, t('09:06:18')), 'gone')
  assert.equal(etaFromPosition('6호선', leg6, { station: '태릉입구', status: 2, at: t('09:06:00') }, t('09:06:18')), 'gone')
  assert.equal(etaFromPosition('6호선', leg6, { station: '석계', status: 0, at: t('09:06:00') }, t('09:06:18')), 'gone')
  // 두 정거장 앞(봉화산)에 서 있다: 역당 110초씩
  assert.equal(etaFromPosition('6호선', leg6, { station: '봉화산', status: 1, at: t('09:06:00') }, t('09:06:18')), 220 - 18)
  // 공항철도 공덕→홍대입구: 서울역을 떠난 열차는 한 정거장 앞. 약 60초
  assert.equal(etaFromPosition('공항철도', ['공덕', '홍대입구'], { station: '서울역', status: 2, at: t('09:44:00') }, t('09:44:20')), 40)
  // 모르는 역이면 판단하지 않는다(도착 API 값을 쓴다)
  assert.equal(etaFromPosition('6호선', leg6, { station: '없는역', status: 1, at: t('09:06:00') }, t('09:06:18')), null)
})
