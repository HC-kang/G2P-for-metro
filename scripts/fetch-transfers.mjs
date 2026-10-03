// 서울교통공사 '서울 도시철도 환승정보'(서울 열린데이터광장 OA-22521)를 받아 src/transfers.json으로 만든다.
// 환승역마다: 내릴 칸-문, 갈아탈 칸-문, 환승 소요시간. 인증키가 필요 없다. 사용: node scripts/fetch-transfers.mjs [로컬 CSV 경로]
// 원본 문제: '10:00'은 공항철도 환승에 일괄로 들어간 값이라 버린다. '모든 호차'는 위치가 없다는 뜻이다.
import { readFileSync, writeFileSync } from 'node:fs'

const PAGE = 'https://data.seoul.go.kr/dataList/OA-22521/F/1/datasetView.do'
const LINES = { 경의선: '경의중앙선', 우이신설경전철: '우이신설선' }
const lineName = (s) => (/^\d$/.test(s) ? `${s}호선` : LINES[s] ?? s)

async function download() {
  const page = await (await fetch(PAGE, { headers: { 'user-agent': 'Mozilla/5.0' } })).text()
  const infSeq = /name="infSeq" value="(\d+)"/.exec(page)?.[1]
  const name = /([^>"]*환승 데이터_(\d{8})\.csv)/.exec(page)
  if (!infSeq) throw new Error('infSeq를 못 찾았다. 페이지 구조가 바뀌었다')
  const res = await fetch('https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false', {
    method: 'POST',
    headers: { 'user-agent': 'Mozilla/5.0', referer: PAGE, 'content-type': 'application/x-www-form-urlencoded' },
    body: `infId=OA-22521&seq=1&infSeq=${infSeq}`,
  })
  return { buf: Buffer.from(await res.arrayBuffer()), date: name?.[2] ?? '' }
}

const { buf, date } = process.argv[2] ? { buf: readFileSync(process.argv[2]), date: '' } : await download()
const text = new TextDecoder('euc-kr').decode(buf)
if (!text.startsWith('"고유번호"')) throw new Error(`CSV가 아니다: ${text.slice(0, 80)}`)

// 따옴표 안 쉼표가 없는 단순한 CSV다
const rows = text.trim().split(/\r?\n/).slice(1).map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()))
const pos = (car, door) => (/^\d+$/.test(car) && /^\d+$/.test(door) ? `${car}-${door}` : null)
const sec = (t) => {
  const m = /^(\d+):(\d\d)$/.exec(t)
  if (!m || t === '10:00') return null
  return Number(m[1]) * 60 + Number(m[2])
}
const toward = (s) => s.replace(/\s*방면$/, '')
// [역, 타던 노선, 타던 열차 방면, 내릴 칸-문, 갈아탈 노선, 갈아탈 열차 방면, 탈 칸-문, 걷는 초]
const out = rows.map(r => [r[1], lineName(r[3]), toward(r[4]), pos(r[5], r[6]), lineName(r[9]), toward(r[10]), pos(r[11], r[12]), sec(r[13])])
  .filter(r => r[0] && r[1] && r[4] && (r[3] || r[6] || r[7]))
writeFileSync(new URL('../src/transfers.json', import.meta.url),
  JSON.stringify({ source: 'OA-22521', updatedAt: date, rows: out }))
console.log(`transfers.json: ${out.length}행 (원본 ${rows.length}행, 기준일 ${date || '로컬 파일'})`)
