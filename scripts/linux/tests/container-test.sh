#!/usr/bin/env bash
# DOLIVE Linux 설치·운영 회귀 시험. 개발용 컴퓨터(Docker 필요)에서 실행한다. 실제 서버에서 실행하지 않는다.
#   scripts/linux/tests/container-test.sh --context <전용 Docker context> [--arch arm64|amd64] [--keep]
# Ubuntu 24.04 컨테이너에서 systemd 를 켜고, 이 폴더의 코드를 /opt/dolive 로 복사해 실제로 설치·기동한다.
# 비밀값은 시험 안에서 새로 만든 일회용 값만 쓴다 (apps/web/.env.local, server/config/livekit.yaml 은 복사하지 않음).
# 인증서는 Caddy 내부 시험 인증서(tls internal)로만 만든다. 외부 ACME·DNS·도름스에는 연결하지 않는다.
#
# 안전 조건: --privileged systemd 컨테이너는 Docker VM 커널 설정(binfmt 등)에 닿을 수 있다.
# 그래서 시험 전용 VM 의 Docker context 를 반드시 직접 지정하고, 그 VM 에 다른 실행 중 컨테이너가 있으면 멈춘다.
# 전용 VM 예 (현재 Docker context 를 바꾸지 않음):
#   colima start dolive-linux-verify --activate=false --ssh-config=false --mount none --cpus 4 --memory 6 --disk 40
#   scripts/linux/tests/container-test.sh --context colima-dolive-linux-verify
set -uo pipefail

ARCH=arm64 KEEP=0 CTX=''
while [ $# -gt 0 ]; do
  case $1 in
    --arch) ARCH=$2; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --context) CTX=$2; shift 2 ;;
    *) echo "사용법: $0 --context <전용 Docker context> [--arch arm64|amd64] [--keep]" >&2; exit 2 ;;
  esac
done
stop_now() { echo "  [멈춤] $*" >&2; exit 2; }
[ -n "$CTX" ] || stop_now "시험 전용 VM 의 Docker context 를 --context 로 지정해 주세요 (예: colima-dolive-linux-verify). 현재 context 를 묵시적으로 쓰지 않습니다"
case $CTX in
  colima|default|desktop-linux|orbstack|rancher-desktop) stop_now "공유 Docker 환경($CTX)에서는 실행하지 않습니다. 시험 전용 VM 을 만들어 그 context 를 지정해 주세요" ;;
esac
export DOCKER_CONTEXT=$CTX
docker context inspect "$CTX" >/dev/null 2>&1 || stop_now "Docker context 가 없어요: $CTX"
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
C=dolive-linux-test-$ARCH
IMG=dolive-linux-test:$ARCH
OTHERS=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -vx "$C" || true)
[ -z "$OTHERS" ] || stop_now "이 Docker 환경($CTX)에 다른 실행 중 컨테이너가 있어요: $(echo $OTHERS). 시험 전용 VM 에서만 실행합니다"
DOMAIN=dolive.test
PASS=0 FAIL=0
FAILED=()

log() { printf '\n=== %s\n' "$*"; }
pass() { PASS=$((PASS + 1)); printf '  PASS %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); FAILED+=("$*"); printf '  FAIL %s\n' "$*"; }
check() { local name=$1; shift; if "$@"; then pass "$name"; else fail "$name"; fi; }
# 두 값이 비어 있지 않고 같다
same() { [ -n "$1" ] && [ "$1" = "$2" ]; }
dx() { docker exec "$C" bash -c "$1"; }
dxq() { docker exec "$C" bash -c "$1" >/dev/null 2>&1; }
wait_systemd() {
  local i s
  for i in $(seq 1 90); do
    s=$(docker exec "$C" systemctl is-system-running 2>/dev/null || true)
    case $s in running|degraded) return 0 ;; esac
    sleep 2
  done
  return 1
}
# 0 이 아니어야 실제로 켜진 시각이다
active_since() { dx "systemctl show -p ActiveEnterTimestampMonotonic --value dolive-$1" | grep -v '^0$'; }
all_units() { dxq "for u in $2; do systemctl $1 --quiet \$u || exit 1; done"; }
none_active() { dxq 'for u in dolive-livekit dolive-web dolive-caddy; do ! systemctl is-active --quiet $u || exit 1; done'; }
hash_state() {
  dx 'set -e; cd /opt/dolive; sha256sum /etc/dolive/dolive.env server/config/rooms.txt server/config/staff.txt apps/web/models/supertonic/*; find /var/lib/private/dolive-caddy -type f -name "*.crt" -exec sha256sum {} + | sort'
}
certs() { dx 'find /var/lib/private/dolive-caddy -name "*.crt" -exec sha256sum {} + | sort'; }
file_hash() { dx "sha256sum < '$1'"; }
livekit_ip() { dx 'tr "\0" "\n" < /proc/$(pgrep -x livekit-server)/environ | sed -n "s/^NODE_IP=//p"'; }
# 실행 중 LiveKit 의 환경변수 하나 (키 이름처럼 비밀이 아닌 값만 화면에 쓴다)
livekit_env() { dx "tr '\\0' '\\n' < /proc/\$(pgrep -x livekit-server)/environ | sed -n 's/^$1=//p'"; }
caddy_mark() { dx "curl -skI -m 10 --resolve $DOMAIN:443:$IP https://$DOMAIN/" | tr -d '\r' | sed -n 's/^x-dolive-check: //Ip'; }
# Docker VM 의 binfmt 등록 목록 (시험 전후가 같아야 한다)
binfmt_list() {
  local list
  list=$(docker run --rm --privileged --platform "linux/$ARCH" --entrypoint bash "$IMG" -c \
    'mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc 2>/dev/null; ls /proc/sys/fs/binfmt_misc | sort | tr "\n" " "') || return 1
  echo "[${list% }]"
}

