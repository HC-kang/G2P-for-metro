import test from 'node:test'
import assert from 'node:assert/strict'
import { closest, doubleTapAction, doubleTapHint, type DoubleTapState } from './controls.ts'

const base: DoubleTapState = { mode: 'origin', menuOpen: false, legIndex: 0, boarded: false, hasTrip: false, textPage: false, confirming: false, repick: false }
const at = (o: Partial<DoubleTapState>) => doubleTapAction({ ...base, ...o })

test('루트와 도착 화면의 더블탭은 종료다', () => {
  assert.equal(at({ mode: 'origin' }), 'exit')
  assert.equal(at({ mode: 'arrived', hasTrip: true, textPage: true }), 'exit')
})

test('목록은 한 단계 뒤로 간다', () => {
  assert.equal(at({ mode: 'dest' }), 'toOrigin')
  assert.equal(at({ mode: 'line', hasTrip: true }), 'toDest')
  assert.equal(at({ mode: 'pick', hasTrip: true, legIndex: 0 }), 'toRoute')
})

test('버린 여정이 새 여정의 열차 목록에서 되살아나지 않는다', () => {
  // 새 여정 B의 첫 구간 열차 목록. 주행 중 다시 고르기가 아니면 경로 선택으로 돌아간다(옛 여정 A가 아니다)
  assert.equal(at({ mode: 'pick', hasTrip: true, legIndex: 0, repick: false }), 'toRoute')
  // 주행 중 '못 탔으면 다음 열차'로 온 목록이면 원래 추적으로 돌아간다
  assert.equal(at({ mode: 'pick', hasTrip: true, legIndex: 0, boarded: true, repick: true }), 'backToRide')
})

test('여정이 있는 텍스트 화면은 한 번 더 묻고, 두 번째에 처음으로 간다', () => {
  assert.equal(at({ mode: 'riding', hasTrip: true, boarded: true, textPage: true }), 'confirm')
  assert.equal(at({ mode: 'riding', hasTrip: true, boarded: true, textPage: true, confirming: true }), 'home')
  assert.equal(at({ mode: 'transfer', hasTrip: true, textPage: true }), 'confirm')
  // 둘째 구간의 열차 목록·열차 없음 화면은 뒤로가 아니라 처음으로다(확인을 거친다)
  assert.equal(at({ mode: 'pick', hasTrip: true, legIndex: 1, textPage: true }), 'confirm')
})

test('메뉴가 열려 있으면 더블탭은 메뉴 닫기다', () => {
  assert.equal(at({ mode: 'riding', menuOpen: true, hasTrip: true }), 'closeMenu')
})

test('화면의 더블탭 안내는 실제 동작과 같다', () => {
  assert.equal(doubleTapHint({ ...base, mode: 'pick', hasTrip: true, legIndex: 0 }), '더블탭: 뒤로')
  assert.equal(doubleTapHint({ ...base, mode: 'pick', hasTrip: true, legIndex: 1, textPage: true }), '더블탭: 처음으로')
  assert.equal(doubleTapHint({ ...base, mode: 'pick', hasTrip: true, repick: true, boarded: true }), '더블탭: 계속 안내')
  assert.equal(doubleTapHint({ ...base, mode: 'arrived' }), '더블탭: 종료')
})

test('자동 다시 고르기는 원래 예정 시각에 가장 가까운 열차를 고른다', () => {
  const trains = [{ no: 'A', at: 60 }, { no: 'B', at: 200 }, { no: 'C', at: 420 }]
  assert.equal(closest(trains, t => t.at, 180).no, 'B')
  assert.equal(closest(trains, t => t.at, 0).no, 'A')
  assert.equal(closest(trains, t => t.at, 130).no, 'A')   // 같은 거리면 먼저 오는 열차
})
