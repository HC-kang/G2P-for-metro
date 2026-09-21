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

// 역 목록과 실시간 API의 노선명이 다르다. 실측으로 만든 표다(2026-09-20).
// 실시간 API에 후보 이름을 직접 던져 200을 준 것만 넣었다. 추측하지 않았다.
const LINE_ALIAS = {
  경의선: '경의중앙선',        // id 1063
  우이신설경전철: '우이신설선', // id 1092
}

// 실시간 API가 지원하지 않는 노선. 인천·김포·용인·의정부 자체 노선이다.
// 서울시 TOPIS 데이터라서 없다. 이 구간은 열차를 추적할 수 없다.
const NO_REALTIME = ['김포도시철도', '용인경전철', '의정부경전철', '인천선', '인천2호선']

// "01호선" -> "1호선". 그 밖은 별칭 표를 거친다.
const apiLineName = raw => {
  const n = raw.replace(/^0?(\d+)호선$/, '$1호선')
  return LINE_ALIAS[n] ?? n
}

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
    if (NO_REALTIME.includes(name)) continue
    const url = `http://swopenapi.seoul.go.kr/api/subway/${RT_KEY}/json/realtimePosition/0/1/${encodeURIComponent(name)}`
    try {
      const row = (await json(url)).realtimePositionList?.[0]
      if (row) lines.push({ id: String(row.subwayId), name: String(row.subwayNm) })
      else console.warn(`운행 열차 없음 또는 이름 불일치, 건너뜀: ${name}`)
    } catch (e) {
      console.warn(`호출 실패, 건너뜀: ${name} (${e.message})`)
    }
  }
  // 막차 뒤에 돌리면 lines가 비어 버린다. 주요 노선이 빠지면 멈춘다.
  const must = ['1호선', '2호선', '3호선', '4호선', '5호선', '6호선', '7호선', '8호선', '9호선']
  const got = new Set(lines.map(l => l.name))
  const gone = must.filter(m => !got.has(m))
  if (gone.length) throw new Error(`주요 노선 ID가 빠졌습니다: ${gone.join(' ')}. 운행 시간대에 다시 돌리세요.`)
}

// 좌표: subwayStationMaster (BLDN_NM, ROUTE, LAT, LOT). 784개역.
// 같은 역 이름은 노선이 달라도 위치가 사실상 같다. 이름당 한 건만 둔다.
const geo = await json(`http://openapi.seoul.go.kr:8088/${KEY}/json/subwayStationMaster/1/1000/`)
const geoRows = geo.subwayStationMaster?.row
if (!geoRows) throw new Error(JSON.stringify(geo).slice(0, 300))

const coordMap = new Map()
for (const r of geoRows) {
  const name = String(r.BLDN_NM).replace(/\(.*\)$/, '')
  const lat = Number(r.LAT)
  const lon = Number(r.LOT)
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
  if (!coordMap.has(name)) coordMap.set(name, { name, lat, lon })
}
const coords = [...coordMap.values()]
const missing = [...new Set(stations.map(s => s.name))].filter(n => !coordMap.has(n))
console.log(`좌표 ${coords.length}건. 좌표 없는 역 ${missing.length}개: ${missing.join(' ')}`)
if (missing.length > 30) throw new Error('좌표 미매칭이 너무 많습니다. 이름 정규화를 확인하세요.')

// 도착 API는 역 이름을 자기 표기로만 받는다. 표기가 세 가지다(2026-09-21 실측).
//   그대로 되는 역            공릉 -> X, 강변 -> O
//   괄호 이름이 필요한 역      총신대입구(이수)
//   제3의 별칭을 쓰는 역       공릉 -> "공릉(서울산업대입구)" (역 목록도 좌표 데이터도 이 이름을 모른다)
// 정식 표기는 이웃 역 응답의 "…방면"에 들어 있다. 한 번 훑어 표를 만든다. 추측하지 않는다.
// 이미 아는 표기를 먼저 싣는다. 막차 뒤에 돌리면 도착 열차가 없어 대부분 실패하는데,
// 그때 표를 통째로 잃으면 안 된다. 실행할 때마다 아는 것이 늘기만 한다.
const arrivalNames = existsSync('src/stations.json')
  ? (JSON.parse(readFileSync('src/stations.json', 'utf8')).arrivalNames ?? {})
  : {}
const knownBefore = Object.keys(arrivalNames).length
if (RT_KEY) {
  const supported = new Set(lines.map(l => l.name))
  const targets = [...new Set(stations.filter(s => supported.has(s.line)).map(s => s.name))]
  const canonical = new Map()   // 괄호 뗀 이름 -> 도착 API 표기
  const failed = []

  const askArrival = async name => {
    const url = `http://swopenapi.seoul.go.kr/api/subway/${RT_KEY}/json/realtimeStationArrival/0/5/${encodeURIComponent(name)}`
    try { return (await json(url)).realtimeArrivalList ?? null } catch { return null }
  }
  const bare = n => n.replace(/\(.*?\)/g, '').trim()

  for (const name of targets) {
    if (arrivalNames[name]) continue   // 이미 아는 역은 다시 묻지 않는다
    const rows = await askArrival(name)
    if (rows?.length) {
      arrivalNames[name] = name
      // 이웃 역의 정식 표기를 주워 담는다
      for (const r of rows) {
        const m = /-\s*(.+?)방면/.exec(r.trainLineNm ?? '')
        if (m) canonical.set(bare(m[1]), m[1].trim())
      }
      for (const r of rows) if (r.statnNm) canonical.set(bare(r.statnNm), r.statnNm)
    } else {
      failed.push(name)
    }
  }
  // 실패한 역은 주워 담은 정식 표기로 다시 시도한다.
  // 이름이 통째로 바뀌는 경우가 있다: 이수 -> 총신대입구(이수), 응암 -> 응암순환(상선).
  // 가운뎃점과 마침표도 섞여 쓰인다: 4·19민주묘지 -> 4.19민주묘지.
  const norm = t => t.replace(/[·.‧]/g, '.').replace(/\s+/g, '')
  let rescued = 0
  for (const name of failed) {
    const tries = new Set()
    if (canonical.has(name)) tries.add(canonical.get(name))
    for (const [b, full] of canonical) {
      if (norm(b) === norm(name)) tries.add(full)
      else if (norm(full).includes(norm(name))) tries.add(full)
    }
    for (const alt of tries) {
      if (alt === name) continue
      if ((await askArrival(alt))?.length) { arrivalNames[name] = alt; rescued += 1; break }
    }
  }
  const known = Object.keys(arrivalNames).length
  const lost = targets.filter(n => !arrivalNames[n])
  console.log(`도착 API 표기: ${targets.length}개 중 ${known}개 확인 (이번에 새로 ${known - knownBefore}개, 별칭으로 살린 것 ${rescued}개)`)
  if (lost.length) console.log(`  미확인 ${lost.length}개:`, lost.join(' '))
  if (known < knownBefore) throw new Error('표가 줄었습니다. 덮어쓰지 않습니다.')
} else {
  console.warn('SEOUL_RT_KEY가 없어 도착 API 표기 표를 만들지 못했습니다.')
}

writeFileSync('src/stations.json', JSON.stringify({ lines, stations, coords, arrivalNames }))
console.log(`역 ${stations.length}개, 노선 이름 ${lineNames.length}개, 노선 ID ${lines.length}개를 저장했습니다.`)
