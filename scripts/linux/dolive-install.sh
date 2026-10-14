#!/usr/bin/env bash
# DOLIVE Linux 설치·다시 설치 (Ubuntu 24.04 LTS, x86-64 DigitalOcean Droplet 기준). root 로 실행한다.
#   sudo /opt/dolive/scripts/linux/dolive-install.sh
# 몇 번을 다시 실행해도 된다. 이미 있는 비밀 설정(/etc/dolive/dolive.env), 방송 목록·운영진(server/config),
# 모델 파일, 인증서는 덮어쓰지 않는다. 바뀐 것이 없으면 실행 중인 서버를 다시 켜지 않는다.
# 앞선 실행이 중간에 실패했으면, 파일만 바뀌고 다시 켜지 못한 서비스를 이번에 다시 켠다 (applied-state.sh).
# 자세한 안내: docs/linux/README.md
set -euo pipefail
umask 022

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WEB=$ROOT/apps/web
BIN=$ROOT/server/bin
ENV_DIR=/etc/dolive
ENV_FILE=$ENV_DIR/dolive.env
SVC_USER=dolive
STATE=/var/lib/dolive
UNIT_DIR=/etc/systemd/system
SERVICES=(dolive-livekit dolive-web dolive-caddy)

usage() {
  cat <<'EOF'
사용법: sudo scripts/linux/dolive-install.sh [선택]
  --domain 이름          참가자 주소 (예: live.example.com). 설정 파일을 처음 만들 때만 쓴다
  --public-ip IPv4       드롭릿 고정 공인 IP. 설정 파일을 처음 만들 때만 쓴다
  --dorms-client-id ID   도름스 사이트 식별값. 설정 파일을 처음 만들 때만 쓴다 (나중에 직접 넣어도 됨)
  --build                웹 화면을 반드시 다시 만든다
  --skip-models          글 읽기 모델을 받지 않는다 (나중에 직접 복사할 때)
  --repair-models        체크섬이 다른 모델 파일을 옆에 보관하고 공식 파일로 다시 받는다
  --no-start             설치만 하고 서버를 켜거나 다시 켜지 않는다 (바뀐 내용은 다음 켜기·설치 때 적용)
  -h, --help             이 안내
EOF
}

say() { printf '  %s\n' "$*"; }
ok() { printf '  [ OK ] %s\n' "$*"; }
warn() { printf '  [주의] %s\n' "$*" >&2; }
DIED=0
die() { printf '  [실패] %s\n' "$*" >&2; DIED=1; exit 1; }
TMP=''
on_exit() {
  local rc=$?
  [ -n "$TMP" ] && rm -rf "$TMP"
  if [ "$rc" -ne 0 ] && [ "$DIED" -eq 0 ]; then
    printf '  [실패] 설치가 중간에 멈췄어요. 위의 기록을 확인한 뒤 다시 실행해 주세요 (다시 실행해도 안전합니다)\n' >&2
  fi
}
trap on_exit EXIT

DOMAIN_ARG='' IP_ARG='' DORMS_ARG='' FORCE_BUILD=0 SKIP_MODELS=0 REPAIR_MODELS=0 NO_START=0
while [ $# -gt 0 ]; do
  case $1 in
    --domain) DOMAIN_ARG=${2:-}; shift 2 ;;
    --public-ip) IP_ARG=${2:-}; shift 2 ;;
    --dorms-client-id) DORMS_ARG=${2:-}; shift 2 ;;
    --build) FORCE_BUILD=1; shift ;;
    --skip-models) SKIP_MODELS=1; shift ;;
    --repair-models) REPAIR_MODELS=1; shift ;;
    --no-start) NO_START=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "모르는 선택: $1" ;;
  esac
done

# 어느 서비스를 다시 켜야 하는지는 "켜질 때 읽는 파일"의 지문과 마지막으로 정상 기동한 지문을 비교해 정한다
DOLIVE_ROOT=$ROOT
# shellcheck source=applied-state.sh
. "$ROOT/scripts/linux/applied-state.sh"

