# 유령 열차(도착 정보에만 있고 위치 피드에 없음)를 골랐다 → 3번 안 보이면 실제 열차로 바꾼다(10-04 노원 7075).
cd "$(dirname "$0")/../.."; source scripts/sim.sh; export SHOTS=${1:-/tmp/metro-shots}; mkdir -p $SHOTS
host false true; rm -f .dev/fault.json
set -- $(coord 노원); gps $1 $2
arr "7075 1007 노원 중계 석남 200" "7197 1007 노원 중계 석남 420"; pos "7197 1007 7호선 도봉산 1"
M0=$(wc -l < /tmp/metro-dev.log | tr -d ' ')
launch "하계"
tap click 1.5; tap click 3; sleep 3; tap click 3; sleep 75
tail -n +$M0 /tmp/metro-dev.log | grep -a '\[device\]' | grep -aE "\] (boarded|auto repick|train not in feed)" | cut -c1-200
pkill -f "automation-port 9898"
