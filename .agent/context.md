# Project context: Even G2 × 서울 지하철 플러그인 (metro)

참고 프로젝트: `../tiro` (같은 G2 플러그인). G2 SDK 제약과 실기기 검증 결과는
`../tiro/.agent/context.md`에 있다. 새 제약만 여기 적는다.

## 2026-09-20 목표와 기준 (사용자 확인)

- 핵심 장면은 "탑승 중 동행"이다. 열차를 탄 뒤가 주전장이다. 남은 정거장, 환승 시점, 하차 시점을 안내한다.
- 입력 방식은 "폰에 경로 저장 → G2에서 선택"이다. 경로 탐색은 1차 범위 밖이다.
- 기존 앱의 불만 4가지를 모두 받았다: 조작이 번거롭다, 정보가 정적이다, 하차/환승을 못 챙긴다, 화면이 지저분하다.
- 사용자 원문: "텍스트로만 이루어져있는데, 단순 줄바꿈으로만 구분되어있어서 정보의 위계도 없고, '그냥 정보 나열해놨으니 니가 봐라'라는듯한 태도가 마음에 들지 않아"
- 따라서 합격 기준은 두 가지다. (1) 화면에 정보 위계가 있다. (2) 앱이 "지금 알아야 할 한 가지"를 먼저 말한다.

## 2026-09-20 서울 지하철 API 실측 (curl)

### 실시간 열차 위치 — `swopenapi.seoul.go.kr`
- `GET http://swopenapi.seoul.go.kr/api/subway/{KEY}/json/realtimePosition/0/{N}/{노선명}`
- 200 정상. `Access-Control-Allow-Origin: *`. preflight(OPTIONS)도 200이다. → WebView에서 직접 호출한다. 프록시가 필요 없다.
- **HTTPS는 응답하지 않는다(타임아웃).** http 전용이다. 이것이 최대 위험이다. 아래 "미검증" 참고.
- 응답 필드: `trainNo`(열차번호), `statnNm`(현재 역), `updnLine`(0=상행/외선, 1=하행/내선), `trainSttus`(0=진입, 1=도착, 2=출발), `statnTnm`(종착역), `directAt`(급행), `recptnDt`(초 단위 시각).
- 실측: 열차 `2301`이 약 1분 사이에 잠실새내 → 잠실로 이동했다. **`trainNo`로 특정 열차를 계속 추적할 수 있다.**
- 노선 커버리지 확인: 2호선 37대, 9호선 26대, 신분당선 12대, 수인분당선 32대, 경의중앙선 23대. 코레일·민자 노선도 나온다.

### 실시간 도착 정보 — 같은 도메인
- `GET .../json/realtimeStationArrival/0/{N}/{역명}`
- `btrainNo`(도착 예정 열차번호), `barvlDt`(도착까지 남은 초), `arvlMsg2`(예: "서울 출발"), `trainLineNm`(예: "광운대행 - 시청방면"), `btrainSttus`(일반/급행)를 준다.
- 용도: 승강장에서 탑승할 열차의 `trainNo`를 미리 잡는다.

### 역 목록 — `openapi.seoul.go.kr:8088`
- `GET http://openapi.seoul.go.kr:8088/{KEY}/json/SearchSTNBySubwayLineInfo/1/800/`
- 799개 역. 필드 `STATION_CD`, `STATION_NM`, `LINE_NUM`("01호선"), `FR_CODE`("P148", "151").
- `FR_CODE`의 숫자 부분이 노선 내 역 순서다. 환승역은 같은 `STATION_NM`이 여러 `LINE_NUM`에 나온다.
- CORS `*`. 역시 http 전용이다.
- **빌드 시점에 한 번 받아 정적 JSON으로 번들한다.** 런타임 의존을 만들지 않는다.
- `SearchSTNTimeByFRCodeService`(역간 소요시간)는 `ERROR-500`이다. 쓸 수 없다.

### API key
- `sample` key는 5건만 준다. 100건 요청은 `ERROR-336`으로 거부된다(오류 문구는 건수 한도를 말하지만 실제 원인은 sample 제한이다).
- 실제 key는 data.seoul.go.kr에서 무료로 발급한다. tiro와 같은 BYOK로 간다.

## 2026-09-20 미검증 (착수 전 확인 필요)

1. **`.ehpk` private build의 페이지 scheme.** 페이지가 https면 http API 호출이 mixed content로 차단된다. QR sideload(`http://<ip>:5173`)는 http라서 문제가 없다. 1차는 sideload로 만들고, 배포 시점에 https 프록시 필요 여부를 판단한다.
2. **G2 폰트 크기는 조절할 수 없다**(tiro 확인). 큰 글씨로 위계를 만들 수 없다. 여백, 정렬, 컨테이너 분할, 문자 그래픽으로 만들어야 한다. 이미지 컨테이너(288x144, 페이지당 4개) 렌더링은 마지막 수단이다.
3. 코레일 직결 구간(1·3·4호선, 경의중앙선 등)에서 `trainNo`가 중간에 바뀌는지 확인이 필요하다.
4. 지하 구간에서 폰 네트워크가 끊기는 빈도. polling 실패 시 동작을 정해야 한다.

## 2026-09-20 API key 조사

- `sample` 키의 한도는 `openapi.seoul.go.kr:8088`에서 **1~5번 항목 고정**이다. 오프셋을 옮겨도 `ERROR-335`다. 그래서 `stations.json`을 만들려면 실제 키가 필요하다. `swopenapi` 쪽 `sample` 한도도 5건이다.
- 데이터셋 이름 주의: "서울시 지하철역 정보"라는 이름은 열린데이터광장 목록에 없다. 서비스 이름 `SearchSTNBySubwayLineInfo`는 실재하고 799개역을 준다.
- "지하철역 최단경로이동정보 현황"은 역 구내 이동/환승 통로 정보다. 노선 내 역 순서가 아니다. 1차 범위에는 쓰지 않는다. 나중에 "빠른 환승 칸" 기능의 후보다.
- 미검증: 열린데이터광장 인증키 하나가 `openapi.seoul.go.kr:8088`과 `swopenapi.seoul.go.kr` 양쪽에 모두 통하는지. 키를 받는 즉시 두 도메인을 함께 시험한다.
- 대안: 8088이 거부하면 열린데이터광장의 CSV 파일 내려받기(`FILE` 표시 데이터셋)로 역 목록을 얻는다.
