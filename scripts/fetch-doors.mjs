// 역별 승강장 형식(섬식·상대식)을 받아 src/doors.json으로 만든다. 내리실 문 방향은 이 형식과 노선의 통행 방향으로 정한다(route.doorSide).
// 출처 둘 다 공공데이터포털 파일 데이터이고 인증키가 필요 없다. 사용: node scripts/fetch-doors.mjs
//   국토교통부_철도역 승강장 정보(15130553): 역·상하행별. 서울교통공사 2호선과 코레일 노선이 없다.
//   서울교통공사_역사운영 현황(15044440): 1~8호선 역별. 2호선을 채운다.
// 두 출처가 모두 있는 역은 같을 때만 쓴다(2026-10 기준 195역 중 2역이 달랐다). 섬식·상대식이 아니면(복합식 등) 넣지 않는다.
import { readFileSync, writeFileSync } from 'node:fs'

const UA = { 'user-agent': 'Mozilla/5.0' }
async function download(id) {
  const page = await (await fetch(`https://www.data.go.kr/data/${id}/fileData.do`, { headers: UA })).text()
  const file = /fileDownload\.do\?atchFileId=(FILE_\d+)&fileDetailSn=(\d+)/.exec(page)
  const date = /_(\d{8})\s*\|/.exec(page)?.[1] ?? ''
  if (!file) throw new Error(`${id}: 내려받기 링크를 못 찾았다. 페이지 구조가 바뀌었다`)
  const res = await fetch(`https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${file[1]}&fileDetailSn=${file[2]}&insertDataPrcus=N`,
    { headers: { ...UA, referer: `https://www.data.go.kr/data/${id}/fileData.do` } })
  const text = new TextDecoder('euc-kr').decode(await res.arrayBuffer())
  if (!text.includes('역명')) throw new Error(`${id}: CSV가 아니다: ${text.slice(0, 80)}`)
  // 따옴표 안 쉼표가 없는 단순한 CSV다
  const [head, ...rows] = text.trim().split(/\r?\n/).map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()))
  return { date, rows: rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) }
}

// 국토교통부 자료의 (선명, 운영기관) → 앱 노선 이름. 여기 없는 노선은 버린다(지방 도시철도 등).
const MOLIT = {
  '1호선 KR': '1호선', '3호선 S1': '3호선', '4호선 S1': '4호선', '5호선 S1': '5호선', '6호선 S1': '6호선',
  '7호선 S1': '7호선', '7호선 IC': '7호선', '8호선 S1': '8호선', '8호선 GU': '8호선', '8호선 NU': '8호선', '9호선 S9': '9호선',
  'GTX-A GX': 'GTX-A', 'GTX-A SR': 'GTX-A', '공항철도 AR': '공항철도', '김포골드라인 GM': '김포도시철도', '서해 KR': '서해선', '서해 SW': '서해선',
  '신림선 SL': '신림선', '신분당선 DX': '신분당선', '용인에버라인 EV': '용인경전철', '우이신설 UI': '우이신설선',
  '의정부경전철 UL': '의정부경전철', '인천1호선 IC': '인천선', '인천2호선 IC': '인천2호선',
}
const code = (s) => s.replace(/^\d+\(|\)$/g, '')          // '1(섬식)' → '섬식'
const keys = (n) => {                                     // '총신대입구(이수)' → 총신대입구, 이수
  const out = [n.replace(/\(.*?\)/g, '').replace(/\s/g, '')]
  for (const m of n.matchAll(/\(([^)]+)\)/g)) out.push(m[1].replace(/\s/g, ''))
  return out
}

const molit = await download(15130553)
const seoul = await download(15044440)
const found = new Map()   // '노선|역' → Set(형식)
const add = (line, name, kind) => {
  for (const k of keys(name)) {
    const id = `${line}|${k}`
    if (!found.has(id)) found.set(id, new Set())
    found.get(id).add(kind)
  }
}
for (const r of molit.rows) {
  const line = MOLIT[`${r['선명']} ${r['철도운영기관코드'].slice(0, 2)}`]
  if (line) add(line, r['역명'], code(r['승강장유형코드']))
}
for (const r of seoul.rows) add(r['호선'], r['역명'], r['승강장유형'])

const data = JSON.parse(readFileSync(new URL('../src/stations.json', import.meta.url), 'utf8'))
const doors = {}
let n = 0
for (const s of data.stations) {
  const names = [s.name, ...(data.altNames[s.name] ? keys(data.altNames[s.name]) : [])].flatMap(keys)
  const kinds = new Set(names.flatMap(k => [...(found.get(`${s.line}|${k}`) ?? [])]))
  if (kinds.size !== 1) continue
  const [kind] = kinds
  if (kind !== '섬식' && kind !== '상대식') continue
  ;(doors[s.line] ??= {})[s.name] = kind
  n += 1
}
writeFileSync(new URL('../src/doors.json', import.meta.url),
  JSON.stringify({ source: ['15130553', '15044440'], updatedAt: [molit.date, seoul.date], doors }))
console.log(`doors.json: ${n}역 / 앱 ${data.stations.length}역 (기준일 ${molit.date}, ${seoul.date})`)
