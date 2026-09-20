import test from 'node:test'
import assert from 'node:assert/strict'
import {
  node, neighbors, nodesOf, stationAt, lineStations, transferLines, lineName,
  supported, COORDS, TRANSFER_COST,
} from './stations.ts'

test('lineStations는 노선 역을 branch와 order 순으로 준다', () => {
  const two = lineStations('2호선')
  assert.ok(two.length > 40, `2호선 역이 ${two.length}개뿐입니다`)
  const main = two.filter(s => s.branch === '')
  for (let i = 1; i < main.length; i++) assert.ok(main[i].order > main[i - 1].order)
})

test('본선은 order가 이웃인 역끼리 이어진다', () => {
  const ns = neighbors(node('2호선', '강남')).map(e => e.to)
  assert.ok(ns.includes(node('2호선', '역삼')), ns.join(' '))
  assert.ok(ns.includes(node('2호선', '교대')), ns.join(' '))
})

test('순환선은 본선의 끝과 처음이 이어진다', () => {
  const main = lineStations('2호선').filter(s => s.branch === '')
  const first = main[0], last = main[main.length - 1]
  assert.ok(neighbors(node('2호선', last.name)).some(e => e.to === node('2호선', first.name)))
})

test('지선은 갈라지는 역에 붙는다', () => {
  // 성수지선 211-1 용답은 211 성수에 붙는다
  const ns = neighbors(node('2호선', '용답')).map(e => e.to)
  assert.ok(ns.includes(node('2호선', '성수')), ns.join(' '))
})

test('환승 간선은 같은 이름 다른 노선을 잇고 가중치가 다르다', () => {
  const e = neighbors(node('2호선', '교대')).find(x => x.to === node('3호선', '교대'))
  assert.ok(e, '2호선 교대와 3호선 교대가 이어져야 합니다')
  assert.equal(e.w, TRANSFER_COST)
  assert.ok(neighbors(node('2호선', '교대')).filter(x => x.w === 1).every(x => x.to.startsWith('2호선|')))
})

test('nodesOf와 stationAt', () => {
  assert.ok(nodesOf('강남').includes(node('2호선', '강남')))
  assert.deepEqual(nodesOf('없는역'), [])
  assert.equal(stationAt(node('2호선', '강남'))?.line, '2호선')
  assert.equal(stationAt('없는|노드'), undefined)
})

test('transferLines와 lineName', () => {
  assert.ok(transferLines('교대').includes('3호선'))
  assert.deepEqual(transferLines('없는역'), [])
  assert.equal(lineName('1002'), '2호선')
  assert.equal(lineName('1063'), '경의중앙선')
  assert.equal(lineName('9999'), '')
})

test('실시간 미지원 노선은 그래프에 없다', () => {
  assert.equal(supported('2호선'), true)
  assert.equal(supported('인천선'), false)
  assert.equal(lineStations('인천선').length, 0)
})

test('좌표가 있고 고립된 역이 없다', () => {
  // 추적 가능한 역 이름 566개 중 560개(99%)에 좌표가 있다. 나머지는 최근 개통역이다.
  assert.ok(COORDS.length > 500, `좌표 ${COORDS.length}건`)
  assert.ok(COORDS.some(c => c.name === '강남'))
  for (const line of ['1호선', '2호선', '3호선', '9호선']) {
    for (const s of lineStations(line)) {
      assert.ok(neighbors(node(line, s.name)).length > 0, `고립: ${line} ${s.name}`)
    }
  }
})
