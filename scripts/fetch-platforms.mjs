// 노선마다 좌표가 다른 역(환승역)의 좌표를 모두 받아 src/platforms.json으로 만든다. 사용: node scripts/fetch-platforms.mjs
// stations.json의 coords는 이름당 한 건이라 환승역에서는 한 노선의 좌표만 남는다(노원: 4호선 좌표, 7호선 승강장과 295m).
// '멀리서 고른 열차를 놓쳤나'(geo.missedAway)는 이 역의 어느 승강장에서든 가까우면 역 안으로 본다.
// 10-04 노원: 7호선 승강장(7호선 좌표 69m)에서 기다리던 사용자를 4호선 좌표 기준 336m로 보고 타던 열차를 버렸다.
import { readFileSync, writeFileSync } from 'node:fs'

const KEY = readFileSync('.env.local', 'utf8').match(/^SEOUL_KEY=(.+)$/m)?.[1].trim()
if (!KEY) throw new Error('.env.local에 SEOUL_KEY가 없습니다')
const rows = (await (await fetch(`http://openapi.seoul.go.kr:8088/${KEY}/json/subwayStationMaster/1/1000/`)).json()).subwayStationMaster?.row
if (!rows) throw new Error('subwayStationMaster 응답이 비었다')

const points = {}
for (const r of rows) {
  const name = String(r.BLDN_NM).replace(/\(.*\)$/, '')   // fetch-stations.mjs와 같은 이름 규칙
  const p = [Number(r.LAT), Number(r.LOT)]
  if (name && p.every(Number.isFinite)) (points[name] ??= []).push(p)
}
// 좌표가 하나뿐인 역은 stations.json의 coords로 충분하다
for (const n of Object.keys(points)) if (points[n].length < 2) delete points[n]
writeFileSync('src/platforms.json', JSON.stringify({ source: 'subwayStationMaster', points }))
console.log(`platforms.json: 좌표가 둘 이상인 역 ${Object.keys(points).length}곳`)