# ONNXRUNTIME_NODE_INSTALL=skip: x86-64 에서 onnxruntime-node 가 GPU(CUDA)용 부품 약 260MB 를 따로 받는 것을 막는다.
# DOLIVE 글 읽기는 CPU 로만 돌고, CPU 용 부품은 npm 패키지에 들어 있다
as_dolive() { runuser -u "$SVC_USER" -- env HOME="$STATE" PATH="$BIN/node/bin:/usr/local/bin:/usr/bin:/bin" npm_config_cache="$STATE/.npm" NEXT_TELEMETRY_DISABLED=1 ONNXRUNTIME_NODE_INSTALL=skip "$@"; }
sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
valid_domain() { [[ $1 =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]; }
valid_ipv4() {
  [[ $1 =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  local n; for n in "${BASH_REMATCH[@]:1}"; do [ "$n" -le 255 ] || return 1; done
}
env_value() { [ -f "$2" ] || return 0; sed -n "s/^[[:space:]]*$1=//p" "$2" | tail -n 1 | tr -d '\r'; }
# 통화 서버 키에 쓸 수 있는 글자 (scripts/linux/run-livekit.sh 와 같은 기준. 설정 파일을 셸·YAML 로 읽어도 뜻이 바뀌지 않는다)
valid_lk_key() { [[ $1 =~ ^[A-Za-z0-9._-]+$ ]]; }
valid_lk_secret() { [[ $1 =~ ^[A-Za-z0-9._~+/=-]+$ ]]; }

# ---------------------------------------------------------------- 0. 확인
check_host() {
  [ "$(id -u)" -eq 0 ] || die "root 권한이 필요해요. 앞에 sudo 를 붙여 실행해 주세요"
  [ "$(uname -s)" = Linux ] || die "Linux 에서만 실행해요"
  [ -d /run/systemd/system ] || die "systemd 로 켜진 서버가 아니에요"
  case $ROOT in
    *[[:space:]]*) die "설치 폴더 경로에 빈칸이 있으면 안 돼요: $ROOT" ;;
    /home/*|/root/*|/root|/run/user/*) die "설치 폴더는 /opt/dolive 처럼 /home 밖에 두세요 (서비스 보호 설정이 /home 을 막습니다): $ROOT" ;;
  esac
  [ -f "$WEB/package.json" ] && [ -f "$ROOT/server/linux/versions.env" ] || die "DOLIVE 폴더가 아니에요: $ROOT"
  # shellcheck source=/dev/null
  . /etc/os-release
  if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID:-}" != 24.04 ]; then
    warn "Ubuntu 24.04 LTS 에서 확인한 설치예요. 지금은 ${PRETTY_NAME:-알 수 없음} 입니다"
  fi
  case $(uname -m) in
    x86_64) ARCH_NODE=x64 ARCH_GO=amd64 ;;
    aarch64) ARCH_NODE=arm64 ARCH_GO=arm64; warn "ARM64 는 시험용으로만 확인했어요. 운영은 x86-64 를 권장합니다" ;;
    *) die "지원하지 않는 CPU 종류: $(uname -m)" ;;
  esac
  # shellcheck source=/dev/null
  . "$ROOT/server/linux/versions.env"
  ok "확인: $ROOT ($(uname -m))"
}

# ---------------------------------------------------------------- 1. 꼭 필요한 기본 도구만
ensure_tools() {
  local need=() tool pkg
  for pair in curl:curl xz:xz-utils tar:tar sha256sum:coreutils runuser:util-linux git:git; do
    tool=${pair%%:*} pkg=${pair#*:}
    command -v "$tool" >/dev/null 2>&1 || need+=("$pkg")
  done
  [ -f /etc/ssl/certs/ca-certificates.crt ] || need+=(ca-certificates)
  if [ ${#need[@]} -gt 0 ]; then
    say "없는 기본 도구만 설치해요: ${need[*]}"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${need[@]}"
  fi
  ok "기본 도구"
}

# ---------------------------------------------------------------- 2. 전용 실행 계정
ensure_user() {
  if ! getent passwd "$SVC_USER" >/dev/null; then
    useradd --system --user-group --home-dir "$STATE" --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
    say "실행 계정 $SVC_USER 를 만들었어요 (로그인 불가 계정)"
  fi
  install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 "$STATE"
  # 코드는 dolive 계정이 고친다(업데이트·빌드). 실행 중인 서비스에는 systemd 가 읽기 전용으로 보여 준다
  chown -R "$SVC_USER:$SVC_USER" "$ROOT"
  ok "실행 계정 $SVC_USER"
}

# ---------------------------------------------------------------- 3. 프로그램 받기 (체크섬 확인)
fetch() { # 주소 받을파일 sha256
  local url=$1 out=$2 want=$3 got
  curl -fL --retry 3 --connect-timeout 20 -o "$out" "$url" || die "받기 실패: $url"
  got=$(sha256_of "$out")
  [ "$got" = "$want" ] || die "체크섬이 달라요 ($url). 받은 파일을 쓰지 않았어요. 기대 $want, 실제 $got"
}

install_programs() {
  TMP=$(mktemp -d /var/tmp/dolive-install.XXXXXX)
  install -d -m 0755 "$BIN" "$BIN/.versions"
  local want sha dir

  # Node.js (이 폴더 안에만 둔다. 서버 전체의 node 는 건드리지 않는다)
  sha=NODE_SHA256_${ARCH_NODE^^}; sha=${!sha}
  want="$NODE_VERSION $sha"
  if [ "$(cat "$BIN/.versions/node" 2>/dev/null)" != "$want" ] || [ ! -x "$BIN/node/bin/node" ]; then
    dir=node-v$NODE_VERSION-linux-$ARCH_NODE
    fetch "https://nodejs.org/dist/v$NODE_VERSION/$dir.tar.xz" "$TMP/node.tar.xz" "$sha"
    rm -rf "${BIN:?}/$dir.new" && mkdir "$BIN/$dir.new"
    tar -xJf "$TMP/node.tar.xz" -C "$BIN/$dir.new" --strip-components=1
    rm -rf "${BIN:?}/$dir" && mv "$BIN/$dir.new" "$BIN/$dir"
    ln -sfn "$dir" "$BIN/node"
    echo "$want" > "$BIN/.versions/node"
    say "Node.js $NODE_VERSION 를 받았어요"
  fi
  [ "$("$BIN/node/bin/node" --version)" = "v$NODE_VERSION" ] || die "Node.js 버전 확인 실패"

  # LiveKit
  sha=LIVEKIT_SHA256_${ARCH_GO^^}; sha=${!sha}
  want="$LIVEKIT_VERSION $sha"
  if [ "$(cat "$BIN/.versions/livekit" 2>/dev/null)" != "$want" ] || [ ! -x "$BIN/livekit-server" ]; then
    fetch "https://github.com/livekit/livekit/releases/download/v$LIVEKIT_VERSION/livekit_${LIVEKIT_VERSION}_linux_$ARCH_GO.tar.gz" "$TMP/livekit.tar.gz" "$sha"
    mkdir "$TMP/livekit" && tar -xzf "$TMP/livekit.tar.gz" -C "$TMP/livekit"
    install -m 0755 "$TMP/livekit/livekit-server" "$BIN/livekit-server.new" && mv -f "$BIN/livekit-server.new" "$BIN/livekit-server"
    echo "$want" > "$BIN/.versions/livekit"
    say "LiveKit $LIVEKIT_VERSION 를 받았어요"
  fi
  [[ $("$BIN/livekit-server" --version) == *"$LIVEKIT_VERSION"* ]] || die "LiveKit 버전 확인 실패"

  # Caddy
  sha=CADDY_SHA256_${ARCH_GO^^}; sha=${!sha}
  want="$CADDY_VERSION $sha"
  if [ "$(cat "$BIN/.versions/caddy" 2>/dev/null)" != "$want" ] || [ ! -x "$BIN/caddy" ]; then
    fetch "https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION/caddy_${CADDY_VERSION}_linux_$ARCH_GO.tar.gz" "$TMP/caddy.tar.gz" "$sha"
    local sha512=CADDY_SHA512_${ARCH_GO^^}
    [ "$(sha512sum "$TMP/caddy.tar.gz" | cut -d' ' -f1)" = "${!sha512}" ] || die "Caddy SHA-512 체크섬이 달라요"
    mkdir "$TMP/caddy" && tar -xzf "$TMP/caddy.tar.gz" -C "$TMP/caddy"
    install -m 0755 "$TMP/caddy/caddy" "$BIN/caddy.new" && mv -f "$BIN/caddy.new" "$BIN/caddy"
    echo "$want" > "$BIN/.versions/caddy"
    say "Caddy $CADDY_VERSION 를 받았어요"
  fi
  [[ $("$BIN/caddy" version) == "v$CADDY_VERSION"* ]] || die "Caddy 버전 확인 실패"
  ok "프로그램: Node.js $NODE_VERSION, LiveKit $LIVEKIT_VERSION, Caddy $CADDY_VERSION"
}

# ---------------------------------------------------------------- 4. 글 읽기 모델 (Supertonic 3)
install_models() {
  local dir=$WEB/models/supertonic want path name got bad=0
  if [ "$SKIP_MODELS" -eq 1 ]; then warn "모델 받기를 건너뛰었어요. $dir 에 직접 복사해야 글 읽기가 됩니다"; return; fi
  install -d -m 0755 "$dir"
  while read -r want path; do
    [ -n "$path" ] || continue
    name=${path##*/}
    if [ -f "$dir/$name" ]; then
      got=$(sha256_of "$dir/$name")
      [ "$got" = "$want" ] && continue
      if [ "$REPAIR_MODELS" -eq 0 ]; then
        warn "모델 파일 $name 의 체크섬이 고정 버전과 달라요. 덮어쓰지 않았어요 (고치려면 --repair-models)"
        bad=1; continue
      fi
      mv "$dir/$name" "$dir/$name.bak-$(date +%Y%m%d-%H%M%S)"
    fi
    say "모델 받는 중: $name"
    fetch "https://huggingface.co/$SUPERTONIC_REPO/resolve/$SUPERTONIC_REVISION/$path" "$dir/$name.part" "$want"
    mv "$dir/$name.part" "$dir/$name"
  done < "$ROOT/server/linux/supertonic.sha256"
  chown -R "$SVC_USER:$SVC_USER" "$WEB/models"
  [ "$bad" -eq 0 ] && ok "글 읽기 모델 (Supertonic 3 ${SUPERTONIC_REVISION:0:8})" || warn "글 읽기 모델 일부가 고정 버전과 다릅니다"
}

# ---------------------------------------------------------------- 5. 설정 파일 (처음 한 번만 만든다)
ask() { # 질문 기본값 → 답
  local reply=''
  [ -r /dev/tty ] || die "$1 값이 필요해요. --domain / --public-ip 로 넘겨 주세요"
  read -r -p "  $1${2:+ [$2]}: " reply < /dev/tty || true
  printf '%s' "${reply:-$2}"
}

ensure_env() {
  install -d -o root -g "$SVC_USER" -m 0750 "$ENV_DIR"
  if [ -f "$ENV_FILE" ]; then
    chown root:"$SVC_USER" "$ENV_FILE"; chmod 0640 "$ENV_FILE"
    ok "설정 파일 유지: $ENV_FILE (덮어쓰지 않음)"
    return
  fi
  local legacy=$WEB/.env.local domain ip guess secret key dorms
  domain=$DOMAIN_ARG
  [ -n "$domain" ] || domain=$(ask "참가자가 열 주소(도메인, https:// 없이)" "")
  domain=${domain,,}
  valid_domain "$domain" || die "도메인 형식이 아니에요: $domain"
  ip=$IP_ARG
  if [ -z "$ip" ]; then
    guess=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -vE '^(10|127)\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.' | head -n 1 || true)
    ip=$(ask "드롭릿 고정 공인 IPv4 (DNS A 레코드와 같은 값)" "$guess")
  fi
  valid_ipv4 "$ip" || die "IPv4 형식이 아니에요: $ip"
  # 윈도우 서버에서 옮겨 온 apps/web/.env.local 이 있으면 같은 키 이름·비밀값과 도름스 값을 이어 쓴다.
  # 키 이름이 dolive 가 아니어도 바꾸지 않는다 (LiveKit 은 run-livekit.sh 가 같은 이름으로 켠다)
  key=$(env_value LIVEKIT_API_KEY "$legacy"); secret=$(env_value LIVEKIT_API_SECRET "$legacy")
  dorms=${DORMS_ARG:-$(env_value DORMS_CLIENT_ID "$legacy")}
  if [ -n "$secret" ]; then
    [ -n "$key" ] || key=dolive
    # 값은 화면에 보이지 않게 한다
    valid_lk_key "$key" || die "apps/web/.env.local 의 LIVEKIT_API_KEY 에 쓸 수 없는 글자가 있어요 (영문·숫자와 . _ - 만). 고친 뒤 다시 실행해 주세요"
    valid_lk_secret "$secret" || die "apps/web/.env.local 의 LIVEKIT_API_SECRET 에 쓸 수 없는 글자(따옴표·빈칸 등)가 있어요 (영문·숫자와 . _ ~ + / = - 만). 고친 뒤 다시 실행해 주세요"
    say "기존 apps/web/.env.local 의 통화 서버 키(이름·비밀값 그대로)와 도름스 값을 가져왔어요"
  else
    key=dolive
    secret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  fi
  local tmp; tmp=$(mktemp "$ENV_DIR/.dolive.env.XXXXXX")
  cat > "$tmp" <<EOF
# DOLIVE Linux 설정 ($(date +%F) 설치 스크립트가 만듦). 설명은 server/linux/dolive.env.example
DOLIVE_DOMAIN=$domain
DOLIVE_PUBLIC_IP=$ip
LIVEKIT_PUBLIC_URL=wss://$domain
LIVEKIT_API_KEY=$key
LIVEKIT_API_SECRET=$secret
DORMS_CLIENT_ID=$dorms
DORMS_SITE_URL=https://$domain
EOF
  chown root:"$SVC_USER" "$tmp"; chmod 0640 "$tmp"
  mv -n "$tmp" "$ENV_FILE"; rm -f "$tmp"
  [ -n "$dorms" ] || warn "DORMS_CLIENT_ID 가 비어 있어요. 도름스 로그인 전에 $ENV_FILE 에 넣고 'sudo dolivectl restart' 하세요"
  ok "설정 파일을 만들었어요: $ENV_FILE"
}

