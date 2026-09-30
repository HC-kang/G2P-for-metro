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

// 주행 중 위치가 지금 역의 다음 역을 가리키는가(피드보다 먼저 한 칸 옮길지). 조건을 엄격히 둔다.
// 20초 안의 측위, 오차 80m 이하, 다음 역 200m 안이고 지금 역보다 가까움, 지금 역에 닿은 지 40초 넘음(정차 중 흔들림 방지).
export type RideFix = { lat: number; lon: number; accM?: number; ageMs: number }
export function pointsToNext(f: RideFix, cur: { lat: number; lon: number }, next: { lat: number; lon: number }, sinceArriveMs: number): boolean {
  if (f.ageMs > 20_000 || (f.accM ?? Infinity) > 80 || sinceArriveMs < 40_000) return false
  const dn = distanceM(f.lat, f.lon, next.lat, next.lon)
  return dn <= 200 && dn < distanceM(f.lat, f.lon, cur.lat, cur.lon)
}
