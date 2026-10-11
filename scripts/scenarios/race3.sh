# 시작 화면 경합(10-07·10-08): 위치를 1.2초 늦게, 텍스트 갱신을 1.5초 늦게 → 'list true' 뒤에 'upgrade false'가 나오면 재발이다.
cd "$(dirname "$0")/../.."; source scripts/sim.sh; export SHOTS=${1:-/tmp/metro-shots}; mkdir -p $SHOTS
host false true; rm -f .dev/fault.json
set -- $(coord 하계); printf '{"lat":%s,"lon":%s,"acc":20,"ts":%s,"delay":1200}\n' $1 $2 "$(now)" > .dev/gps.json
for i in 1 2 3; do
  M0=$(wc -l < /tmp/metro-dev.log | tr -d ' ')
  launch "태릉입구" "upgradeDelay=1500"; sleep 2; shot s$i
  echo "run $i: $(tail -n +$M0 /tmp/metro-dev.log | grep -a '\[device\]' | grep -aE "\] (startup|list |upgrade false)" | sed 's/.*\[device\] //' | cut -c1-40 | tr '\n' '|')"
done
pkill -f "automation-port 9898"
