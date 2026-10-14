#!/bin/sh
# dolive-livekit.service 가 실행한다. /etc/dolive/dolive.env 값(systemd EnvironmentFile)으로 LiveKit을 켠다.
# 비밀값은 명령줄(ps 로 누구나 보임)이 아니라 환경변수로만 넘긴다. server/linux/livekit.yaml 에는 키 이름·비밀값이 없다.
#   LIVEKIT_KEYS            "키 이름": "비밀값" (입장권을 확인하는 키)
#   LIVEKIT_WEBHOOK_API_KEY 같은 키 이름 (퇴장 알림 서명에 쓰는 키. LiveKit 은 설정 항목 webhook.api_key 를 이 환경변수로도 받는다)
# 둘 다 LIVEKIT_API_KEY 하나에서 만들므로, 윈도우에서 옮겨 온 기존 키 이름(dolive 가 아니어도)을 그대로 쓴다.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)

fail() { echo "[실패] $*" >&2; exit 78; } # 78 = 설정 오류 (systemd가 다시 켜도 같은 오류라 RestartPreventExitStatus 로 멈춘다)
[ -n "${LIVEKIT_API_KEY:-}" ] || fail "/etc/dolive/dolive.env 에 LIVEKIT_API_KEY 가 없어요"
[ -n "${LIVEKIT_API_SECRET:-}" ] || fail "/etc/dolive/dolive.env 에 LIVEKIT_API_SECRET 가 없어요"
[ -n "${DOLIVE_PUBLIC_IP:-}" ] || fail "/etc/dolive/dolive.env 에 DOLIVE_PUBLIC_IP(고정 공인 IP)가 없어요"
# LIVEKIT_KEYS 는 LiveKit 이 YAML 로 읽는다. 따옴표·빈칸·# 같은 글자가 섞이면 다르게 읽히므로 쓸 수 있는 글자를 정해 둔다
case $LIVEKIT_API_KEY in *[!A-Za-z0-9._-]*) fail "LIVEKIT_API_KEY 에는 영문·숫자와 . _ - 만 쓸 수 있어요 (/etc/dolive/dolive.env)" ;; esac
case $LIVEKIT_API_SECRET in *[!A-Za-z0-9._~+/=-]*) fail "LIVEKIT_API_SECRET 에는 영문·숫자와 . _ ~ + / = - 만 쓸 수 있어요 (/etc/dolive/dolive.env)" ;; esac

# 큰따옴표로 감싸 123·true 처럼 생긴 값도 글자 그대로 읽게 한다 (위에서 따옴표·역빗금은 막았다)
LIVEKIT_KEYS="\"$LIVEKIT_API_KEY\": \"$LIVEKIT_API_SECRET\""
LIVEKIT_WEBHOOK_API_KEY=$LIVEKIT_API_KEY
NODE_IP=$DOLIVE_PUBLIC_IP
export LIVEKIT_KEYS LIVEKIT_WEBHOOK_API_KEY NODE_IP
unset LIVEKIT_API_SECRET DORMS_CLIENT_ID
exec "$root/server/bin/livekit-server" --config "$root/server/linux/livekit.yaml"
