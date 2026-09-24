# Project context: Even G2 × 서울 지하철 플러그인 (metro)

참고 프로젝트: `../tiro` (같은 G2 플러그인). G2 SDK 제약과 실기기 검증 결과는
`../tiro/.agent/context.md`에 있다. 새 제약만 여기 적는다.

2026-09-24에 날짜순 기록(419줄)을 주제별 파일로 나눴다. 새 항목은 알맞은 파일 맨 아래에 붙인다.

| 파일 | 담는 것 |
|---|---|
| [constraints.md](constraints.md) | 서울 API 한도·표기·키, G2 화면 폭·줄·바이트, 안경 폰트 글리프, GPS 호스트 동작 |
| [decisions.md](decisions.md) | 사용자 교정과 설계 선택. UX 원칙은 여기서 찾는다 |
| [mistakes.md](mistakes.md) | 실수와 원인. HMR 루프, TDZ, 조회 폭주, 세션 파괴, 검수에서 찾은 결함 |
| [patterns.md](patterns.md) | 경로 탐색, 로그 수집, 시뮬레이터 검증 절차 |

## 먼저 알아야 할 것

- **앱이 할 수 있는 일은 앱이 한다.** "직접 고르세요/…하세요/탭: 다시 시도"를 쓰기 전에 자동화 여지를 찾는다. 요청은 막다른 길에서만. (decisions.md)
- **기다리는 화면에는 반드시 스피너.** `S.loading()`. 탭 처리 중에도 돌아야 한다. (decisions.md)
- **모든 화면에 `현재시각 HH:MM:SS`.** 목록 화면은 머리줄 컨테이너로 붙인다. (decisions.md)
- **안경 폰트에 없는 글리프는 조용히 빠진다.** 확인된 것만 쓴다. 새 글리프는 폰의 '글리프 시험' 버튼으로 먼저 확인한다. (constraints.md)
- **화면 한도:** 32칸, 10줄, 페이지 950바이트, 목록 항목 62바이트. `screen()`이 접고 빈 줄을 양보한다. 모든 역 이름 전수 테스트가 지킨다. (constraints.md)
- **서울 실시간 API는 하루 1000건.** 요청마다 `guard()`가 센다. (constraints.md)
- **검증은 시뮬레이터에서 내가 한다.** 입력 동작 이름은 `click`/`double_click`/`up`/`down`이다. (patterns.md)
