import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// main.ts는 최상위에서 곧바로 함수를 부른다. 그 함수 본문이 아래쪽에서 선언되는
// const/let을 읽으면 초기화 도중 ReferenceError로 죽고, 화면은 반쯤만 살아난다.
// tsc는 함수 안에서 읽는 경우를 잡지 못한다. 실제로 겪었다(renderTrail이 QUOTA_DAY를 읽음).
export function useBeforeDeclare(src: string): string[] {
  const lines = src.split('\n')
  const declAt = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:const|let) ([A-Za-z_$][\w$]*)\b/.exec(lines[i])
    if (m && !declAt.has(m[1])) declAt.set(m[1], i + 1)
  }
  const bodyOf = (name: string): string => {
    const at = src.search(new RegExp(`^(?:async )?function ${name}\\b`, 'm'))
    if (at < 0) return ''
    let depth = 0, i = src.indexOf('{', at)
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1)
    }
    return ''
  }
  const bad: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const call = /^(?:await )?([A-Za-z_$][\w$]*)\(/.exec(lines[i])   // 들여쓰기 없는 최상위 호출만
    if (!call) continue
    const body = bodyOf(call[1])
    for (const [name, at] of declAt) {
      if (at > i + 1 && new RegExp(`\\b${name}\\b`).test(body)) {
        bad.push(`${i + 1}줄 ${call[1]}()가 ${at}줄에서 선언되는 ${name}을 읽습니다`)
      }
    }
  }
  return bad
}

test('main.ts는 아래에서 선언되는 변수를 최상위 호출에서 읽지 않는다', () => {
  const bad = useBeforeDeclare(readFileSync('src/main.ts', 'utf8'))
  assert.deepEqual(bad, [], bad.join('\n'))
})

test('검사가 실제 사고를 잡는다', () => {
  // 어제 겪은 모양 그대로: 함수 호출이 위, 그 함수가 읽는 const가 아래.
  const src = ['function show() { return QUOTA }', 'show()', 'const QUOTA = 1'].join('\n')
  const bad = useBeforeDeclare(src)
  assert.equal(bad.length, 1, bad.join('\n'))
  assert.ok(bad[0].includes('QUOTA'))
  // 순서가 맞으면 통과
  assert.deepEqual(useBeforeDeclare(['const QUOTA = 1', 'function show() { return QUOTA }', 'show()'].join('\n')), [])
})
