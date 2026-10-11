# 10-04 노원 오판 재현: 7호선 승강장 근처(7호선 좌표 69m, 4호선 좌표 227m)에서 기다린다 → 열차를 버리면 안 된다.
cd "$(dirname "$0")/../.."; source scripts/sim.sh; export SHOTS=${1:-/tmp/metro-shots}; mkdir -p $SHOTS
host false true; rm -f .dev/fault.json
spot(){ printf '{"lat":37.65507868760056,"lon":127.06118650826708,"acc":24,"ts":%s}\n' "$(now)" > .dev/gps.json; }
touch $SHOTS/.gps; ( while [ -f $SHOTS/.gps ]; do spot; sleep 2; done ) &
arr "7195 1007 노원 중계 석남 90"; pos "7195 1007 7호선 마들 2"
M0=$(wc -l < /tmp/metro-dev.log | tr -d ' ')
launch "하계"
tap click 1.5; tap click 3; sleep 4
pos "7195 1007 7호선 노원 1"; sleep 21
pos "7195 1007 7호선 노원 2"; sleep 25
pos "7195 1007 7호선 중계 1"; sleep 130
rm -f $SHOTS/.gps
tail -n +$M0 /tmp/metro-dev.log | grep -a '\[device\]' | grep -aE "\] (boarded|missed|wait gps|departed|fix )" | cut -c1-200
pkill -f "automation-port 9898"
