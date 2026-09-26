#!/bin/bash
# 워커 실시간 로그를 /tmp/metro-tail.jsonl에 모은다. 사용: nohup scripts/tail-logs.sh >/dev/null 2>&1 &
# wrangler tail은 몇 시간 뒤 연결이 끊긴 채 프로세스만 살아 있다(2026-09-26 실측: 47시간째 무수신).
# 그래서 한 시간마다 새로 붙인다. "서버로 보내기" 묶음은 워커가 KV에도 보관하므로 여기서 놓쳐도 꺼낼 수 있다.
cd "$(dirname "$0")/../worker" || exit 1
while true; do
  npx wrangler tail --format json >> /tmp/metro-tail.jsonl 2>> /tmp/metro-tail.err &
  p=$!
  sleep 3600
  pkill -P $p 2>/dev/null; kill $p 2>/dev/null; wait $p 2>/dev/null
done
