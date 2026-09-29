# metro worker

서울 실시간 지하철 API 프록시다. 원 API가 http 전용이고 키를 클라이언트에 둘 수 없어서 필요하다.

## 경로

| 경로 | 상류 |
|---|---|
| `GET /position/{노선명}?train={열차번호}` | `realtimePosition/0/200/{노선명}` (train을 주면 그 열차만, 필요한 필드만) |
| `GET /arrival/{역명}` | `realtimeStationArrival/0/40/{역명}` |
| `POST /log` | 기기 로그를 D1 `logs`에 저장(개발 기간). `x-metro-kind: live|trail`, `x-metro-session` |

응답에는 오늘(KST) 서울 API를 실제로 부른 횟수가 `x-metro-used`로 붙는다. 캐시 적중은 세지 않는다. 950건이 되면 429로 막는다.

그 밖의 경로는 404다. 임의 URL을 중계하지 않는다.
모든 요청에 `x-metro-token` 헤더가 필요하다. 없거나 틀리면 403이다.

## 배포

```bash
cd worker
npx wrangler login
npx wrangler secret put SEOUL_RT_KEY   # 실시간 지하철 API 키
npx wrangler secret put METRO_TOKEN    # .env.local의 METRO_TOKEN 값
npx wrangler d1 create metro-logs      # 처음 한 번. 나온 database_id를 wrangler.toml [[d1_databases]]에 넣는다
npx wrangler d1 execute metro-logs --remote --file schema.sql   # 표(logs, usage). 빠뜨리면 하루 상한을 못 센다
npx wrangler deploy
```

배포 뒤 한도 집계가 도는지 확인한다. `x-metro-used: N`이 보여야 한다. 안 보이면 `usage` 표가 없는 것이다(폰 화면에 '서버 집계 없음').

```bash
curl -s -D - -o /dev/null -H "x-metro-token: $METRO_TOKEN" "https://metro.<계정>.workers.dev/position/7%ED%98%B8%EC%84%A0" | grep -i x-metro-used
```

하루 한 번 03:00 KST에 14일 지난 로그를 지우는 Cron Trigger가 같이 배포된다(`[triggers] crons`). 로그 읽기는 루트의 `scripts/logs.sh`.

배포된 주소를 프로젝트 루트의 `.env.local`에 `VITE_API_BASE`로 넣는다. 끝에 슬래시를 넣지 않는다.

## 한계

토큰은 앱 번들 안에 있으므로 꺼낼 수 있다. 우연한 남용을 막는 장치이지 인증이 아니다.
남용이 보이면 Cloudflare rate limit을 건다. 무료 한도는 하루 10만 요청이다.
