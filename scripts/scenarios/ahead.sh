# 출근길(하계→태릉입구 6→신당 2→홍대입구) 대기 화면의 하차 안내: w1(7호선), w2(6호선) 스크린샷과 ahead 로그.
cd "$(dirname "$0")/../.."; source scripts/sim.sh; export SHOTS=${1:-/tmp/metro-shots}; mkdir -p $SHOTS
host false true; rm -f .dev/fault.json
set -- $(coord 하계); gps $1 $2
arr "7121 1007 하계 공릉 석남 200"
pos "7121 1007 7호선 노원 1"
M0=$(wc -l < /tmp/metro-dev.log | tr -d ' ')
launch "홍대입구"
tap click 1.5; tap click 3
N=$(tail -n +$M0 /tmp/metro-dev.log | grep -a "\] options" | tail -1 | sed 's/.*options //' | tr '/' '\n' | grep -n "태릉입구(6), 신당" | head -1 | cut -d: -f1)
for i in $(seq 2 ${N:-1}); do tap down 0.6; done; tap click 5
sleep 3; shot w1-leg7
pos "7121 1007 7호선 하계 1"; sleep 17
pos "7121 1007 7호선 하계 2"; sleep 17
pos "7121 1007 7호선 공릉 1"; sleep 17
arr "6098 1006 태릉입구 석계 응암순환 300"
pos "7121 1007 7호선 태릉입구 1" "6098 1006 6호선 봉화산 1"; sleep 17
pos "7121 1007 7호선 먹골 1" "6098 1006 6호선 봉화산 2"; sleep 25; shot w2-leg6
tail -n +$M0 /tmp/metro-dev.log | grep -a '\[device\]' | grep -aE "\] (plan|boarded|ahead|transfer at|door)" | cut -c1-170
echo "console errors: $(consoleErrors)"
pkill -f "automation-port 9898"
