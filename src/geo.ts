export type Near = { name: string; meters: number }

// accuracy가 이보다 나쁘면 GPS를 버리고 최근 출발역만 보여준다.
export const MAX_ACCURACY_M = 1000

const R = 6_371_000 // 지구 반지름 (m)
const rad = (d: number) => (d * Math.PI) / 180

// 하버사인. 몇 km 범위라 평면 근사로도 되지만, 짧고 경계에서 정확하다.
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

export function nearest(
  lat: number,
  lon: number,
  coords: readonly { name: string; lat: number; lon: number }[],
  n = 8,
): Near[] {
  const best = new Map<string, number>()
  for (const c of coords) {
    const m = distanceM(lat, lon, c.lat, c.lon)
    if (m < (best.get(c.name) ?? Infinity)) best.set(c.name, m)
  }
  return [...best]
    .map(([name, meters]) => ({ name, meters }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, n)
}


// 고른 열차가 출발역을 떠난 뒤에도 사용자가 역 밖(지상)에 있었는가. 멀리서 열차를 고르고 걸어가다 놓친 경우를 가린다
// (10-02 홍대입구 241m, 10-03 하계 295m: 역 밖에서 고르고 놓쳐, 손으로 다시 골랐다).
// departedAt은 앱이 출발을 안 시각이다(피드가 늦어 실제 출발보다 뒤다). 오차 80m 넘는 측위는 쓰지 않는다.
// 셋 다 맞아야 놓친 것이다. 하나라도 모자라면 판단하지 않는다(탔는데 버리는 것이 더 나쁘다):
//   1. 떠나기 전 마지막 측위가 역 밖이다(멀리서 골랐다). 승강장에서는 와이파이 측위로 역 65m 안이 나왔다(10-01 하계).
//   2. 떠난 뒤 2분 안의 측위도 역 밖이고, 타고 갈 다음 역들 300m 안이 아니다(지상 구간이면 열차 안일 수 있다).
//   3. 두 측위 사이를 걸어서 갈 수 있다. 열차 안 측위는 차량기지로 튀었다(10-01: 2.5km, 오차 67~91m).
// origin은 그 역의 승강장 좌표들이다(환승역은 노선마다 다르다). 가장 가까운 것으로 잰다.
// 10-04 노원: 이름당 좌표 하나(4호선)로 재서, 7호선 승강장에서 기다리던 사용자를 336m 밖으로 보고 타던 열차를 버렸다.
// 반환: 떠난 뒤 역까지 거리(m). 아니면 null.
export type WaitFix = { lat: number; lon: number; acc: number; t: number }
export function missedAway(fixes: WaitFix[], origin: { lat: number; lon: number }[], ahead: { lat: number; lon: number }[], departedAt: number): number | null {
  const good = fixes.filter(f => f.acc <= 80)
  const before = good.filter(f => f.t < departedAt).at(-1)
  const after = good.filter(f => f.t >= departedAt && f.t <= departedAt + 120_000).at(-1)
  if (!before || !after) return null
  const away = (f: WaitFix) => Math.min(...origin.map(o => distanceM(f.lat, f.lon, o.lat, o.lon)))
  const outside = (f: WaitFix) => away(f) >= Math.max(150, f.acc + 100)
  if (!outside(before) || !outside(after)) return null
  if (ahead.some(s => distanceM(after.lat, after.lon, s.lat, s.lon) < 300)) return null
  const walk = 2 * (after.t - before.t) / 1000 + 100 + before.acc + after.acc
  return distanceM(before.lat, before.lon, after.lat, after.lon) <= walk ? away(after) : null
}
