# 시뮬레이터 구동 함수 모음. 사용: source scripts/sim.sh (저장소 루트에서)
# 전제: dev 서버(npm run dev, /tmp/metro-dev.log), evenhub-simulator --automation-port 9898
# 모사 피드: .dev/gps.json(위치), .dev/position.json·arrival.json(실시간 API), .dev/host.json(폰 잠금 흉내)
S=http://127.0.0.1:9898
SHOTS=${SHOTS:-/tmp/metro-shots}; mkdir -p "$SHOTS"
now(){ date +%s000; }
gps(){ printf '{"lat":%s,"lon":%s,"acc":5,"ts":%s}\n' "$1" "$2" "$(now)" > .dev/gps.json; }
coord(){ node -e "const d=require('./src/stations.json');const c=d.coords.find(c=>c.name==='$1');console.log(c.lat+' '+c.lon)"; }
# pos "열차번호 노선id 노선명 역 상태" ...   (여러 열차는 인자를 여러 개)
pos(){ python3 - "$@" <<'PY'
import sys,json,datetime
t=datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'); rows=[]
for spec in sys.argv[1:]:
    no,sid,line,stn,st=spec.split()
    rows.append({"subwayId":sid,"subwayNm":line,"statnNm":stn,"trainNo":no,"updnLine":"1","statnTnm":"종착","trainSttus":st,"directAt":"0","recptnDt":t})
json.dump({"realtimePositionList":rows},open('.dev/position.json','w'),ensure_ascii=False)
PY
}
# arr "열차번호 노선id 역 방면역 행선지 초" ...   (인자 없으면 도착 정보 없음)
arr(){ python3 - "$@" <<'PY'
import sys,json; rows=[]
for spec in sys.argv[1:]:
    no,sid,stn,toward,dest,sec=spec.split()
    rows.append({"subwayId":sid,"statnNm":stn,"updnLine":"하행","trainLineNm":f"{dest}행 - {toward}방면","btrainSttus":"일반","barvlDt":sec,"btrainNo":no,"arvlMsg2":f"{int(sec)//60}분 후 도착"})
json.dump({"realtimeArrivalList":rows},open('.dev/arrival.json','w'),ensure_ascii=False)
PY
}
host(){ printf '{"background": %s, "ticks": %s}\n' "$1" "${2:-false}" > .dev/host.json; }
tap(){ curl -s -m 3 -X POST -H 'Content-Type: application/json' -d "{\"action\":\"$1\"}" $S/api/input >/dev/null; sleep "${2:-1.5}"; }   # click|double_click|up|down
shot(){ curl -s -m 5 -o "$SHOTS/$1.png" $S/api/screenshot/glasses; echo "  [$1]"; }
webshot(){ curl -s -m 5 -o "$SHOTS/$1.png" $S/api/screenshot/webview; echo "  [$1 phone]"; }
enc(){ python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
# launch "도착지1,도착지2" [추가 쿼리]
# 사용자 화면을 가리지 않는다(사용자 요청 2026-10-08): 띄우기 전 맨 앞 앱을 기억하고, 창이 생기는 즉시
# 오른쪽 아래 구석으로 작게 보낸 뒤 그 앱을 다시 앞으로 가져온다. SIM_FRONT=1이면 예전처럼 앞에 둔다.
# 창은 둘이다(글라스 576x360, 폰 600x800). 크기는 줄지 않는다. 둘 다 화면 밖으로 밀고 오른쪽 아래 SIM_PEEK 픽셀만 남긴다.
# 가려져도 앱은 돈다(타이머가 약 1.4배 느려진다, 2026-10-08 실측). 글라스 스크린샷은 창과 무관하게 찍힌다.
SIM_PEEK=${SIM_PEEK:-120}
front(){ lsappinfo info -only bundleid "$(lsappinfo front)" 2>/dev/null | sed -n 's/.*="\(.*\)"/\1/p'; }
tuck(){ osascript -e "tell application \"System Events\" to tell process \"evenhub-simulator\" to set position of every window to {$1 - $SIM_PEEK, $2 - $SIM_PEEK}" >/dev/null 2>&1; }
screen(){ osascript -e 'tell application "Finder" to get bounds of window of desktop' 2>/dev/null | awk -F', ' '{print $3, $4}'; }
launch(){
  local app; app=$(front)
  pkill -f "automation-port 9898" 2>/dev/null; sleep 1
  nohup node_modules/@evenrealities/sim-darwin-arm64/bin/evenhub-simulator --automation-port 9898 "http://localhost:5173/?gps=dev&api=dev&host=ios&dests=$(enc "$1")${2:+&$2}" > /tmp/metro-sim.log 2>&1 &
  if [ -z "$SIM_FRONT" ]; then
    local i; for i in $(seq 1 12); do
      osascript -e 'tell application "System Events" to exists window 1 of process "evenhub-simulator"' 2>/dev/null | grep -q true && break
      sleep 0.25
    done
    tuck $(screen)
    [ -n "$app" ] && [ "$app" != "com.evenrealities.simulator" ] && open -b "$app"
  fi
  sleep 8
}
dev(){ grep -a '\[device\]' /tmp/metro-dev.log; }
consoleErrors(){ curl -s -m 3 $S/api/console | python3 -c 'import sys,json;print(sum(1 for m in json.load(sys.stdin)["entries"] if m["level"]=="error"))'; }
