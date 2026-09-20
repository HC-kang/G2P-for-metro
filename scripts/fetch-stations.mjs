// 빌드 전에 한 번만 돌린다. 런타임에는 호출하지 않는다.
// 키가 두 개다(2026-09-20 실측).
//   SEOUL_KEY    - 열린데이터광장 일반 인증키. openapi.seoul.go.kr:8088 (역 목록)
//   SEOUL_RT_KEY - 실시간 지하철 API 전용 키. swopenapi.seoul.go.kr (노선 ID)
// 일반 키로 실시간을 부르면 ERROR-338이다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const env = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
const envVal = name => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1].trim()

const KEY = envVal('SEOUL_KEY')
const RT_KEY = envVal('SEOUL_RT_KEY')
if (!KEY) throw new Error('.env.local에 SEOUL_KEY가 없습니다')

const json = async url => {
  const body = await (await fetch(url)).text()
  try { return JSON.parse(body) } catch { throw new Error(body.slice(0, 200)) }
}

// "01호선" -> "1호선". 그 밖의 이름("경의선")은 그대로 둔다.
const apiLineName = raw => raw.replace(/^0?(\d+)호선$/, '$1호선')

// FR_CODE를 지선(branch)과 순서(order)로 쪼갠다.
//   "142"    -> branch ''      order 142  base null   (본선)
//   "P142"   -> branch 'P'     order 142  base null   (알파벳 분기: 경부선 등)
//   "211-1"  -> branch '211-'  order 1    base '211'  (성수지선 등, 211번 역에서 갈라진다)
const splitCode = fr => {
  const s = String(fr)
  const m = s.match(/^([A-Z]*)(\d+)-(\d+)$/)
  if (m) return { branch: `${m[1]}${m[2]}-`, order: Number(m[3]), base: `${m[1]}${m[2]}` }
  const p = s.match(/^([A-Z]*)(\d+)$/)
  if (!p) return null
  return { branch: p[1], order: Number(p[2]), base: null }
}

const master = await json(`http://openapi.seoul.go.kr:8088/${KEY}/json/SearchSTNBySubwayLineInfo/1/800/`)
const rows = master.SearchSTNBySubwayLineInfo?.row
if (!rows) throw new Error(JSON.stringify(master).slice(0, 300))

const stations = rows
  .map(r => {
    const code = splitCode(r.FR_CODE)
    if (!code) return null
    return {
      name: String(r.STATION_NM).replace(/\(.*\)$/, ''), // "공릉(서울산업대입구)" -> "공릉"
      line: apiLineName(String(r.LINE_NUM)),
      fr: String(r.FR_CODE),
      ...code,
    }
  })
  .filter(s => s && s.name)

stations.sort((a, b) => a.line.localeCompare(b.line, 'ko') || a.branch.localeCompare(b.branch) || a.order - b.order)

// line + branch + order는 유일해야 한다. 겹치면 순서표가 깨진다.
const seen = new Set()
for (const s of stations) {
  const k = `${s.line}|${s.branch}|${s.order}`
  if (seen.has(k)) throw new Error(`FR_CODE 중복: ${k} (${s.name})`)
  seen.add(k)
}

// 노선별 subwayId는 추측하지 않고 실시간 API 응답에서 직접 얻는다.
const lines = []
const lineNames = [...new Set(stations.map(s => s.line))]
if (!RT_KEY) {
  console.warn('SEOUL_RT_KEY가 없습니다. lines를 비운 채로 저장합니다. 실시간 키를 받은 뒤 다시 돌리세요.')
} else {
  for (const name of lineNames) {
    const url = `http://swopenapi.seoul.go.kr/api/subway/${RT_KEY}/json/realtimePosition/0/1/${encodeURIComponent(name)}`
    try {
      const row = (await json(url)).realtimePositionList?.[0]
      if (row) lines.push({ id: String(row.subwayId), name: String(row.subwayNm) })
      else console.warn(`운행 열차 없음 또는 이름 불일치, 건너뜀: ${name}`)
    } catch (e) {
      console.warn(`호출 실패, 건너뜀: ${name} (${e.message})`)
    }
  }
}

writeFileSync('src/stations.json', JSON.stringify({ lines, stations }))
console.log(`역 ${stations.length}개, 노선 이름 ${lineNames.length}개, 노선 ID ${lines.length}개를 저장했습니다.`)