protect_config() {
  # 비밀값·방 비밀번호가 든 파일은 실행 계정만 읽는다. 내용·존재는 바꾸지 않는다
  local f
  for f in "$ROOT/server/config/livekit.yaml" "$ROOT/server/config/duckdns.env" "$ROOT/server/config/rooms.txt" "$WEB/.env.local"; do
    [ -f "$f" ] && chmod 0600 "$f"
  done
  ok "방송 목록·운영진·기존 설정 유지 (server/config)"
}

# ---------------------------------------------------------------- 6. 설치 부품과 웹 화면
web_active() { systemctl is-active --quiet dolive-web; }
stop_web_for_change() {
  if web_active; then
    warn "웹 화면을 바꾸는 동안 잠시 끕니다 (방 안 사람들은 다시 들어와야 할 수 있어요)"
    curl -fsS -m 3 -X POST http://127.0.0.1:3000/api/end >/dev/null 2>&1 || true
    systemctl stop dolive-web
  fi
}

install_web() {
  local stamp=$WEB/node_modules/.dolive-linux-stamp want built
  want="$(sha256_of "$WEB/package-lock.json") node-$NODE_VERSION linux-$ARCH_NODE"
  if [ "$(cat "$stamp" 2>/dev/null)" != "$want" ]; then
    stop_web_for_change
    say "웹 설치 부품을 받는 중 (npm ci, 몇 분 걸려요)"
    (cd "$WEB" && as_dolive npm ci --no-audit --no-fund --loglevel=error) || die "npm ci 실패"
    echo "$want" > "$stamp"; chown "$SVC_USER:$SVC_USER" "$stamp"
    FORCE_BUILD=1
  fi
  ok "웹 설치 부품 (npm ci)"

  built=$WEB/.next/BUILD_ID
  if [ "$FORCE_BUILD" -eq 0 ] && [ -f "$built" ] && [ "$(cat "$WEB/.next/.dolive-linux-stamp" 2>/dev/null)" = "$want" ] &&
     [ -z "$(find "$WEB/app" "$WEB/components" "$WEB/lib" "$WEB/public" "$WEB/package.json" "$WEB/next.config.ts" "$WEB/tsconfig.json" "$WEB/postcss.config.mjs" -newer "$built" -print -quit 2>/dev/null)" ]; then
    ok "웹 화면 (이미 최신)"
    return
  fi
  stop_web_for_change
  say "웹 화면을 만드는 중 (next build, 몇 분 걸려요). 기록: $STATE/build.log"
  if ! (cd "$WEB" && as_dolive bash -c 'set -a; . "$1"; set +a; exec node node_modules/next/dist/bin/next build' _ "$ENV_FILE") > "$STATE/build.log" 2>&1; then
    tail -n 30 "$STATE/build.log" >&2
    die "웹 화면 만들기 실패. 전체 기록: $STATE/build.log"
  fi
  echo "$want" > "$WEB/.next/.dolive-linux-stamp"
  chown "$SVC_USER:$SVC_USER" "$WEB/.next/.dolive-linux-stamp" "$STATE/build.log"
  ok "웹 화면을 만들었어요"
}

