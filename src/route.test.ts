import test from 'node:test'
import assert from 'node:assert/strict'
import { plan, reaches, stopsLeft, alternatives } from './route.ts'

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

import { paceMs, locate, legEta, approachEta, travelMs, leftBefore, DEFAULT_PACE_MS, type Fix } from './route.ts'

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

// 09-30 실사용: 역에 이미 도착했는데 이전 역을 가리켰다. 피드는 '출발' 기록을 다음 역에 닿을 때까지 되풀이한다.
test('출발 기록은 되풀이돼도 떠난 시각부터 세어, 이 열차의 달리는 시간이 지나면 다음 역을 추정한다', () => {
  // A: 0초 도착, 60초 출발. B: 100초 도착(달린 시간 40초), 160초 출발. 폴링마다 'B 출발'을 다시 본다(seen 갱신)
  const f = [{ station: 'A', arr: 0, at: 60_000, seen: 60_000, status: 2 }, { station: 'B', arr: 100_000, at: 160_000, seen: 185_000, status: 2 }]
  assert.equal(travelMs(S, f), 40_000)
  assert.equal(paceMs(S, f), 100_000)   // 역에 닿은 시각끼리. 출발 시각을 섞으면 부풀었다
  // 떠난 지 30초: 아직 달리는 중
  assert.deepEqual(locate(S, f, 190_000), { index: 1, estimated: 0, stale: false })
  // 떠난 지 45초(> 40초): C에 닿았다고 추정. 피드가 아직 'B 출발'이어도
  assert.deepEqual(locate(S, f, 205_000), { index: 2, estimated: 1, stale: false })
  // 피드가 살아 있는 동안에는 한 역까지만 앞선다(열차가 터널에 서 있을 수 있다)
  const alive = [f[0], { ...f[1], seen: 390_000 }]
  assert.equal(locate(S, alive, 400_000)!.index, 2)
})

test('도착 기록이 되풀이되면(정차 중) 밀지 않는다', () => {
  const f = [{ station: 'A', arr: 0, at: 60_000, status: 2 }, { station: 'B', arr: 120_000, at: 120_000, seen: 175_000, status: 1 }]
  assert.deepEqual(locate(S, f, 185_000), { index: 1, estimated: 0, stale: false })
})

test('하차 예정은 출발 기록이면 다음 역까지 달리는 시간, 그 뒤는 역당 시간으로 센다', () => {
  const f = [{ station: 'A', arr: 0, at: 60_000, status: 2 }, { station: 'B', arr: 100_000, at: 160_000, status: 2 }]
  // F까지 4역 남음: 160 + 40(달림) + 3 × 100(역당)
  assert.equal(legEta(S, f, 170_000), 160_000 + 40_000 + 3 * 100_000)
})

// 09-30 퇴근 실기기 기록(0.5.3, 7호선 강남구청→하계): [역, 상태, 사건 시각, 앱이 처음 본 시각]
const RIDE_0930: [string, number, string, string][] = [
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
const RIDE_STOPS = ['강남구청', '청담', '자양', '건대입구', '어린이대공원', '군자', '중곡', '용마산', '사가정', '면목', '상봉', '중화', '먹골', '태릉입구', '공릉', '하계']
test('09-30 퇴근 기록을 재생하면 이전 역을 가리키는 시간이 17% 아래이고, 앞선 표시는 없다', () => {
  const T = (x: string) => { const [h, m, s] = x.split(':').map(Number); return ((h * 60 + m) * 60 + s) * 1000 }
  const ev = RIDE_0930.map(([station, status, at, seenAt]) => ({ station, status, at: T(at), seenAt: T(seenAt) }))
  // 실제 위치: 역에 닿은 때부터 떠날 때까지 그 역, 떠난 뒤 다음 역 전이면 +0.5
  const truth = (t: number) => { let i = 0, dep = false
    for (const e of ev) if (e.at <= t) { i = RIDE_STOPS.indexOf(e.station); dep = e.status === 2 }
    return dep ? i + 0.5 : i }
  const fixes: Fix[] = []
  let k = 0, behind = 0, ahead = 0, all = 0
  const t0 = ev[0].seenAt
  for (let t = t0; t < ev[ev.length - 1].at; t += 1000) {
    while (k < ev.length && ev[k].seenAt <= t) {
      const e = ev[k++], last = fixes[fixes.length - 1]
      if (!last || last.station !== e.station) fixes.push({ station: e.station, at: e.at, arr: e.at, seen: e.seenAt, status: e.status })
      else { last.status = e.status; last.at = e.at }
    }
    fixes[fixes.length - 1].seen = t - ((t - t0) % 15_500)   // 폴링마다 같은 기록을 다시 본다
    const d = locate(RIDE_STOPS, fixes, t)!.index, tr = truth(t)
    all++
    if (d < Math.floor(tr)) behind++
    if (d > Math.ceil(tr)) ahead++
  }
  assert.equal(ahead, 0, '열차보다 앞선 역을 가리켰다')
  assert.ok(behind / all < 0.17, `이전 역을 가리킨 시간 ${Math.round(behind / all * 100)}%(0.5.3은 26%)`)
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
