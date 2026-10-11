# 멀리서 고른 열차를 놓침: 하계 295m(10-03 실측)에 서 있는 채로 열차가 떠난다 → 앱이 다음 열차로 바꾸고, 탭으로 되돌린다.
cd "$(dirname "$0")/../.."; source scripts/sim.sh; export SHOTS=${1:-/tmp/metro-shots}; mkdir -p $SHOTS
host false true; rm -f .dev/fault.json
far(){ printf '{"lat":37.6354525955175,"lon":127.06484040511386,"acc":40,"ts":%s}\n' "$(now)" > .dev/gps.json; }
touch $SHOTS/.gps; ( while [ -f $SHOTS/.gps ]; do far; sleep 2; done ) &
arr "7121 1007 하계 공릉 석남 90" "7123 1007 하계 공릉 석남 420"
pos "7121 1007 7호선 중계 1" "7123 1007 7호선 수락산 1"
M0=$(wc -l < /tmp/metro-dev.log | tr -d ' ')
launch "태릉입구"
tap click 1.5; tap click 3; tap click 5
pos "7121 1007 7호선 하계 1" "7123 1007 7호선 수락산 2"; sleep 21
pos "7121 1007 7호선 하계 2" "7123 1007 7호선 마들 1"; arr "7123 1007 하계 공릉 석남 300"; sleep 30
shot m2-switched; tap click 3; shot m3-undo
rm -f $SHOTS/.gps
tail -n +$M0 /tmp/metro-dev.log | grep -a '\[device\]' | grep -aE "\] (boarded|missed|wait gps|departed|undo)" | cut -c1-200
pkill -f "automation-port 9898"