# ---------------------------------------------------------------- 7. systemd 등록
install_units() {
  local unit src dst tmp changed=0
  for unit in dolive.target dolive-livekit.service dolive-web.service dolive-caddy.service; do
    src=$ROOT/server/linux/systemd/$unit dst=$UNIT_DIR/$unit
    tmp=$(mktemp)
    sed "s#@DOLIVE_ROOT@#$ROOT#g" "$src" > "$tmp"
    if ! cmp -s "$tmp" "$dst"; then
      install -m 0644 "$tmp" "$dst"; changed=1
    fi
    rm -f "$tmp"
    # 덧붙인 설정(.service.d)만 바뀐 경우도 systemd 에 다시 읽힌다
    [ "$(systemctl show -p NeedDaemonReload --value "$unit" 2>/dev/null)" = yes ] && changed=1
  done
  [ "$changed" -eq 1 ] && systemctl daemon-reload
  systemctl enable --quiet dolive.target "${SERVICES[@]}"
  ln -sfn "$ROOT/scripts/linux/dolivectl" /usr/local/sbin/dolivectl
  # 예전 판의 "바뀜" 기록. 다시 켤지는 이제 applied-state.sh 의 지문으로 정한다
  rm -f "$STATE/.caddyfile.sha256" "$STATE/.livekit-config.sha256"
  ok "systemd 등록 (부팅 때 자동 시작: dolive.target), 관리 명령 dolivectl"
}

