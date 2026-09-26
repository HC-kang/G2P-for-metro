#!/bin/bash
# D1에 쌓인 기기 로그를 읽는다. 사용: scripts/logs.sh [분=60] [세션 앞부분]
#   scripts/logs.sh 30            최근 30분, 폰에서 온 것만(dev- 제외)
#   scripts/logs.sh 120 0.4.3     최근 2시간, 세션 이름이 0.4.3으로 시작하는 것
#   scripts/logs.sh 30 dev-       시뮬레이터(dev 서버)에서 온 것
MIN=${1:-60}; SES=${2:-}
if [ -n "$SES" ]; then WHERE="session LIKE '${SES//\'/}%'"; else WHERE="session NOT LIKE 'dev-%'"; fi
cd "$(dirname "$0")/../worker" || exit 1
npx wrangler d1 execute metro-logs --remote --json --command \
  "SELECT at, session, kind, body FROM logs WHERE at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-${MIN//[^0-9]/} minutes') AND ${WHERE} ORDER BY id" 2>/dev/null |
python3 -c '
import sys, json, datetime
rows = json.load(sys.stdin)[0]["results"]
for r in rows:
    t = datetime.datetime.fromisoformat(r["at"].replace("Z", "+00:00")).astimezone().strftime("%m-%d %H:%M:%S")
    for line in r["body"].split("\n"):
        print(t, r["session"], r["kind"], line)
print(f"-- {len(rows)} batches", file=sys.stderr)'