cleanup() {
  if [ "$KEEP" -eq 0 ]; then docker rm -f "$C" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

log "준비: context $CTX, 이미지 $IMG, 컨테이너 $C"
docker build --platform "linux/$ARCH" -t "$IMG" "$REPO/scripts/linux/tests" >/dev/null || { echo "이미지 만들기 실패"; exit 1; }
BINFMT_BEFORE=$(binfmt_list)
echo "  시험 전 binfmt: $BINFMT_BEFORE"
docker rm -f "$C" >/dev/null 2>&1 || true
docker run -d --name "$C" --hostname dolive-droplet --platform "linux/$ARCH" --privileged --cgroupns=private \
  --sysctl net.ipv6.conf.all.disable_ipv6=0 --sysctl net.ipv6.conf.lo.disable_ipv6=0 \
  --tmpfs /run --tmpfs /run/lock "$IMG" >/dev/null || { echo "컨테이너 실행 실패"; exit 1; }
wait_systemd || { echo "systemd 가 켜지지 않았어요"; docker logs "$C" | tail -20; exit 1; }
IP=$(dx "ip -4 -o addr show dev eth0 | awk '{print \$4}' | cut -d/ -f1")
# 공인 IP 가 바뀌는 상황(실패 뒤 다시 적용, 새 서버로 옮기기)을 위한 문서용 주소. eth0 에 붙여 이 서버 주소로 만든다
IP3=198.51.100.3 IP4=198.51.100.4
EXTRA_IPS="$IP3"
PUB=$IP # DNS(여기서는 /etc/hosts)가 가리키는 공인 IP
set_net() {
  # DigitalOcean cloud-init 과 같은 /etc/hosts (localhost 가 127.0.0.1 과 ::1 둘 다). 시험 도메인은 PUB.
  # 안전장치: 공개 ACME 발급처 이름은 이 컨테이너 안에서 닿지 않는 주소로 돌린다 (시험은 내부 인증서만 씀)
  dx "printf '127.0.1.1 dolive-droplet\n127.0.0.1 localhost\n::1 localhost ip6-localhost ip6-loopback\n$PUB $DOMAIN\n127.0.0.9 acme-v02.api.letsencrypt.org acme-staging-v02.api.letsencrypt.org acme.zerossl.com\n' > /etc/hosts"
  # IPv6 를 켠 드롭릿처럼 전역 IPv6 주소를 하나 둔다 (문서용 주소 2001:db8::/32). 그래야 localhost 가 ::1 로도 풀린다
  dx 'sysctl -qw net.ipv6.conf.eth0.disable_ipv6=0; ip -6 addr add 2001:db8:d011:e::10/64 dev eth0 nodad 2>/dev/null || true'
  local x
  for x in $EXTRA_IPS; do dx "ip addr add $x/32 dev eth0 2>/dev/null || true"; done
}
set_net
echo "  컨테이너 주소 $IP, $(dx 'uname -m'), $(dx '. /etc/os-release; echo $PRETTY_NAME')"

log "코드 복사 (깃 추적 파일 + 새 파일, 비밀·빌드 결과·설치 부품 제외)"
(cd "$REPO" && git ls-files -z --cached --others --exclude-standard | COPYFILE_DISABLE=1 tar --no-xattrs --null -T - -cf -) | docker exec -i "$C" bash -c 'mkdir -p /opt/dolive && tar -xf - -C /opt/dolive'
# 모델은 이 컴퓨터의 것을 복사하되 F1.json 하나는 빼서 설치 스크립트의 받기·체크섬 확인을 시험한다
(cd "$REPO/apps/web/models" && COPYFILE_DISABLE=1 tar --no-xattrs --exclude supertonic/F1.json -cf - supertonic) | docker exec -i "$C" bash -c 'mkdir -p /opt/dolive/apps/web/models && tar -xf - -C /opt/dolive/apps/web/models'
dx 'cd /opt/dolive && git init -q -b main && git -c user.name=test -c user.email=test@invalid add -A && git -c user.name=test -c user.email=test@invalid commit -qm "시험 기준" && git clone -q --bare /opt/dolive /srv/origin.git && git remote add origin /srv/origin.git && git fetch -q origin && git branch -q -u origin/main && git config --system --add safe.directory /srv/origin.git'
# 운영 중이던 서버처럼 방송 목록·운영진이 이미 있다 (설치가 덮어쓰지 않는지 본다)
dx "printf 'DOLIVE\t\tmembers\t\r\n시험 방송\t1234\tguest\t\r\n' > /opt/dolive/server/config/rooms.txt; printf '시험운영진\r\n' > /opt/dolive/server/config/staff.txt"
# 시험에서만: Caddy 가 외부 ACME 대신 내부 시험 인증서를 쓴다
dx 'mkdir -p /etc/systemd/system/dolive-caddy.service.d && printf "[Service]\nEnvironment=DOLIVE_TLS=internal\n" > /etc/systemd/system/dolive-caddy.service.d/test-internal-tls.conf'

log "1. 첫 설치"
TEST_DORMS=$(dx 'cat /proc/sys/kernel/random/uuid')
if dx "/opt/dolive/scripts/linux/dolive-install.sh --domain $DOMAIN --public-ip $IP --dorms-client-id $TEST_DORMS" ; then pass "첫 설치"; else fail "첫 설치"; fi
check "부팅 자동 시작 등록 (넷 모두)" all_units is-enabled "dolive.target dolive-livekit dolive-web dolive-caddy"
check "세 서비스 실행 중 (셋 모두)" all_units is-active "dolive-livekit dolive-web dolive-caddy"
check "health 정상" dxq 'dolivectl health'
check "정상 기동 뒤 적용 기록 (셋 모두)" dxq 'for s in livekit web caddy; do [ -s /var/lib/dolive-applied/$s ] || exit 1; done; [ "$(stat -c "%U %a" /var/lib/dolive-applied)" = "root 700" ]'
check "F1.json 을 받아 체크섬 확인" dxq 'cd /opt/dolive && grep F1.json server/linux/supertonic.sha256 | sed "s#voice_styles/##" | (cd apps/web/models/supertonic && sha256sum -c -)'
check "설정 파일 권한 root:dolive 640" dxq '[ "$(stat -c "%U:%G %a" /etc/dolive/dolive.env)" = "root:dolive 640" ]'
owner() { dx "ps -o user= -p \$(systemctl show -p MainPID --value dolive-$1)" | tr -d ' '; }
check "LiveKit·웹은 dolive 계정" [ "$(owner livekit) $(owner web)" = "dolive dolive" ]
check "Caddy 는 root·dolive 아닌 임시 계정" bash -c 'u=$1; [ -n "$u" ] && [ "$u" != root ] && [ "$u" != dolive ]' _ "$(owner caddy)"
check "Caddy 는 내부 시험 인증서 사용 (외부 ACME 안 씀)" dxq '! journalctl -u dolive-caddy --no-pager | grep -q "acme-v02\|acme-staging\|zerossl"'
check "Caddy 에 비밀값 없음" dxq '! tr "\0" "\n" < /proc/$(systemctl show -p MainPID --value dolive-caddy)/environ | grep -q LIVEKIT_API_SECRET'
check "LiveKit 명령줄에 비밀값 없음" dxq 'secret=$(sed -n "s/^LIVEKIT_API_SECRET=//p" /etc/dolive/dolive.env); [ -n "$secret" ] && ! ps -eo args | grep -F -- "$secret" | grep -v grep'
check "LiveKit 이 설정의 공인 IP 로 켜짐 (NODE_IP)" same "$(livekit_ip)" "$IP"
check "새 설치(.env.local 없음)는 키 이름 dolive" dxq 'grep -qx "LIVEKIT_API_KEY=dolive" /etc/dolive/dolive.env'
check "새 설치: LiveKit 퇴장 알림 키도 dolive" same "$(livekit_env LIVEKIT_WEBHOOK_API_KEY)" dolive
check "LiveKit 에 비밀값 변수(LIVEKIT_API_SECRET)를 넘기지 않음" [ -z "$(livekit_env LIVEKIT_API_SECRET)" ]

log "2. 번호와 주소"
dx 'ss -Hltnu | awk "{print \$1, \$5}" | sort -u'
check "3000 은 127.0.0.1 만" dxq '[ "$(ss -Hltn sport = :3000 | awk "{print \$4}" | sort -u)" = "127.0.0.1:3000" ]'
check "7880 은 127.0.0.1 만" dxq '[ "$(ss -Hltn sport = :7880 | awk "{print \$4}" | sort -u)" = "127.0.0.1:7880" ]'
check "7881 TCP 는 바깥에 열림" dxq 'ss -Hltn sport = :7881 | grep -Eq "(\*|0\.0\.0\.0|\[::\]):7881"'
check "443 은 바깥에 열림" dxq 'ss -Hltn sport = :443 | grep -Eq "(\*|0\.0\.0\.0|\[::\]):443"'
check "Caddy 관리 창구(2019) 없음" dxq '! ss -Hltn | grep -q ":2019 "'
check "바깥 주소로 3000 접속 불가" dxq "! curl -s -m 3 -o /dev/null http://$IP:3000/"
check "바깥 주소로 7880 접속 불가" dxq "! curl -s -m 3 -o /dev/null http://$IP:7880/"
echo "  localhost → $(dx 'getent ahosts localhost | awk "{print \$1}" | sort -u | tr "\n" " "')"
check "localhost 가 ::1 도 가리킴 (드롭릿과 같은 조건)" dxq 'getent ahosts localhost | grep -q "^::1"'
check "Node fetch http://localhost:7880 (웹 API 경로)" dxq 'cd /opt/dolive/apps/web && runuser -u dolive -- /opt/dolive/server/bin/node/bin/node -e "fetch(\"http://localhost:7880/\").then(r=>r.text()).then(t=>process.exit(t===\"OK\"?0:1),()=>process.exit(1))"'

log "3. 마스터 권한 경계 (isLocal)"
me() { dx "curl -sk -m 10 $1" | grep -o '"local":[a-z]*'; }
check "Caddy 경유 일반 접속은 마스터 아님" [ "$(me "--resolve $DOMAIN:443:$IP https://$DOMAIN/api/me")" = '"local":false' ]
check "X-Forwarded-For 127.0.0.1 위조해도 마스터 아님" [ "$(me "--resolve $DOMAIN:443:$IP -H 'X-Forwarded-For: 127.0.0.1' https://$DOMAIN/api/me")" = '"local":false' ]
check "X-Forwarded-For ::1 위조해도 마스터 아님" [ "$(me "--resolve $DOMAIN:443:$IP -H 'X-Forwarded-For: ::1' https://$DOMAIN/api/me")" = '"local":false' ]
check "Host: localhost 위조는 웹까지 가지 않음" [ -z "$(me "--resolve $DOMAIN:443:$IP -H 'Host: localhost' https://$DOMAIN/api/me")" ]
check "SNI localhost 로 직접 접속해도 안 됨" [ -z "$(me "--resolve localhost:443:$IP https://localhost/api/me")" ]
check "바깥 80번에 Host: localhost 로도 웹에 닿지 않음" [ -z "$(me "-H 'Host: localhost' http://$IP/api/me")" ]
END_CODE=$(dx "curl -sk -m 10 -o /dev/null -w '%{http_code}' -X POST --resolve $DOMAIN:443:$IP -H 'X-Forwarded-For: 127.0.0.1' https://$DOMAIN/api/end")
check "바깥 사람은 /api/end 불가 (401/403, 실제 $END_CODE)" bash -c '[ "$1" = 401 ] || [ "$1" = 403 ]' _ "$END_CODE"
check "서버 안 127.0.0.1:3000 은 마스터" [ "$(me "http://127.0.0.1:3000/api/me")" = '"local":true' ]
# 관리자 PC 에서 하는 SSH 터널을 컨테이너 안에서 흉내 낸다 (전용 시험 계정, 공개키만)
dx 'id tunnel >/dev/null 2>&1 || useradd -m -s /bin/bash tunnel; install -d -o tunnel -m 700 /home/tunnel/.ssh; rm -f /root/.ssh/t; mkdir -p /root/.ssh; ssh-keygen -q -t ed25519 -N "" -f /root/.ssh/t; install -o tunnel -m 600 /root/.ssh/t.pub /home/tunnel/.ssh/authorized_keys; systemctl start ssh' >/dev/null 2>&1
dx 'ssh -i /root/.ssh/t -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes -f -N -L 13000:127.0.0.1:3000 -L 17880:127.0.0.1:7880 tunnel@127.0.0.1' >/dev/null 2>&1
check "SSH 터널(localhost:13000)로 들어오면 마스터" [ "$(me "http://localhost:13000/api/me")" = '"local":true' ]
check "SSH 터널로 LiveKit(7880)도 닿음" [ "$(dx 'curl -s -m 5 http://localhost:17880/')" = OK ]
dxq 'pkill -f "ssh -i /root/.ssh/t"'

log "4. 점검(doctor) 결과 구분과 실제 기능 시험"
DOC=$(dx 'dolivectl doctor'); DOC_RC=$?
echo "$DOC" | sed 's/^/    /'
check "인증서를 믿을 수 없는 동안 doctor 는 '미확인'(끝 코드 2, 실제 $DOC_RC)" bash -c '[ "$1" = 2 ] && grep -q "\[미확인\] HTTPS 인증서" <<< "$2" && grep -q "운영 준비 완료가 아닙니다" <<< "$2" && ! grep -q "문제 없음" <<< "$2"' _ "$DOC_RC" "$DOC"
# 시험 컨테이너에서만: Caddy 내부 시험 CA 를 시스템 인증서 목록에 넣는다 (실제 서버는 Let's Encrypt 가 이미 목록에 있음. 검증을 끄지 않는다)
dx 'cp /var/lib/private/dolive-caddy/caddy/pki/authorities/local/root.crt /usr/local/share/ca-certificates/dolive-test-caddy-root.crt && update-ca-certificates >/dev/null 2>&1'
DOC=$(dx 'dolivectl doctor'); DOC_RC=$?
check "DNS(hosts)·인증서가 맞으면 doctor 끝 코드 0 (실제 $DOC_RC)" bash -c '[ "$1" = 0 ] && grep -q "HTTPS 인증서 정상" <<< "$2" && ! grep -q "\[미확인\]\|\[실패\]" <<< "$2"' _ "$DOC_RC" "$DOC"
# 공인 주소를 직접 지정해 7880 을 여는 프로그램이 있으면 잡아내는지 (0.0.0.0 이 아닌 경우)
dx "nohup /opt/dolive/server/bin/node/bin/node -e 'require(\"net\").createServer().listen(7880, \"$IP\")' >/dev/null 2>&1 & sleep 2"
DOC=$(dx 'dolivectl doctor'); DOC_RC=$?
check "명시적 바깥 주소 $IP:7880 도 doctor 가 실패로 잡음 (실제 $DOC_RC)" bash -c '[ "$1" = 1 ] && grep -q "7880 번이 서버 바깥 주소에도 열려 있어요: $3:7880" <<< "$2"' _ "$DOC_RC" "$DOC" "$IP"
dxq "pkill -f 'listen\\(7880'"
SELF=$(dx 'dolivectl selftest' 2>&1); SELF_RC=$?
echo "$SELF" | sed 's/^/    /'
check "selftest 네 목소리 WAV" bash -c '[ "$(grep -c "\[ OK \] 글 읽기 목소리" <<< "$1")" = 4 ]' _ "$SELF"
check "selftest 서버 안 경로: 입장·채팅·사진·글 읽기 참여자·빈 방 정리" grep -q "통과: 한 명 남으면 기록 유지" <<< "$SELF"
check "selftest 바깥 경로: wss://$DOMAIN(Caddy) WebSocket 업그레이드와 참여자 연결" grep -q "통과: wss://$DOMAIN WebSocket 업그레이드와 LiveKit 참여자 연결" <<< "$SELF"
check "selftest 바깥 경로: SDK 입장·퇴장" grep -q "통과: wss://$DOMAIN SDK 입장·퇴장" <<< "$SELF"
check "selftest 끝 코드 0 (실제 $SELF_RC)" [ "$SELF_RC" = 0 ]
check "방송 목록 원래대로 (시험 방 지움)" dxq "[ \"\$(grep -c . /opt/dolive/server/config/rooms.txt)\" = 2 ]"

log "5. 다시 설치해도 보존·무중단"
BEFORE=$(hash_state); T_LK=$(active_since livekit); T_WEB=$(active_since web); T_CADDY=$(active_since caddy)
if dx "/opt/dolive/scripts/linux/dolive-install.sh --domain other.invalid --public-ip 192.0.2.1" >/dev/null; then pass "두 번째 설치"; else fail "두 번째 설치"; fi
check "설정·방송 목록·운영진·모델·인증서 그대로 (13개 이상 파일)" bash -c '[ "$(grep -c . <<< "$1")" -ge 13 ] && [ "$1" = "$2" ]' _ "$BEFORE" "$(hash_state)"
check "설정 파일 도메인 그대로 (새 인자 무시)" dxq "grep -q '^DOLIVE_DOMAIN=$DOMAIN$' /etc/dolive/dolive.env"
check "바뀐 것이 없으면 서비스를 다시 켜지 않음" same "$T_LK $T_WEB $T_CADDY" "$(active_since livekit) $(active_since web) $(active_since caddy)"

log "5-2. 설치가 중간에 실패한 뒤 다시 실행하면 바뀐 설정을 실제로 적용"
# 설정 파일의 공인 IP 와 Caddy 설정을 바꾸고, 서비스를 다시 켜는 단계에서 일부러 실패시킨다 (systemctl start/restart 만 실패하는 가짜 명령)
dx 'mkdir -p /root/failshim && printf "#!/bin/sh\ncase \" \$* \" in *\" restart \"*|*\" start \"*) echo \"시험: 다시 켜기 일부러 실패\" >&2; exit 1 ;; esac\nexec /usr/bin/systemctl \"\$@\"\n" > /root/failshim/systemctl && chmod +x /root/failshim/systemctl'
dx "sed -i 's/^DOLIVE_PUBLIC_IP=.*/DOLIVE_PUBLIC_IP=$IP3/' /etc/dolive/dolive.env"
dx 'sed -i "s/^\timport tls_.*/&\n\theader X-Dolive-Check reapply/" /opt/dolive/server/linux/Caddyfile'
if dx 'PATH=/root/failshim:$PATH /opt/dolive/scripts/linux/dolive-install.sh' >/dev/null 2>&1; then fail "다시 켜기 실패가 설치 실패로 보고돼야 함"; else pass "다시 켜기 단계 실패는 설치 실패로 보고"; fi
check "실패 직후: LiveKit 은 아직 이전 IP" same "$(livekit_ip)" "$IP"
check "실패 직후: Caddy 는 아직 이전 설정" [ -z "$(caddy_mark)" ]
T_LK=$(active_since livekit); T_WEB=$(active_since web); T_CADDY=$(active_since caddy)
if dx '/opt/dolive/scripts/linux/dolive-install.sh' >/dev/null; then pass "실패 뒤 설치 다시 실행"; else fail "실패 뒤 설치 다시 실행"; fi
check "다시 실행 뒤: 실행 중 LiveKit 에 새 공인 IP $IP3 적용" same "$(livekit_ip)" "$IP3"
check "다시 실행 뒤: LiveKit 기록에도 새 IP" dxq "journalctl -u dolive-livekit --no-pager -n 200 | grep -q '\"nodeIP\": \"$IP3\"'"
check "다시 실행 뒤: Caddy 새 설정 적용" [ "$(caddy_mark)" = reapply ]
check "다시 실행 뒤: 세 서비스 모두 다시 켜짐 (설정 파일이 바뀜)" bash -c '[ "$1" != "$4" ] && [ "$2" != "$5" ] && [ "$3" != "$6" ]' _ "$T_LK" "$T_WEB" "$T_CADDY" "$(active_since livekit)" "$(active_since web)" "$(active_since caddy)"
PUB=$IP3; set_net
# Caddy 설정만 되돌리면 Caddy 만 다시 켠다
T_LK=$(active_since livekit); T_WEB=$(active_since web); T_CADDY=$(active_since caddy)
dx 'cd /opt/dolive && runuser -u dolive -- git checkout -q -- server/linux/Caddyfile'
if dx '/opt/dolive/scripts/linux/dolive-install.sh' >/dev/null; then pass "Caddy 설정만 바꾼 설치"; else fail "Caddy 설정만 바꾼 설치"; fi
check "Caddy 만 다시 켜짐 (LiveKit·웹 그대로)" bash -c 'same() { [ -n "$1" ] && [ "$1" = "$2" ]; }; same "$1" "$4" && same "$2" "$5" && [ -n "$6" ] && [ "$3" != "$6" ]' _ "$T_LK" "$T_WEB" "$T_CADDY" "$(active_since livekit)" "$(active_since web)" "$(active_since caddy)"
check "되돌린 Caddy 설정 적용" [ -z "$(caddy_mark)" ]
T_ALL="$(active_since livekit) $(active_since web) $(active_since caddy)"
dxq '/opt/dolive/scripts/linux/dolive-install.sh'
check "그다음 변경 없는 설치는 아무것도 다시 켜지 않음" same "$T_ALL" "$(active_since livekit) $(active_since web) $(active_since caddy)"

log "6. 복구·끄기·켜기"
T_LK=$(active_since livekit)
check "recover web" dxq 'dolivectl recover web'
check "recover 는 LiveKit 을 건드리지 않음" same "$T_LK" "$(active_since livekit)"
check "recover 기록 보관" dxq 'ls /var/lib/dolive/recovery/dolive-web-before-recovery-*.log'
dx 'systemctl kill -s KILL dolive-web' >/dev/null 2>&1; sleep 12
check "웹이 죽으면 systemd 가 다시 켬" dxq 'systemctl is-active dolive-web && dolivectl health --wait 60'
check "stop" dxq 'dolivectl stop'
check "stop 뒤 셋 모두 꺼짐" none_active
check "start" dxq 'dolivectl start'

log "7. 재부팅 뒤 자동 시작과 인증서 유지"
CERT=$(certs)
docker restart "$C" >/dev/null
wait_systemd || true
set_net
check "재부팅 뒤 모두 정상" dxq 'dolivectl health --wait 120'
check "인증서 파일 유지" same "$CERT" "$(certs)"

log "8. 백업과 복원"
ROOMS1=$(file_hash /opt/dolive/server/config/rooms.txt)
B1=$(dx 'dolivectl backup' | sed -n 's/.*백업: //p' | tail -n 1)
dx "printf '백업 시험 방\t\tmembers\t\r\n' >> /opt/dolive/server/config/rooms.txt"
ROOMS2=$(file_hash /opt/dolive/server/config/rooms.txt)
B2=$(dx 'dolivectl backup' | sed -n 's/.*백업: //p' | tail -n 1)
echo "  연속 백업: $B1 / $B2"
check "연속 두 백업은 서로 다른 파일" bash -c '[ -n "$1" ] && [ -n "$2" ] && [ "$1" != "$2" ]' _ "$B1" "$B2"
check "두 백업 모두 남아 있고 root 600" dxq "for f in '$B1' '$B2'; do [ \"\$(stat -c '%U %a' \"\$f\")\" = 'root 600' ] || exit 1; done"
check "기본 백업 폴더 root 700" dxq '[ "$(stat -c "%U %a" /var/backups/dolive)" = "root 700" ]'
check "첫 백업에는 첫 시점 방송 목록" same "$ROOMS1" "$(dx "tar -xzOf '$B1' dolive/config/rooms.txt | sha256sum")"
check "둘째 백업에는 둘째 시점 방송 목록" same "$ROOMS2" "$(dx "tar -xzOf '$B2' dolive/config/rooms.txt | sha256sum")"
check "백업에 설정·방송 목록·인증서·코드 판" dxq "tar -tzf '$B1' | grep -q dolive/etc/dolive.env && tar -tzf '$B1' | grep -q dolive/config/rooms.txt && tar -tzf '$B1' | grep -q 'dolive/caddy/.*\.crt' && [ \"\$(tar -xzOf '$B1' dolive/commit.txt | wc -c)\" = 41 ]"
N0=$(dx 'ls /var/backups/dolive | grep -c "^dolive-backup-.*\.tar\.gz$"')
check "첫 백업으로 restore" dxq "dolivectl restore '$B1'"
check "첫 시점 방송 목록으로 되살아남" same "$ROOMS1" "$(file_hash /opt/dolive/server/config/rooms.txt)"
PRE1=$(dx 'ls -t /var/backups/dolive/dolive-backup-*.tar.gz | head -n 1')
check "복원 직전 자동 백업이 새 파일로 추가됨 (덮어쓰지 않음)" bash -c '[ "$2" = $(($1 + 1)) ]' _ "$N0" "$(dx 'ls /var/backups/dolive | grep -c "^dolive-backup-.*\.tar\.gz$"')"
check "복원 직전 자동 백업에는 복원 전(둘째 시점) 목록" same "$ROOMS2" "$(dx "tar -xzOf '$PRE1' dolive/config/rooms.txt | sha256sum")"
check "둘째 백업으로 restore" dxq "dolivectl restore '$B2'"
check "둘째 시점 방송 목록으로 되살아남" same "$ROOMS2" "$(file_hash /opt/dolive/server/config/rooms.txt)"
check "첫 백업 파일은 그대로 (내용 유지)" same "$ROOMS1" "$(dx "tar -xzOf '$B1' dolive/config/rooms.txt | sha256sum")"
dxq "dolivectl restore '$B1'"
check "복원 뒤 rooms.txt 소유자 dolive" dxq '[ "$(stat -c %U /opt/dolive/server/config/rooms.txt)" = dolive ]'
check "복원 뒤 인증서 그대로 (새로 받지 않음)" same "$CERT" "$(certs)"
check "복원 뒤 정상" dxq 'dolivectl health'
# 이미 있는 다른 사람 폴더: 소유자·권한·다른 파일을 바꾸지 않는다
dx 'install -d -o tunnel -g tunnel -m 0755 /srv/bk && echo 보존 > /srv/bk/keep.txt && chown tunnel:tunnel /srv/bk/keep.txt'
BK_META=$(dx 'stat -c "%U:%G %a" /srv/bk; sha256sum /srv/bk/keep.txt; stat -c "%U:%G %a" /srv/bk/keep.txt')
B3=$(dx 'dolivectl backup /srv/bk' | sed -n 's/.*백업: //p' | tail -n 1)
check "기존 폴더에 백업 (파일 root 600)" dxq "[ \"\$(stat -c '%U %a' '$B3')\" = 'root 600' ] && [ \"\$(dirname '$B3')\" = /srv/bk ]"
check "기존 폴더의 소유자·권한·다른 파일 그대로" same "$BK_META" "$(dx 'stat -c "%U:%G %a" /srv/bk; sha256sum /srv/bk/keep.txt; stat -c "%U:%G %a" /srv/bk/keep.txt')"
check "새 폴더는 root 700 으로 만듦" dxq 'dolivectl backup /srv/new/a/b && [ "$(stat -c "%U %a" /srv/new/a/b)" = "root 700" ]'
CODE_META=$(dx 'stat -c "%U:%G %a" /opt/dolive /opt/dolive/server')
check "코드 폴더를 백업 위치로 주면 거절" dxq '! dolivectl backup /opt/dolive/server'
check "실행 계정 폴더·임시 폴더도 거절" dxq '! dolivectl backup /var/lib/dolive && ! dolivectl backup /tmp/x && ! dolivectl backup /etc/dolive'
check "거절한 코드 폴더 권한 그대로, 백업 파일 없음" bash -c '[ "$1" = "$2" ] && [ -z "$3" ]' _ "$CODE_META" "$(dx 'stat -c "%U:%G %a" /opt/dolive /opt/dolive/server')" "$(dx 'find /opt/dolive /var/lib/dolive /tmp /etc/dolive -name "dolive-backup-*" -o -name ".dolive-backup.*" 2>/dev/null')"
# 쓰는 중 공간이 모자라면 실패로 끝나고 반쪽 파일을 남기지 않는다
dx 'mkdir -p /srv/tiny && mount -t tmpfs -o size=64k tmpfs /srv/tiny && chmod 700 /srv/tiny && (dd if=/dev/zero of=/srv/tiny/filler bs=4k 2>/dev/null; true)'
check "공간 부족 백업은 실패로 보고" dxq '! dolivectl backup /srv/tiny'
check "실패한 백업은 파일을 남기지 않음" [ "$(dx 'ls -A /srv/tiny')" = filler ]
dxq 'umount /srv/tiny'

log "9. 새 서버로 옮기기: 모델 준비 → 복원(켜지 않음) → 새 IP → 켜기"
MOVE=$(dx 'dolivectl backup /root/move' | sed -n 's/.*백업: //p' | tail -n 1)
STATE_M=$(hash_state | grep -v 'models/supertonic')
ENV_M=$(file_hash /etc/dolive/dolive.env)
# 같은 컨테이너를 "새 서버"로 만든다: 끄고, 설정·방송 목록·운영진·인증서·적용 기록과 이전 IP 를 지우고, 모델 파일 하나를 지운다
dx "dolivectl stop >/dev/null; rm -rf /etc/dolive /var/lib/private/dolive-caddy /var/lib/dolive-caddy /var/lib/dolive-applied /var/backups/dolive /opt/dolive/server/config/rooms.txt /opt/dolive/server/config/staff.txt /opt/dolive/apps/web/models/supertonic/F2.json; ip addr del $IP3/32 dev eth0; ip addr add $IP4/32 dev eth0"
EXTRA_IPS="$IP4"
if dx "/opt/dolive/scripts/linux/dolive-install.sh --no-start --domain $DOMAIN --public-ip $IP4" >/dev/null; then pass "새 서버 설치 (--no-start, 모델 받기 포함)"; else fail "새 서버 설치 (--no-start)"; fi
check "설치 뒤 서비스는 켜지지 않음" none_active
check "모델 9개 파일 모두 체크섬 일치" dxq 'cd /opt/dolive && sed -E "s#  [^ ]*/#  #" server/linux/supertonic.sha256 | (cd apps/web/models/supertonic && sha256sum -c --quiet -)'
RESTORE=$(dx "dolivectl restore '$MOVE' --no-start" 2>&1); RESTORE_RC=$?
echo "$RESTORE" | sed 's/^/    /'
check "restore --no-start 성공" [ "$RESTORE_RC" = 0 ]
check "restore --no-start 뒤 서비스는 꺼진 채" none_active
check "옛 IP 를 되살리면 새 서버 IP 로 고치라고 알림" grep -q "새 서버로 옮겼다면" <<< "$RESTORE"
check "설정·방송 목록·운영진·인증서 되살아남" same "$STATE_M" "$(hash_state | grep -v 'models/supertonic')"
check "되살린 설정 파일은 백업과 같음 (옛 IP)" same "$ENV_M" "$(file_hash /etc/dolive/dolive.env)"
dx "sed -i 's/^DOLIVE_PUBLIC_IP=.*/DOLIVE_PUBLIC_IP=$IP4/' /etc/dolive/dolive.env"
PUB=$IP4; set_net # DNS A 레코드를 새 IP 로 바꾼 것과 같다
check "새 IP 로 켜기 (dolivectl start)" dxq 'dolivectl start'
check "실행 중 LiveKit 이 새 공인 IP $IP4 사용" same "$(livekit_ip)" "$IP4"
check "인증서를 새로 받지 않고 되살린 것 사용" same "$CERT" "$(certs)"
DOC=$(dx 'dolivectl doctor'); DOC_RC=$?
check "옮긴 뒤 doctor 끝 코드 0 (실제 $DOC_RC)" [ "$DOC_RC" = 0 ]
SELF=$(dx 'dolivectl selftest' 2>&1); SELF_RC=$?
check "옮긴 뒤 selftest (글 읽기·서버 안·바깥 wss 경로, 실제 $SELF_RC)" [ "$SELF_RC" = 0 ]
T_ALL="$(active_since livekit) $(active_since web) $(active_since caddy)"
dxq '/opt/dolive/scripts/linux/dolive-install.sh'
check "옮긴 뒤 변경 없는 설치는 다시 켜지 않음" same "$T_ALL" "$(active_since livekit) $(active_since web) $(active_since caddy)"

log "10. 업데이트 성공"
dx 'cd /tmp && rm -rf up && git clone -q /srv/origin.git up && cd up && echo "<!-- 시험 업데이트 -->" >> README.md && git -c user.name=t -c user.email=t@invalid commit -qam "시험 업데이트" && git push -q origin main'
NEW=$(dx 'git -C /srv/origin.git rev-parse main')
if dx 'dolivectl update'; then pass "update"; else fail "update"; fi
check "새 코드로 바뀜" same "$(dx 'runuser -u dolive -- git -C /opt/dolive rev-parse HEAD')" "$NEW"
check "업데이트 뒤 정상" dxq 'dolivectl health'
check "업데이트 뒤 설정 유지" dxq "grep -q '^DOLIVE_DOMAIN=$DOMAIN$' /etc/dolive/dolive.env && grep -q '^DOLIVE_PUBLIC_IP=$IP4$' /etc/dolive/dolive.env"

log "11. 업데이트 실패 → 이전 코드로 되돌림"
dx 'cd /tmp/up && echo "export default function Broken( {" > apps/web/app/broken-test.tsx && git add -A && git -c user.name=t -c user.email=t@invalid commit -qm "깨진 시험 커밋" && git push -q origin main'
if dx 'dolivectl update'; then fail "깨진 업데이트가 실패로 끝나야 함"; else pass "깨진 업데이트는 실패로 보고"; fi
check "이전 코드로 되돌림" same "$(dx 'runuser -u dolive -- git -C /opt/dolive rev-parse HEAD')" "$NEW"
check "되돌린 뒤 정상" dxq 'dolivectl health --wait 90'
check "되돌린 뒤 작업 폴더 깨끗" [ -z "$(dx 'runuser -u dolive -- git -C /opt/dolive status --porcelain --untracked-files=no')" ]

log "12. systemd 설정 검사와 외부 발급처"
check "systemd-analyze verify" dxq 'systemd-analyze verify /etc/systemd/system/dolive.target /etc/systemd/system/dolive-livekit.service /etc/systemd/system/dolive-web.service /etc/systemd/system/dolive-caddy.service'
dx 'systemd-analyze security dolive-web dolive-livekit dolive-caddy --no-pager 2>/dev/null | tail -n 4' || true
check "끝까지 외부 ACME 발급처 기록 없음 (Caddy 기록)" dxq '! journalctl -u dolive-caddy --no-pager | grep -qi "acme-v02\|acme-staging\|zerossl\|letsencrypt"'
check "ACME 계정·주문 저장소가 생기지 않음" dxq '[ -d /var/lib/private/dolive-caddy/caddy/pki/authorities/local ] && [ ! -e /var/lib/private/dolive-caddy/caddy/acme ]'

log "13. 윈도우에서 옮긴 기존 통화 키(이름이 dolive 가 아님)를 그대로 이어 쓰기"
# 실제 .env.local 은 쓰지 않는다. 컨테이너 안에서 새로 만든 시험용 키 이름과 임의 비밀값으로 윈도우의 .env.local(CRLF 줄 끝)을 흉내 낸다.
# 비밀값은 컨테이너 밖으로 꺼내지 않고 해시끼리만 비교한다. 인증서는 남겨 둔다 (시험 CA 를 다시 믿게 할 필요 없음)
MIG_KEY=migration_test_key
legacy_env() { # 비밀값 파일 → .env.local
  dx "printf 'LIVEKIT_API_KEY=$MIG_KEY\r\nLIVEKIT_API_SECRET=%s\r\nDORMS_CLIENT_ID=%s\r\nDORMS_SITE_URL=https://$DOMAIN\r\n' \"\$(cat $1)\" \"\$(cat /proc/sys/kernel/random/uuid)\" > /opt/dolive/apps/web/.env.local && chown dolive:dolive /opt/dolive/apps/web/.env.local"
}
# 설정 파일·실행 중 LiveKit 의 비밀값 해시 (값은 출력하지 않음)
env_secret_hash() { dx 'printf %s "$(sed -n "s/^LIVEKIT_API_SECRET=//p" /etc/dolive/dolive.env)" | sha256sum'; }
lk_keys_hash() { dx 'tr "\0" "\n" < /proc/$(pgrep -x livekit-server)/environ | sed -n "s/^LIVEKIT_KEYS=//p" | tr -d "\n" | sha256sum'; }
dx "dolivectl stop >/dev/null; rm -rf /etc/dolive /var/lib/dolive-applied; install -d -m 700 /root/mig"
# 비밀값에 + / = 가 들어가도록 base64 로 만든다 (44자)
dx 'head -c 32 /dev/urandom | base64 | tr -d "\n" > /root/mig/secret; printf "\"%s\": \"%s\"" migration_test_key "$(cat /root/mig/secret)" > /root/mig/keys'
SECRET_H=$(dx 'sha256sum < /root/mig/secret'); KEYS_H=$(dx 'sha256sum < /root/mig/keys')

# 먼저: 따옴표가 섞인 비밀값은 가져오지 않고 멈춘다 (설정 파일을 만들지 않음)
dx 'printf "%s\"x" "$(cat /root/mig/secret)" > /root/mig/bad'
legacy_env /root/mig/bad
BAD_OUT=$(dx "/opt/dolive/scripts/linux/dolive-install.sh --no-start --domain $DOMAIN --public-ip $IP4" 2>&1); BAD_RC=$?
check "쓸 수 없는 글자가 든 기존 비밀값은 설치를 멈춤 (실제 끝 코드 $BAD_RC)" bash -c '[ "$1" != 0 ] && grep -q "LIVEKIT_API_SECRET 에 쓸 수 없는 글자" <<< "$2"' _ "$BAD_RC" "$BAD_OUT"
check "멈춘 설치는 설정 파일을 만들지 않음" dxq '[ ! -e /etc/dolive/dolive.env ] && [ -z "$(ls -A /etc/dolive 2>/dev/null)" ]'
check "멈춘 설치의 화면 기록에 비밀값 없음" bash -c '! grep -qF -- "$1" <<< "$2"' _ "$(dx 'cut -c1-20 /root/mig/bad')" "$BAD_OUT"

legacy_env /root/mig/secret
LEGACY_H=$(file_hash /opt/dolive/apps/web/.env.local)
if dx "/opt/dolive/scripts/linux/dolive-install.sh --domain $DOMAIN --public-ip $IP4" >/dev/null; then pass "기존 .env.local 로 설치"; else fail "기존 .env.local 로 설치"; fi
check "설정 파일 키 이름 = 기존 이름 $MIG_KEY (dolive 로 바꾸지 않음)" dxq "grep -qx 'LIVEKIT_API_KEY=$MIG_KEY' /etc/dolive/dolive.env"
check "설정 파일 비밀값 = 기존 비밀값 (해시 비교)" same "$(env_secret_hash)" "$SECRET_H"
check "가져온 .env.local 내용은 그대로" same "$LEGACY_H" "$(file_hash /opt/dolive/apps/web/.env.local)"
check "설정 파일 권한 root:dolive 640" dxq '[ "$(stat -c "%U:%G %a" /etc/dolive/dolive.env)" = "root:dolive 640" ]'
check "세 서비스 실행 중" all_units is-active "dolive-livekit dolive-web dolive-caddy"
check "health 정상" dxq 'dolivectl health'
check "LiveKit 입장권 키 = 기존 이름·비밀값 (LIVEKIT_KEYS 해시)" same "$(lk_keys_hash)" "$KEYS_H"
check "LiveKit 퇴장 알림 키 = $MIG_KEY" same "$(livekit_env LIVEKIT_WEBHOOK_API_KEY)" "$MIG_KEY"
check "LiveKit 에 비밀값 변수를 넘기지 않음" [ -z "$(livekit_env LIVEKIT_API_SECRET)" ]
check "LiveKit 명령줄에 키 이름·비밀값 없음" dxq '! ps -eo args | grep -v grep | grep -F -e "$(cat /root/mig/secret)" -e migration_test_key'
check "server/linux/livekit.yaml 에 키 이름·비밀값 없음" dxq '! grep -qF -e "$(cat /root/mig/secret)" -e migration_test_key -e "api_key:" /opt/dolive/server/linux/livekit.yaml'
DOC=$(dx 'dolivectl doctor'); DOC_RC=$?
check "옮긴 키로 doctor 끝 코드 0 (실제 $DOC_RC)" bash -c '[ "$1" = 0 ] && ! grep -q "LIVEKIT_API" <<< "$2"' _ "$DOC_RC" "$DOC"
SELF=$(dx 'dolivectl selftest' 2>&1); SELF_RC=$?
echo "$SELF" | sed 's/^/    /'
check "옮긴 키: selftest 네 목소리 WAV" bash -c '[ "$(grep -c "\[ OK \] 글 읽기 목소리" <<< "$1")" = 4 ]' _ "$SELF"
check "옮긴 키: 마지막 퇴장 webhook 으로 빈 방 정리 (서버 안 경로)" grep -q "통과: 한 명 남으면 기록 유지, 마지막 퇴장 때 글·사진 삭제" <<< "$SELF"
check "옮긴 키: wss://$DOMAIN WebSocket·참여자 연결" grep -q "통과: wss://$DOMAIN WebSocket 업그레이드와 LiveKit 참여자 연결" <<< "$SELF"
check "옮긴 키: wss://$DOMAIN SDK 입장·퇴장" grep -q "통과: wss://$DOMAIN SDK 입장·퇴장" <<< "$SELF"
check "옮긴 키: selftest 끝 코드 0 (실제 $SELF_RC)" [ "$SELF_RC" = 0 ]
check "selftest 화면 기록에 비밀값 없음" bash -c '! grep -qF -- "$1" <<< "$2"' _ "$(dx 'cut -c1-20 /root/mig/secret')" "$SELF"

# 다시 설치: .env.local 이 바뀌어 있어도 이미 있는 설정 파일을 덮어쓰지 않고, 아무것도 다시 켜지 않는다
ENV_H=$(file_hash /etc/dolive/dolive.env)
T_ALL="$(active_since livekit) $(active_since web) $(active_since caddy)"
dx 'head -c 32 /dev/urandom | base64 | tr -d "\n" > /root/mig/other'
legacy_env /root/mig/other
if dx '/opt/dolive/scripts/linux/dolive-install.sh' >/dev/null; then pass "옮긴 뒤 다시 설치"; else fail "옮긴 뒤 다시 설치"; fi
check "다시 설치: 설정 파일 그대로 (바뀐 .env.local 을 다시 읽지 않음)" same "$ENV_H" "$(file_hash /etc/dolive/dolive.env)"
check "다시 설치: 서비스를 다시 켜지 않음" same "$T_ALL" "$(active_since livekit) $(active_since web) $(active_since caddy)"
check "다시 설치: LiveKit 키 그대로" same "$(lk_keys_hash)" "$KEYS_H"

log "13-2. 옮긴 키로 재부팅"
docker restart "$C" >/dev/null
wait_systemd || true
set_net
check "재부팅 뒤 모두 정상" dxq 'dolivectl health --wait 120'
check "재부팅 뒤 설정 파일 그대로" same "$ENV_H" "$(file_hash /etc/dolive/dolive.env)"
check "재부팅 뒤 LiveKit 입장권 키 그대로" same "$(lk_keys_hash)" "$KEYS_H"
check "재부팅 뒤 LiveKit 퇴장 알림 키 그대로" same "$(livekit_env LIVEKIT_WEBHOOK_API_KEY)" "$MIG_KEY"
SELF=$(dx 'dolivectl selftest' 2>&1); SELF_RC=$?
check "재부팅 뒤 selftest (네 목소리·빈 방 정리·wss 입장·퇴장, 실제 $SELF_RC)" bash -c '[ "$1" = 0 ] && [ "$(grep -c "\[ OK \] 글 읽기 목소리" <<< "$2")" = 4 ] && grep -q "마지막 퇴장 때 글·사진 삭제" <<< "$2" && grep -q "SDK 입장·퇴장" <<< "$2"' _ "$SELF_RC" "$SELF"

log "13-3. 설정 파일 키에 쓸 수 없는 글자가 들어가면 LiveKit 은 설정 오류로 멈춤"
dx 'cp -p /etc/dolive/dolive.env /root/mig/env.good && sed -i "s/^LIVEKIT_API_KEY=.*/LIVEKIT_API_KEY=\"bad key#1\"/" /etc/dolive/dolive.env'
dx 'systemctl restart dolive-livekit' >/dev/null 2>&1; sleep 8
check "LiveKit 끝 코드 78 (설정 오류), 다시 켜기 반복 없음" dxq '[ "$(systemctl show -p ExecMainStatus --value dolive-livekit)" = 78 ] && ! systemctl is-active --quiet dolive-livekit && [ "$(systemctl show -p NRestarts --value dolive-livekit)" = 0 ]'
check "LiveKit 기록에 원인 안내" dxq 'journalctl -u dolive-livekit --no-pager -n 20 | grep -q "LIVEKIT_API_KEY 에는 영문·숫자"'
DOC=$(dx 'dolivectl doctor'); DOC_RC=$?
check "doctor 도 키 형식을 실패로 잡음 (실제 $DOC_RC)" bash -c '[ "$1" = 1 ] && grep -q "LIVEKIT_API_KEY 에는 영문·숫자" <<< "$2"' _ "$DOC_RC" "$DOC"
dx 'cp -p /root/mig/env.good /etc/dolive/dolive.env && systemctl restart dolive-livekit'
check "설정을 되돌리면 정상" dxq 'dolivectl health --wait 60'
check "되돌린 설정 파일은 원래와 같음" same "$ENV_H" "$(file_hash /etc/dolive/dolive.env)"
dxq 'rm -rf /root/mig'

if [ "$KEEP" -eq 0 ]; then
  docker rm -f "$C" >/dev/null 2>&1
  BINFMT_AFTER=$(binfmt_list)
  echo "  시험 뒤 binfmt: $BINFMT_AFTER"
  check "Docker VM binfmt 등록이 시험 전과 같음" same "$BINFMT_BEFORE" "$BINFMT_AFTER"
else
  echo "  --keep: 컨테이너를 남겨 binfmt 비교는 하지 않았어요"
fi

log "결과: 통과 $PASS, 실패 $FAIL ($ARCH, context $CTX)"
for f in "${FAILED[@]}"; do echo "  - $f"; done
[ "$KEEP" -eq 1 ] && echo "  컨테이너를 남겼어요: DOCKER_CONTEXT=$CTX docker rm -f $C"
[ "$FAIL" -eq 0 ]
