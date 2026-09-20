# metro worker

서울 실시간 지하철 API 프록시다. 원 API가 http 전용이고 키를 클라이언트에 둘 수 없어서 필요하다.

## 경로

| 경로 | 상류 |
|---|---|
| `GET /position/{노선명}` | `realtimePosition/0/200/{노선명}` |
| `GET /arrival/{역명}` | `realtimeStationArrival/0/40/{역명}` |

그 밖의 경로는 404다. 임의 URL을 중계하지 않는다.
모든 요청에 `x-metro-token` 헤더가 필요하다. 없거나 틀리면 403이다.

## 배포

```bash
cd worker
npx wrangler login
npx wrangler secret put SEOUL_RT_KEY   # 실시간 지하철 API 키
npx wrangler secret put METRO_TOKEN    # .env.local의 METRO_TOKEN 값
npx wrangler deploy
```

배포된 주소를 프로젝트 루트의 `.env.local`에 `VITE_API_BASE`로 넣는다. 끝에 슬래시를 넣지 않는다.

## 한계

토큰은 앱 번들 안에 있으므로 꺼낼 수 있다. 우연한 남용을 막는 장치이지 인증이 아니다.
남용이 보이면 Cloudflare rate limit을 건다. 무료 한도는 하루 10만 요청이다.
