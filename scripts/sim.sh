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
launch(){ pkill -f "evenhub-simulator" 2>/dev/null; sleep 1; nohup npx evenhub-simulator --automation-port 9898 "http://localhost:5173/?gps=dev&api=dev&host=ios&dests=$(enc "$1")${2:+&$2}" > /tmp/metro-sim.log 2>&1 & sleep 9; }
dev(){ grep -a '\[device\]' /tmp/metro-dev.log; }
consoleErrors(){ curl -s -m 3 $S/api/console | python3 -c 'import sys,json;print(sum(1 for m in json.load(sys.stdin)["entries"] if m["level"]=="error"))'; }
