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
