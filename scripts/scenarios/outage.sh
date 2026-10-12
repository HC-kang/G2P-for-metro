# 노선 위치 피드가 통째로 빈다(10-12 출근 7호선 14분) → 유령 판정·다시 고르기·10분 정지 없이 시각으로 추정하고,
# 피드가 돌아오면 관측으로 바꾼다. 사용: scripts/scenarios/outage.sh [스크린샷 폴더]
cd "$(dirname "$0")/../.."; source scripts/sim.sh; export SHOTS=${1:-/tmp/metro-shots}; mkdir -p $SHOTS
host false true; rm -f .dev/fault.json
set -- $(coord 하계); gps $1 $2
arr "7101 1007 하계 공릉 석남 40"; pos     # 도착 정보에는 있고 위치 피드는 비었다
M0=$(wc -l < /tmp/metro-dev.log | tr -d ' ')
launch "청담" "poll=fast"
tap click 1.5; tap click 3; sleep 3; tap click 3
sleep 60; shot outage-est1
sleep 60; shot outage-est2
pos "7101 1007 7호선 먹골 1"; sleep 15; shot outage-back
tail -n +$M0 /tmp/metro-dev.log | grep -a '\[device\]' | grep -aE "\] (boarded|auto repick|train not in feed|feed |fix |pick positions|ride stopped|picked train already left|departed)" | cut -c1-200
echo "console errors: $(consoleErrors)"
pkill -f "automation-port 9898"
