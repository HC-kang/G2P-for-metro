// 서울교통공사 노선 색. 폰 설정 화면의 배지에 쓴다.
// G2는 4비트 녹색이라 색을 쓸 수 없다. 이 표는 폰 화면 전용이다.
const LINES: Record<string, { short: string; color: string }> = {
  '1호선': { short: '1', color: '#0052A4' },
  '2호선': { short: '2', color: '#00A84D' },
  '3호선': { short: '3', color: '#EF7C1C' },
  '4호선': { short: '4', color: '#00A5DE' },
  '5호선': { short: '5', color: '#996CAC' },
  '6호선': { short: '6', color: '#CD7C2F' },
  '7호선': { short: '7', color: '#747F00' },
  '8호선': { short: '8', color: '#E6186C' },
  '9호선': { short: '9', color: '#BDB092' },
  신분당선: { short: '신분당', color: '#D4003B' },
  수인분당선: { short: '수인분당', color: '#FABE00' },
  경의중앙선: { short: '경의중앙', color: '#77C4A3' },
  공항철도: { short: '공항', color: '#0090D2' },
  경춘선: { short: '경춘', color: '#0C8E72' },
  경강선: { short: '경강', color: '#003DA5' },
  서해선: { short: '서해', color: '#8FC31F' },
  우이신설선: { short: '우이신설', color: '#B7C452' },
  신림선: { short: '신림', color: '#6789CA' },
  'GTX-A': { short: 'GTX-A', color: '#9A6292' },
}

export const lineShort = (line: string): string => LINES[line]?.short ?? line
export const lineColor = (line: string): string => LINES[line]?.color ?? '#8B9199'
