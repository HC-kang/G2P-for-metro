// 안경 더블탭이 무엇을 하는지. 상태만 보고 정한다(순수 함수라 시험할 수 있다).
// 리뷰 2라운드: 버린 여정이 새 여정의 열차 목록에서 더블탭하면 되살아났다. 상태 기계에 시험이 없어서 못 잡았다.

export type DoubleTapState = {
  mode: 'origin' | 'dest' | 'line' | 'pick' | 'riding' | 'transfer' | 'arrived'
  menuOpen: boolean
  legIndex: number
  boarded: boolean       // 이 구간의 열차를 이미 골랐다
  hasTrip: boolean
  textPage: boolean      // 확인 문구를 띄울 수 있는 텍스트 화면
  confirming: boolean    // 방금 한 번 더블탭해 확인을 기다리는 중
  repick: boolean        // 주행 중에 열차를 다시 고르러 온 목록
}

export type DoubleTapAction = 'exit' | 'closeMenu' | 'toOrigin' | 'toDest' | 'toRoute' | 'backToRide' | 'confirm' | 'home'

export function doubleTapAction(s: DoubleTapState): DoubleTapAction {
  if (s.mode === 'origin' || s.mode === 'arrived') return 'exit'   // 루트 화면의 더블탭은 종료(플랫폼 규칙)
  if (s.menuOpen) return 'closeMenu'
  if (s.mode === 'dest') return 'toOrigin'
  if (s.mode === 'line') return 'toDest'
  if (s.mode === 'pick' && s.repick) return 'backToRide'
  if (s.mode === 'pick' && s.legIndex === 0 && !s.boarded) return 'toRoute'
  if (s.hasTrip && s.textPage && !s.confirming) return 'confirm'
  return 'home'
}

// 화면에 적는 더블탭 안내. 실제 동작과 같은 말이어야 한다(리뷰 2라운드: 둘째 구간의 '더블탭: 뒤로'가 거짓이었다).
export function doubleTapHint(s: DoubleTapState): string {
  const a = doubleTapAction({ ...s, confirming: false })
  return a === 'exit' ? '더블탭: 종료'
    : a === 'backToRide' ? '더블탭: 계속 안내'
    : a === 'toRoute' || a === 'toDest' || a === 'toOrigin' ? '더블탭: 뒤로'
    : '더블탭: 처음으로'
}
