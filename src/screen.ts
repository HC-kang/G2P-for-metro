// G2 한도는 모두 UTF-8 바이트다(tiro 실기기 실측). 한글 1자는 3바이트다.
export const PAGE_BYTES = 950
export const ITEM_BYTES = 62

const enc = new TextEncoder()
export const bytes = (s: string): number => enc.encode(s).length

// 목록 항목은 62바이트, 페이지 전체는 950바이트를 넘으면 하드웨어가 거부한다.
export function fitItems(items: string[]): string[] {
  for (let len = ITEM_BYTES; len > 1; len--) {
    const cut = items.map(i => i.slice(0, len))
    if (cut.every(i => bytes(i) <= ITEM_BYTES) && bytes(cut.join('')) <= PAGE_BYTES) return cut
  }
  return items.map(i => i.slice(0, 1))
}

// ● 지나온 역(관측), ◌ 지나온 역(추정), ○ 남은 역, ◉ 하차역
export function progressBar(len: number, index: number, estimated: number, cells = 12): string {
  const marks: string[] = []
  for (let i = 0; i < len; i++) {
    if (i === len - 1) marks.push('◉')
    else if (i > index) marks.push('○')
    else if (i > index - estimated) marks.push('◌')
    else marks.push('●')
  }
  if (marks.length <= cells) return marks.join('━')
  // 하차역 쪽이 중요하다. 앞을 줄인다.
  return '⋯' + marks.slice(marks.length - (cells - 1)).join('━')
}

const mins = (ms: number, stops: number) => Math.max(1, Math.round((ms * stops) / 60_000))
// 넓은 자간으로 강조한다. G2는 폰트 크기를 바꿀 수 없다.
const wide = (s: string) => [...s].join(' ')

export type Boxes = { top: string; mid: string; bottom: string }

export function ridingBoxes(a: {
  next: string; stopsLeft: number; paceMs: number; dest: string
  pathLen: number; index: number; estimated: number
  transfer?: { station: string; line: string; stopsAway: number }
}): Boxes {
  return {
    top: `\n  다음      ${wide(a.next)}\n`,
    mid: `  하차까지  ${a.stopsLeft} 정거장 · 약 ${mins(a.paceMs, a.stopsLeft)}분\n  ${progressBar(a.pathLen, a.index, a.estimated)} ${a.dest}`,
    bottom: a.transfer
      ? `  ${a.transfer.station}에서 ${a.transfer.line} 갈아탐 (${a.transfer.stopsAway}정거장 뒤)`
      : `  ${a.dest}까지 갑니다`,
  }
}

export function alertScreen(a: { stopsLeft: number; next: string; dest: string; minutes: number }): string {
  const head = a.stopsLeft <= 1 ? wide('다음에 내립니다') : wide('다음다음에 내립니다')
  return `\n\n     ${head}\n\n        ${wide(a.dest)}\n\n     ${a.next} → ${a.dest} · 약 ${a.minutes}분\n`
}

export function transferScreen(a: { station: string; from: string; to: string; toward: string }): string {
  return `\n\n     ${wide(a.station + '에서 갈아탑니다')}\n\n     ${a.from}  →  ${a.to}\n     방면: ${a.toward}\n\n     탭하면 다음 열차를 고릅니다`
}

export function lostScreen(a: { last: string; agoSec: number; guess: string; stopsLeft: number; bar: string }): string {
  return `  신호 끊김\n  마지막 확인: ${a.last} (${a.agoSec}초 전)\n\n  추정      ${a.guess} 부근 · 하차까지 ${a.stopsLeft} 정거장\n  ${a.bar}\n\n  탭: 열차 다시 고르기`
}

// 경로를 계산한 직후 보여준다. 탭이 필요 없다. 곧 열차 목록으로 넘어간다.
export function planScreen(a: { from: string; to: string; legs: { line: string; stops: string[] }[] }): string {
  const body = a.legs
    .map((l, i) => {
      const ride = `     ${l.line} ${l.stops.length - 1}정거장`
      return i === 0 ? ride : `     ▶ ${l.stops[0]} 환승\n${ride}`
    })
    .join('\n')
  return `\n     ${a.from} → ${a.to}\n\n${body}\n\n     열차를 확인하는 중...`
}
