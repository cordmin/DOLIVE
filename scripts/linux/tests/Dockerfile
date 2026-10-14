# DOLIVE Linux 설치 시험용 "가짜 드롭릿". systemd 를 PID 1 로 켠다 (scripts/linux/tests/container-test.sh)
# Ubuntu 24.04 공식 이미지(2026-09-17 빌드)의 다중 플랫폼 digest 로 고정한다
FROM ubuntu@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ENV DEBIAN_FRONTEND=noninteractive
# DigitalOcean Ubuntu 이미지에 기본으로 있는 도구 + systemd. Node·LiveKit·Caddy 는 넣지 않는다 (설치 스크립트가 받는다).
# --privileged 컨테이너에서 systemd-binfmt·systemd-sysctl·systemd-modules-load 는 컨테이너가 아니라 Docker VM 커널 전체를 바꾼다.
# 특히 systemd-binfmt 는 켜질 때·꺼질 때 VM 의 binfmt 등록(다른 아키텍처 에뮬레이션)을 지운다. 시험과 무관하므로 끈다
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus ca-certificates curl xz-utils git \
      iproute2 openssh-server openssh-client sudo procps ufw less \
 && rm -rf /var/lib/apt/lists/* \
 && systemctl mask systemd-logind.service getty.target console-getty.service \
      systemd-binfmt.service proc-sys-fs-binfmt_misc.automount proc-sys-fs-binfmt_misc.mount \
      systemd-sysctl.service systemd-modules-load.service
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
