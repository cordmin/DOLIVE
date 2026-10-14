# DOLIVE Linux: 실행 중인 서비스가 어떤 파일·설정으로 켜졌는지 기록한다.
# dolive-install.sh 와 dolivectl 이 source 로 읽는다 (직접 실행하지 않는다).
# 설치 중간에 실패하면 파일은 바뀌었는데 서비스는 옛 상태로 남을 수 있다. 그래서 "준비된 파일"의 지문과
# "마지막으로 정상 기동을 확인한 지문"을 따로 두고, 다음 설치 때 둘이 다른 서비스만 다시 켠다.
# 필요: DOLIVE_ROOT (코드 폴더)

DOLIVE_APPLIED_DIR=/var/lib/dolive-applied # root 전용. 실행 계정(dolive)이 바꿀 수 없는 곳에 둔다

# 서비스가 켜질 때 읽는 것들의 지문: systemd 파일(덧붙인 설정 포함), 비밀 설정, 프로그램 판, 설정 파일, 웹 빌드
dolive_fingerprint() { # livekit|web|caddy
  local s=$1 r=$DOLIVE_ROOT
  # 없는 파일(덧붙인 설정 없음, 아직 빌드 전 등)은 건너뛴다: 하위 셸에서 set -e 를 끈다
  (
    set +e
    cat "/etc/systemd/system/dolive-$s.service" /etc/systemd/system/"dolive-$s.service.d"/*.conf /etc/dolive/dolive.env
    case $s in
      livekit) cat "$r/server/bin/.versions/livekit" "$r/server/linux/livekit.yaml" "$r/scripts/linux/run-livekit.sh" ;;
      web)
        cat "$r/server/bin/.versions/node" "$r/apps/web/.next/BUILD_ID" "$r/apps/web/node_modules/.dolive-linux-stamp"
        stat -c '%n %s %Y' "$r"/apps/web/models/supertonic/*
        ;;
      caddy) cat "$r/server/bin/.versions/caddy" "$r/server/linux/Caddyfile" ;;
    esac
    true
  ) 2>/dev/null | sha256sum | cut -d' ' -f1
}

dolive_applied() { cat "$DOLIVE_APPLIED_DIR/$1" 2>/dev/null || true; }

# 서비스를 지금 파일로 켜고 응답까지 확인한 뒤에만 부른다
dolive_mark_applied() { # 서비스...
  local s
  install -d -o root -g root -m 0700 "$DOLIVE_APPLIED_DIR"
  for s in "$@"; do dolive_fingerprint "$s" > "$DOLIVE_APPLIED_DIR/$s"; done
}