# ---------------------------------------------------------------- 8. 켜기
start_all() {
  local s
  if [ "$NO_START" -eq 1 ]; then
    for s in livekit web caddy; do
      systemctl is-active --quiet "dolive-$s" && [ "$(dolive_fingerprint "$s")" != "$(dolive_applied "$s")" ] &&
        warn "dolive-$s 는 바뀌기 전 상태로 켜져 있어요. 적용: sudo dolivectl restart (또는 이 설치를 --no-start 없이 다시 실행)"
    done
    say "--no-start: 서버는 켜지 않았어요. 켜기: sudo dolivectl start"
    return
  fi
  # 켜져 있는데 마지막 정상 기동 뒤로 파일·설정이 바뀐 것만 다시 켠다 (앞선 설치가 중간에 실패한 경우도 여기서 적용된다)
  for s in livekit web caddy; do
    if systemctl is-active --quiet "dolive-$s" && [ "$(dolive_fingerprint "$s")" != "$(dolive_applied "$s")" ]; then
      say "dolive-$s 를 바뀐 파일·설정으로 다시 켭니다"
      systemctl restart "dolive-$s"
    fi
  done
  systemctl start dolive.target
  "$ROOT/scripts/linux/dolivectl" health --wait 90 || die "일부가 켜지지 않았어요. sudo dolivectl logs 로 기록을 확인해 주세요 (고친 뒤 이 설치를 다시 실행하면 이어서 적용합니다)"
  # 세 서비스가 지금 파일로 켜져 응답하는 것을 확인한 뒤에만 "적용됨"으로 기록한다
  dolive_mark_applied livekit web caddy
}

main() {
  echo; echo "  DOLIVE Linux 설치"; echo "  ------------------------------------------"
  check_host
  ensure_tools
  ensure_user
  install_programs
  install_models
  ensure_env
  protect_config
  install_web
  install_units
  chown -R "$SVC_USER:$SVC_USER" "$ROOT"
  start_all
  echo "  ------------------------------------------"
  say "참가자 주소: https://$(env_value DOLIVE_DOMAIN "$ENV_FILE")"
  say "마스터(관리자)는 SSH 터널로 들어옵니다: docs/linux/README.md 의 '마스터로 들어가기'"
  say "방화벽은 자동으로 바꾸지 않았어요. 점검: sudo dolivectl firewall, sudo dolivectl doctor"
}
main
