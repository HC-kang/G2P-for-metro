// 개발 모드 ?host=ios: 폰을 잠갔을 때 Even 호스트와 iOS가 하는 일을 시뮬레이터 안에서 흉내 낸다.
// 시뮬레이터는 그림자 틱을 보내지 않고, 앞/뒤 전환도 없다. 그래서 여기서 만든다. 배포본은 타지 않는다.
//
//  1. 뒤에 있는 동안 WebView의 진짜 타이머는 멈춘다. 그 사이에 만기된 콜백은 붙잡아 두었다가
//     앞으로 돌아오는 순간 한꺼번에 부른다(iOS가 멈춘 타이머를 재개할 때와 같다).
//  2. 그동안 호스트는 1초마다 SDK의 window.__tickShadowTimers(경과ms)를 부른다. SDK의 실제 그림자 타이머 코드가 돈다.
//     "ticks": true면 앞에 있을 때도 틱을 보낸다. 실기기 로그(두 번째 폴링이 1초 안에 따라옴)는 이쪽과 맞는다.
//  3. document.visibilityState가 'hidden'이 되고 visibilitychange가 난다.
//
// SDK는 불러올 때 window.setTimeout 등을 붙잡아 '진짜 타이머'로 쓴다. 이 모듈이 그보다 먼저 실행되어야
// SDK가 멈출 수 있는 타이머를 붙잡는다. 그래서 main.ts의 첫 import다.
// 전환은 dev 서버의 /__host 피드(.dev/host.json {"background": true|false, "ticks": true|false})로 한다.
if (import.meta.env?.DEV && new URLSearchParams(location.search).get('host') === 'ios') {
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window)
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window)
  let bg = false
  let seq = 1
  const native = new Map<number, number>()
  const held = new Map<number, () => void>()
  const run = (id: number, fn: TimerHandler, a: unknown[], once: boolean) => () => {
    if (once) native.delete(id)
    const call = () => (fn as (...x: unknown[]) => void)(...a)
    if (bg) held.set(id, call)   // 멈춰 있다. 앞으로 돌아오면 부른다. 반복 타이머는 한 번만 밀린다.
    else call()
  }
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => {
    const id = seq++
    native.set(id, st(run(id, fn, a, true), ms))
    return id
  }) as typeof setTimeout
  window.setInterval = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => {
    const id = seq++
    native.set(id, si(run(id, fn, a, false), ms))
    return id
  }) as typeof setInterval
  const clear = (id?: number) => {
    if (id == null) return
    const n = native.get(id)
    if (n != null) { ct(n); ci(n) }
    native.delete(id)
    held.delete(id)
  }
  window.clearTimeout = clear as typeof clearTimeout
  window.clearInterval = clear as typeof clearInterval
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (bg ? 'hidden' : 'visible') })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => bg })

  // 호스트. 멈추지 않는 진짜 타이머로 돈다.
  let ticks = 0
  let always = false
  // 경과 시간은 실제로 잰다. 가려진 시뮬레이터 창에서는 macOS가 타이머를 늦춰 1초 틱이 2초 넘게 걸렸다.
  let lastTick = Date.now()
  si(async () => {
    try {
      const j = await (await fetch('/__host', { cache: 'no-store' })).json()
      always = !!j.ticks
      const next = !!j.background
      if (next !== bg) {
        bg = next
        console.log('[host] background', bg, 'held', held.size, 'ticks', ticks)
        navigator.sendBeacon('/__log', `[host] ${bg ? 'background' : 'foreground'} held ${held.size} ticks ${ticks}`)
        ticks = 0
        document.dispatchEvent(new Event('visibilitychange'))
        if (!bg) { const calls = [...held.values()]; held.clear(); calls.forEach(c => c()) }
      }
    } catch { /* 피드가 없으면 앞에 있는 것으로 둔다 */ }
    const now = Date.now(), elapsed = now - lastTick
    lastTick = now
    if (bg || always) { ticks++; (window as unknown as { __tickShadowTimers?: (ms: number) => void }).__tickShadowTimers?.(elapsed) }
  }, 1000)
}
