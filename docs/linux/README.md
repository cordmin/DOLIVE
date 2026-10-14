# DOLIVE Linux 서버 설치와 운영 안내 (DigitalOcean)

이 안내는 DOLIVE를 **DigitalOcean Droplet(빌려 쓰는 인터넷 서버) 한 대**에서 운영하는 방법입니다. 현재 서비스 주소는 `https://dolive.site/`입니다. 기능과 관리자 권한은 [첫 화면 안내](../../README.md), 집 서버와 옛 주소 정리는 [전환 기록](../2026-10-14_VPS_전환.md)을 따릅니다. 아래 주소와 IP 예시는 실제 서버 값으로 바꿉니다.

서버에 접속해 명령을 입력하는 일이 조금 있습니다. 명령은 회색 상자 안의 글을 그대로 복사해 붙여 넣으면 되고, `live.example.com`, `203.0.113.10`처럼 예시로 적은 값만 본인 값으로 바꿉니다.

## 목차

- [1. 전체 구조](#1-전체-구조)
- [2. 준비할 것과 비용](#2-준비할-것과-비용)
- [3. Droplet 만들기](#3-droplet-만들기)
- [4. 주소(DNS) 연결](#4-주소dns-연결)
- [5. 방화벽](#5-방화벽)
- [6. 설치](#6-설치)
- [7. 윈도우 서버에서 옮겨 오기](#7-윈도우-서버에서-옮겨-오기)
- [8. 실제 접속 확인](#8-실제-접속-확인)
- [9. 마스터로 들어가기 (SSH 터널)](#9-마스터로-들어가기-ssh-터널)
- [10. 매일 운영](#10-매일-운영)
- [11. 운영진과 방송 목록](#11-운영진과-방송-목록)
- [12. 백업과 복원](#12-백업과-복원)
- [13. 새 버전으로 바꾸기](#13-새-버전으로-바꾸기)
- [14. 문제가 생겼을 때](#14-문제가-생겼을-때)
- [15. 사양과 한계](#15-사양과-한계)
- [16. 파일 위치](#16-파일-위치)
- [17. 확인한 것과 아직 확인하지 못한 것](#17-확인한-것과-아직-확인하지-못한-것)
- [18. 실제 운영 전 확인 순서](#18-실제-운영-전-확인-순서)

## 1. 전체 구조

```text
참가자 브라우저
  ├─ TCP 443  → Caddy(HTTPS) ─┬→ 127.0.0.1:3000 웹(Next.js)
  │                           └→ 127.0.0.1:7880 통화 신호(LiveKit)
  └─ TCP 7881, UDP 50000~60000 → LiveKit (소리·카메라·화면공유)

서버 안
  dolive-web      웹 화면·채팅·로그인·글 읽기 (127.0.0.1:3000, 한 프로세스)
  dolive-livekit  통화 서버 (API 127.0.0.1:7880)
  dolive-caddy    HTTPS 인증서와 바깥 접속 (443)
  dolive.target   위 셋을 함께 켜고 끄는 묶음. 서버를 켜면 자동으로 시작
```

- 세 프로그램은 systemd(리눅스가 프로그램을 켜고 지켜보는 기능)가 관리합니다. 서버를 다시 켜면 저절로 켜지고, 한 프로그램이 멈추면 5초 뒤 다시 켭니다.
- 프로그램은 로그인할 수 없는 전용 계정 `dolive`로 돌아갑니다. Caddy는 비밀 설정을 읽지 못하는 별도 임시 계정으로 돌아갑니다.
- 윈도우와 달리 **DuckDNS 주소 갱신을 하지 않습니다.** Droplet의 공인 IP(인터넷 주소)는 바뀌지 않으므로 DNS에 한 번만 적습니다.

## 2. 준비할 것과 비용

| 준비물 | 설명 |
| :--- | :--- |
| DigitalOcean 계정 | 결제 수단이 등록된 계정. **Droplet은 켜 두는 동안 요금이 나갑니다.** 꺼 둬도(전원 끔) 요금은 나가고, 삭제해야 멈춥니다 |
| 도메인 | 참가자가 열 주소. 현재 DOLIVE는 `dolive.site`, 아래 설치 예시는 `live.example.com` |
| 도름스 연결 | [도름스 연결 관리](https://dorms.school/connect)에 사이트를 등록하고 받은 사이트 식별값 |
| SSH 키 | 서버에 들어가는 열쇠 파일. 아래 3번에서 만듭니다. SSH는 어느 인터넷(집·핫스팟)에서든 열어 두고 이 열쇠로만 들어오게 하므로, 관리자 컴퓨터의 IP는 필요 없습니다 |

### 서버 크기

시작 사양은 **Ubuntu 24.04 LTS x64, 4 vCPU, 8GB 메모리(일반 Basic 또는 CPU-Optimized)**를 권합니다. 글 읽기(TTS)는 서버 CPU로 목소리를 만들어 CPU를 많이 씁니다. 평소 10~20명, 최대 50명을 목표로 하지만 **50명 동시 접속은 아직 실제로 시험하지 않았습니다.** [15번](#15-사양과-한계)을 꼭 읽어 주세요.

### 데이터 전송량(트래픽) 어림 계산

Droplet 요금제마다 한 달에 포함된 전송량이 있고, 넘으면 추가 요금이 붙습니다. 구매 화면에서 포함량을 확인하세요. 아래 숫자는 **처음 정한 사용량 가정으로 계산한 어림값이며, 부하시험이나 실제 측정 결과가 아닙니다.**

- 가정: 참가자 한 명이 평균 초당 **3Mbps**(메가비트)를 받음, 방송 1회 3시간, 전체 방송 주 4~5회, 한 달은 4.345주.
- 한 명이 1시간 동안 받는 양: 3Mbps × 3,600초 ÷ 8 ≈ **1.35GB**
- 평소 10~20명: 10명·주 4회 ~ 20명·주 5회 → 한 달 약 **0.7~1.8TB**
- 최대 50명이 모든 방송에 참여: 주 4~5회 → 한 달 약 **3.5~4.4TB** (방송 1회 약 200GB)
- 화질·카메라 수·화면공유 내용에 따라 크게 달라집니다. 첫 달은 DigitalOcean 제어판의 Bandwidth 그래프로 실제 양을 확인하고 요금제 포함량과 비교하세요.

## 3. Droplet 만들기

DigitalOcean 공식 [권장 설정 안내](https://docs.digitalocean.com/products/droplets/tutorials/recommended-setup/)를 기준으로 합니다.

1. 내 컴퓨터에서 SSH 키를 만듭니다. 윈도우 PowerShell이나 macOS 터미널에서 실행합니다. 질문은 모두 Enter로 넘겨도 됩니다.

   ```text
   ssh-keygen -t ed25519
   ```

   만들어진 `id_ed25519.pub`(공개 열쇠, 남에게 보여도 됨)의 내용을 DigitalOcean 제어판 **Settings → Security → SSH keys → Add SSH Key**에 붙여 넣습니다. 확장자가 없는 `id_ed25519`(비밀 열쇠)는 절대 남에게 보내지 않습니다.
2. 제어판에서 **Create → Droplets**를 누릅니다.
   - Region(지역): 참가자와 가까운 곳. 한국 참가자가 중심이면 보통 **Singapore(SGP1)**가 가장 가깝습니다.
   - Image: **Ubuntu 24.04 (LTS) x64**
   - Size: 2번의 사양
   - Authentication: **SSH Key**를 고르고 방금 넣은 키 선택 (비밀번호 방식은 고르지 않음)
   - Backups(자동 백업): 켜기를 권합니다(추가 요금). 서버 전체를 되돌릴 수 있습니다
   - Tags: `dolive` 라고 적어 둡니다. 방화벽 연결에 씁니다
3. 만든 뒤 Droplet 화면에 보이는 **ipv4 주소**를 적어 둡니다. 이것이 고정 공인 IP입니다.
   - Reserved IP(예약 IP)를 따로 붙였다면 그 주소를 씁니다. 이 경우 아래 설정의 `DOLIVE_PUBLIC_IP`와 DNS에 모두 Reserved IP를 적습니다.
4. 내 컴퓨터에서 접속합니다.

   ```text
   ssh root@203.0.113.10
   ```

   공식 안내처럼 sudo(관리자 권한)를 가진 일반 계정을 만들어 쓰는 것을 권합니다. 이 안내의 명령은 앞에 `sudo`가 붙어 있어 일반 계정과 root 모두에서 쓸 수 있습니다.

## 4. 주소(DNS) 연결

도메인 관리 화면(도메인을 산 곳, Cloudflare, DuckDNS 등)에서 다음처럼 적습니다. **이 단계는 사람이 직접 하며 설치 스크립트는 DNS를 바꾸지 않습니다.**

| 종류 | 이름 | 값 |
| :--- | :--- | :--- |
| A | `live` (도메인 전체가 `live.example.com`일 때) | Droplet 공인 IPv4 |

- **AAAA(IPv6) 레코드는 만들지 않는 것을 권합니다.** AAAA가 다른 서버(예: 예전 집 주소)를 가리키면 인증서 발급과 일부 참가자 접속이 실패합니다. 이미 있다면 지우거나 이 Droplet의 IPv6로 맞춥니다. `sudo dolivectl doctor`가 확인해 줍니다.
- Cloudflare를 쓰면 이 레코드는 **DNS only(회색 구름)**로 둡니다. 주황 구름(프록시)은 통화의 UDP·7881 연결을 통과시키지 않습니다.
- 현재 DOLIVE는 DuckDNS를 쓰지 않습니다. 옛 주소와 집 공유기 정리는 [전환 기록](../2026-10-14_VPS_전환.md)을 따릅니다. **옛 Windows 시작 명령은 DuckDNS를 집 주소로 바꾸므로 실행하지 않습니다.**
- DNS 변경이 퍼지는 데 몇 분~몇 시간 걸릴 수 있습니다. 내 컴퓨터에서 `nslookup live.example.com`의 결과가 Droplet IP인지 확인합니다.

## 5. 방화벽

바깥에 여는 길은 다음뿐입니다. `sudo dolivectl firewall`로도 볼 수 있습니다.

| 종류 | 번호 | 허용할 곳 | 용도 |
| :--- | :--- | :--- | :--- |
| TCP | 22 | 모두 (**SSH 키로만** 로그인) | SSH 관리 접속 |
| TCP | 443 | 모두 | 웹·통화 신호, 인증서 받기 |
| TCP | 7881 | 모두 | 통화 (UDP가 막힌 참가자) |
| UDP | 50000~60000 | 모두 | 소리·카메라·화면공유 |

3000·7880번은 서버 안에서만 쓰므로 열지 않습니다. 80번은 필요 없습니다(인증서를 443번으로 받습니다).

### 권장: DigitalOcean 클라우드 방화벽

DigitalOcean 클라우드 방화벽은 [규칙에 없는 통신을 모두 막는](https://docs.digitalocean.com/products/networking/firewalls/getting-started/quickstart/) 무료 방화벽입니다.

1. 제어판 **Networking → Firewalls → Create Firewall**
2. Inbound Rules: 위 표의 네 줄을 넣습니다. 네 줄 모두 Sources는 All IPv4, All IPv6.
3. Outbound Rules: 기본값(모두 허용)을 그대로 둡니다. 프로그램·모델·인증서 받기와 도름스 확인에 필요합니다.
4. Apply to Droplets에 `dolive` 태그를 넣고 만듭니다.

### SSH는 열쇠로만 들어오게 하기

관리자 컴퓨터의 공인 IP는 집 인터넷 재연결이나 휴대폰 핫스팟 사용으로 수시로 바뀝니다. 그래서 SSH를 특정 IP로 묶지 않고 어디서든 열어 두는 대신, **비밀번호로는 들어올 수 없고 3번에서 넣은 SSH 키로만** 들어오게 합니다. DigitalOcean에서 SSH Key로 만든 Droplet은 이미 비밀번호 로그인이 꺼져 있지만, 설정이 바뀌어도 유지되도록 SSH로 접속한 상태에서 한 번 더 고정합니다.

```text
printf 'PermitRootLogin prohibit-password\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n' | sudo tee /etc/ssh/sshd_config.d/10-dolive-keys-only.conf
sudo sshd -t && sudo systemctl reload ssh
```

- 지금 창은 닫지 말고, **새 창에서 `ssh root@203.0.113.10`이 되는지 먼저 확인**한 뒤 닫습니다.
- 서버에 들어갈 수 있는 것은 등록한 SSH 키를 가진 컴퓨터뿐입니다. 다른 컴퓨터에서도 관리하려면 그 컴퓨터에서 만든 공개 열쇠(`.pub`)를 서버의 `~/.ssh/authorized_keys`에 한 줄 추가합니다. 비밀 열쇠 파일을 복사해 나눠 쓰지 않습니다.
- 집 IP가 고정이라 꼭 그 IP로만 묶고 싶다면 SSH의 Sources에 그 IP만 넣어도 됩니다. 이때 IP가 바뀌면 SSH가 막히므로 제어판의 방화벽에서 새 IP로 고치거나 Droplet 화면의 **Recovery → Recovery Console**로 들어갑니다.

### 서버 방화벽(ufw)

클라우드 방화벽만으로 충분합니다. ufw를 함께 쓰려면 `sudo dolivectl firewall`이 보여 주는 순서대로, **SSH 허용을 먼저 넣고 마지막에 켭니다.** 설치 스크립트는 방화벽을 자동으로 켜거나 바꾸지 않습니다.

## 6. 설치

SSH로 접속한 상태에서 실행합니다.

1. 이 안내에서 쓰는 기본 도구(`git`, 글 편집기 `nano`)를 준비합니다. DigitalOcean Ubuntu 24.04에는 보통 이미 있고, 있으면 그대로 넘어갑니다.

   ```text
   sudo apt-get update && sudo apt-get install -y git nano
   ```

2. 코드를 받습니다. 설치 위치는 `/opt/dolive`를 권합니다. (`/home` 아래는 안 됩니다.)

   ```text
   sudo git clone https://github.com/cordmin/DOLIVE.git /opt/dolive
   ```

   Linux 구성이 아직 깃허브 main에 올라가지 않았다면 이 명령으로 받은 코드에는 `scripts/linux`가 없습니다. 그때는 아래 [깃허브에 아직 없는 코드로 설치하기](#깃허브에-아직-없는-코드로-설치하기)를 따릅니다.
3. 윈도우 서버에서 옮겨 온다면 지금 [7번](#7-윈도우-서버에서-옮겨-오기)의 파일을 먼저 올립니다. 다른 Linux 서버의 백업에서 옮긴다면 [12번의 새 Droplet으로 옮기기](#새-droplet으로-옮기기)를 따릅니다.
4. 설치 스크립트를 실행합니다. 세 값을 본인 값으로 바꿉니다. 도름스 식별값을 아직 모르면 `--dorms-client-id` 부분을 빼고 나중에 넣어도 됩니다.

   ```text
   sudo /opt/dolive/scripts/linux/dolive-install.sh --domain live.example.com --public-ip 203.0.113.10 --dorms-client-id 도름스_사이트_식별값
   ```

   설치 스크립트가 하는 일:
   - Node.js 24.21.0, LiveKit 1.13.9, Caddy 2.11.7을 공식 배포처에서 받아 **체크섬(파일이 진짜인지 확인하는 값)을 대조한 뒤** `/opt/dolive/server/bin`에만 둡니다. 서버 전체에 Node.js 등을 설치하지 않습니다.
   - 글 읽기 모델(Supertonic 3, 약 400MB)을 고정된 판(revision)으로 받아 체크섬을 확인합니다. 이미 있는 파일은 다시 받지 않습니다.
   - 전용 계정 `dolive`, 설정 파일 `/etc/dolive/dolive.env`(처음 한 번만. 새 설치는 통화 서버 키 이름 `dolive`와 새 비밀값을 만들고, 옮겨 온 `apps/web/.env.local`이 있으면 그 키 이름·비밀값을 그대로 가져옴), systemd 등록, 관리 명령 `dolivectl`을 준비합니다.
   - `npm ci`(설치 부품)와 `next build`(웹 화면 만들기)를 합니다. 처음에는 5~10분 걸릴 수 있습니다.
   - 마지막에 세 프로그램을 켜고 응답을 확인합니다.
5. 설정 파일을 확인합니다. 값의 뜻은 [설정 예시](../../server/linux/dolive.env.example)에 있습니다.

   ```text
   sudo nano /etc/dolive/dolive.env
   ```

   고쳤다면 `Ctrl+O`, Enter로 저장, `Ctrl+X`로 나온 뒤 `sudo dolivectl restart`로 다시 켭니다. 설정 파일은 프로그램이 켜질 때만 읽으므로, 다시 켜야 바뀐 값이 적용됩니다.
6. [도름스 연결 관리](https://dorms.school/connect)에서 사이트를 등록하고 사이트 식별값을 받습니다. 교사 인증을 마친 도름스 계정이 필요합니다.
   - 사이트 주소에 `https://live.example.com`을 적습니다. `https://`로 시작하고 뒤에 `/`나 경로를 붙이지 않습니다. 돌아오는 주소(`https://live.example.com/api/auth/dorms/callback`)는 도름스가 자동으로 등록하므로 따로 넣지 않습니다.
   - 로그인 조건은 동호회 회원이 들어와야 하면 "누구나"를 고릅니다. DOLIVE는 이메일을 쓰지 않으므로 이메일 받기는 꺼도 됩니다.
   - 받은 식별값을 `/etc/dolive/dolive.env`의 `DORMS_CLIENT_ID`에 넣고 `sudo dolivectl restart` 합니다.
   - 사이트 카드의 "도름스로 로그인" 설치 프롬프트는 복사하지 않습니다. DOLIVE에는 로그인·도름네이션 코드가 이미 들어 있습니다.
   - 도름네이션은 돌아오는 주소를 따로 등록하지 않습니다(로그인 주소와 같은 사이트면 자동 허용). 대신 사이트 카드에서 도름네이션 설치 프롬프트를 복사하면 승인 신청이 접수되고, **도름스 관리자가 승인해야** 보내기가 작동합니다. 이때 복사한 프롬프트도 실행하지 않습니다.
   - 도름스에서 사이트 주소는 나중에 바꿀 수 없습니다. 주소(도메인)를 바꿔 옮기면 새 주소로 다시 등록하고 도름네이션 승인도 다시 받습니다. 같은 주소를 이어받는다면 새로 중복 등록하지 말고 기존 운영자와 확인합니다.

설치 스크립트는 **몇 번을 다시 실행해도 됩니다.** 이미 있는 설정 파일, 방송 목록(`rooms.txt`), 운영진(`staff.txt`), 모델 파일, 인증서는 덮어쓰지 않습니다. 이미 설정 파일이 있으면 `--domain` 등의 값은 무시합니다. 주소를 바꾸려면 설정 파일을 직접 고칩니다.

다시 켤지는 "각 프로그램이 켜질 때 읽는 파일(프로그램 판, systemd 설정, 설정 파일, 웹 화면, 모델)"이 마지막으로 정상 기동을 확인한 때와 달라졌는지로 정합니다(`/var/lib/dolive-applied`). 그래서 바뀐 것이 없으면 실행 중인 서버를 다시 켜지 않고, 설정 파일만 고쳤다면 설치 스크립트를 다시 실행해도 적용됩니다. **설치가 중간에 실패했다면 원인을 고친 뒤 같은 명령을 다시 실행하세요.** 앞선 실행에서 파일만 바뀌고 적용되지 못한 프로그램을 이번에 다시 켭니다.

### 깃허브에 아직 없는 코드로 설치하기

유지보수 담당자의 컴퓨터에만 있는 코드(아직 깃허브에 올리지 않은 수정)로 설치할 때 씁니다. 비밀 설정·모델·설치 부품은 넣지 않고 **깃이 관리하는 파일과 새로 만든 파일만** 묶습니다. 담당자 컴퓨터(macOS 또는 Linux 터미널)의 DOLIVE 폴더에서 실행합니다.

```text
git ls-files -z --cached --others --exclude-standard | COPYFILE_DISABLE=1 tar --null -T - -czf ../dolive-source.tar.gz
tar -tzf ../dolive-source.tar.gz | grep -E '(^|/)\.env($|\.local)|server/config/(livekit\.yaml|duckdns\.env|rooms\.txt|staff\.txt)$|node_modules/|apps/web/models/|\.next/|server/bin/|\.dorms-login/'
```

두 번째 명령은 **아무것도 출력하지 않아야 합니다.** 무엇이든 나오면 비밀값·큰 파일이 섞인 것이니 묶음을 지우고, 그 파일이 깃 제외 목록(`.gitignore`)에 들도록 담당자와 확인한 뒤 다시 묶습니다. 그다음 Droplet에 올려 풉니다.

```text
scp ../dolive-source.tar.gz root@203.0.113.10:/root/
```

Droplet에서:

```text
sudo mkdir -p /opt/dolive
sudo tar -xzf /root/dolive-source.tar.gz -C /opt/dolive
sudo rm /root/dolive-source.tar.gz
```

이어서 위 3·4단계를 똑같이 진행합니다. 이렇게 설치한 폴더는 깃 기록이 없어 `sudo dolivectl update`를 쓸 수 없습니다. 새 코드는 같은 방법으로 묶어 올린 뒤 `sudo dolivectl backup` → `sudo dolivectl stop` → `sudo tar -xzf 새파일 -C /opt/dolive` → `sudo /opt/dolive/scripts/linux/dolive-install.sh --build` 순서로 바꿉니다(새 코드에서 지운 파일은 서버에 남으니 담당자와 확인). 코드가 깃허브 main에 올라간 뒤에는 `git clone` 설치로 바꾸는 것을 권합니다: 백업 → `sudo dolivectl stop` → `sudo mv /opt/dolive /opt/dolive-old` → `sudo git clone ... /opt/dolive` → 옛 폴더에서 `apps/web/models`, `server/config/rooms.txt`, `server/config/staff.txt`를 같은 자리로 복사 → 설치 스크립트 실행 → 확인 뒤 `/opt/dolive-old` 삭제.

## 7. 윈도우 서버에서 옮겨 오기

윈도우 서버의 DOLIVE 폴더에서 아래 파일을 Droplet으로 복사합니다. **반드시 윈도우 서버를 끈 뒤(끄기 버튼) 복사합니다.** 방송 목록이 복사 뒤에 바뀌지 않게 하기 위해서입니다.

| 윈도우 위치 | Droplet 위치 | 필요 여부 |
| :--- | :--- | :--- |
| `server\config\rooms.txt` | `/opt/dolive/server/config/rooms.txt` | 기존 방송·비밀번호·방 주인을 유지하려면 필요 |
| `server\config\staff.txt` | `/opt/dolive/server/config/staff.txt` | 운영진이 있으면 필요 |
| `apps\web\.env.local` | `/opt/dolive/apps/web/.env.local` | 도름스 식별값·통화 키를 이어 쓰려면 필요. 설치 스크립트가 처음 한 번 읽어 `/etc/dolive/dolive.env`를 만듭니다(통화 키 이름이 `dolive`가 아니어도 이름·비밀값을 바꾸지 않고 그대로 씀) |
| `apps\web\models\supertonic\` | `/opt/dolive/apps/web/models/supertonic/` | 선택. 없으면 설치 스크립트가 받습니다 |

`livekit.yaml`, `duckdns.env`, `server\bin\*.exe`, `DOLIVE.lnk`, `node_modules`, `.next`는 Linux에서 쓰지 않으므로 옮기지 않아도 됩니다.

**통화 서버 키는 그대로 이어집니다**

- `.env.local`의 `LIVEKIT_API_KEY`(키 이름)와 `LIVEKIT_API_SECRET`(비밀값)은 키 이름이 `dolive`가 아니어도 **바꾸지 않고 그대로** `/etc/dolive/dolive.env`로 옮겨집니다. `.env.local`이 없는 새 설치만 키 이름 `dolive`와 새 비밀값을 만듭니다.
- Linux의 통화 서버는 이 한 쌍으로 입장권 확인과 퇴장 알림(빈 방의 채팅 정리)을 함께 합니다. 그래서 `server/linux/livekit.yaml`에는 키를 적지 않고, 윈도우의 `livekit.yaml`도 옮기지 않습니다.
- 키 이름은 영문·숫자와 `. _ -`, 비밀값은 영문·숫자와 `. _ ~ + / = -`만 쓸 수 있습니다. 다른 글자(따옴표·빈칸 등)가 있으면 설치 스크립트가 설정 파일을 만들지 않고 멈춥니다. 이때는 담당자와 함께 `.env.local`의 값을 새 임의 값으로 고친 뒤 설치 스크립트를 다시 실행합니다.
- 이미 `/etc/dolive/dolive.env`가 있으면 `.env.local`을 다시 읽지 않습니다. 이후에 키를 바꾸려면 설정 파일을 직접 고치고 `sudo dolivectl restart` 합니다.

**도름스 로그인 관련 파일 구분**

- 회원의 실제 로그인 상태는 서버 파일이 아니라 **각자의 브라우저 쿠키와 도름스 서비스**에 있습니다. 서버에서 옮길 로그인 기록은 없습니다. 같은 주소(도메인)를 계속 쓰면 브라우저에 남은 로그인으로 그대로 들어오고, 주소를 바꾸면 회원이 다시 로그인합니다.
- 도름스 연결 설정(사이트 식별값·사이트 주소)은 설정 파일 `/etc/dolive/dolive.env`의 `DORMS_CLIENT_ID`·`DORMS_SITE_URL`입니다(윈도우에서는 `.env.local`).
- `apps/web/.dorms-login.json`은 도름스 로그인 기능을 넣은 도구가 남긴 **연동 메타데이터**(판 번호·관리 파일 목록)이며 깃허브 코드에 들어 있습니다. 회원 정보나 로그인 상태가 아니므로 옮기거나 지우거나 고치지 않습니다.
- 윈도우 폴더에 `apps\web\.dorms-login\` 폴더가 있다면(깃허브에는 없음) 같은 자리(`/opt/dolive/apps/web/.dorms-login/`)로 함께 복사해 보존합니다. Linux 백업은 이 폴더와 `.dorms-login.json`이 있으면 함께 담습니다.

윈도우 PowerShell에서 복사하는 예입니다(Windows 10 이후에는 `scp`가 들어 있습니다). 먼저 Droplet에 받을 폴더를 만들고, 내 컴퓨터에서 올린 뒤, Droplet에서 제자리로 옮깁니다.

```text
ssh root@203.0.113.10 "mkdir -p /root/dolive-move"
scp C:\DOLIVE\server\config\rooms.txt C:\DOLIVE\server\config\staff.txt C:\DOLIVE\apps\web\.env.local root@203.0.113.10:/root/dolive-move/
```

Droplet에서:

```text
sudo cp /root/dolive-move/rooms.txt /root/dolive-move/staff.txt /opt/dolive/server/config/
sudo cp /root/dolive-move/.env.local /opt/dolive/apps/web/
sudo rm -rf /root/dolive-move
```

그다음 [6번](#6-설치)의 4단계(설치 스크립트)부터 진행합니다. 주소(도메인)를 그대로 쓰면 도름스 등록을 바꿀 필요가 없습니다. 주소를 바꾸면 도름스에 등록한 주소도 함께 바꿉니다. 새 서버를 확인할 때까지 윈도우 폴더는 보관하되 **윈도우 서버는 켜지 않습니다.**

## 8. 실제 접속 확인

1. 점검 명령을 실행합니다. 아무것도 바꾸지 않고 설정·DNS·인증서·보안 경계·방화벽을 확인합니다.

   ```text
   sudo dolivectl doctor
   ```

   마지막 줄의 결과는 세 가지입니다.

   | 마지막 줄 | 뜻 |
   | :--- | :--- |
   | `서버 안 서비스와 DNS·HTTPS 준비 확인됨` | 설정·서비스·DNS·인증서 확인 완료. 바깥 방화벽과 휴대폰 실제 통화는 아래 3~5단계로 따로 확인 |
   | `서버 안 서비스는 정상이지만 바깥 배포 준비 …를 아직 확인하지 못했어요` | `[미확인]` 항목(DNS A 레코드, HTTPS 인증서, 공인 IP)이 남음. **운영 준비 완료가 아닙니다** |
   | `위의 [실패] 항목을 고쳐 주세요` | 설정 오류·서비스 꺼짐·내부 번호가 바깥에 열림 등. 먼저 고칩니다 |

   처음에는 `[미확인] HTTPS 인증서가 아직 없거나`가 나올 수 있습니다. DNS가 Droplet을 가리키고 443번이 열려 있으면 Caddy가 몇 분 안에 인증서를 받습니다. 진행 기록은 `sudo dolivectl logs caddy`.
2. 서버 안 기능 시험을 실행합니다. 네 목소리의 글 읽기, 서버 안 경로의 입장·채팅·사진·빈 방 정리, **참가자와 같은 바깥 주소(`wss://도메인` → Caddy → LiveKit)의 연결과 입장·퇴장**을 실제로 확인합니다. 시험용 방을 잠시 만들고 지우므로 **방송 중에는 실행하지 않습니다.** 바깥 주소 시험은 DNS·인증서가 준비되기 전에는 실패하는 것이 정상입니다.

   ```text
   sudo dolivectl selftest
   ```

3. 휴대폰에서 **와이파이를 끄고 모바일 데이터로** `https://live.example.com`을 엽니다.
4. 도름스 로그인 후 두 사람이 같은 방에 들어가 양쪽 목소리를 확인합니다. 이어 화면공유, 카메라, 채팅 글·사진, `/안녕하세요` 글 읽기, 도름네이션을 확인합니다.
5. 다른 통신사·회사·학교 와이파이에서도 한 번 들어가 봅니다. UDP가 막힌 곳에서는 7881번으로 연결됩니다.

## 9. 마스터로 들어가기 (SSH 터널)

윈도우에서는 서버 컴퓨터의 `http://localhost`로 들어온 사람이 마스터(모든 방을 관리하는 사람)였습니다. Linux 서버에는 화면이 없으므로 **관리자 컴퓨터에서 SSH 터널(서버 안으로 이어진 비밀 통로)을 열어** 같은 방식으로 들어옵니다. 바깥 주소(`https://live.example.com`)로는 누구도 마스터가 될 수 없습니다.

1. 관리자 컴퓨터의 PowerShell이나 터미널에서 실행하고, 창을 열어 둡니다.

   ```text
   ssh -N -L 3000:127.0.0.1:3000 -L 7880:127.0.0.1:7880 root@203.0.113.10
   ```

   (일반 계정을 만들었다면 `root` 대신 그 계정 이름.) 아무 글도 나오지 않고 멈춘 것처럼 보이면 정상입니다.
2. 같은 컴퓨터의 브라우저에서 **`http://localhost:3000`**을 엽니다. 로그인 없이 마스터로 들어옵니다. 통화도 터널의 7880번을 거칩니다(소리·영상은 그대로 Droplet 공인 IP로 갑니다).
3. 끝나면 방에서 나와 터널 창에서 `Ctrl+C`로 닫습니다.

마스터 권한은 SSH에 들어갈 수 있는 사람에게만 있습니다. SSH 키를 남과 나눠 쓰지 않습니다. 관리자 컴퓨터에서 3000번을 이미 다른 프로그램이 쓰면 `-L 13000:127.0.0.1:3000`처럼 앞 번호만 바꾸고 `http://localhost:13000`을 엽니다. 7880은 바꾸지 않습니다.

## 10. 매일 운영

서버는 켜 두면 계속 돌아가고, Droplet을 다시 켜도 자동으로 시작합니다. 명령은 SSH로 접속해서 씁니다.

| 하고 싶은 일 | 명령 |
| :--- | :--- |
| 상태 한눈에 보기 | `sudo dolivectl health` |
| 끄기 (방 안 사람들에게 방송 종료를 먼저 알림) | `sudo dolivectl stop` |
| 켜기 | `sudo dolivectl start` |
| 다시 켜기 (설정 파일을 고친 뒤 적용) | `sudo dolivectl restart` |
| 기록 보기 | `sudo dolivectl logs` 또는 `sudo dolivectl logs web` (`-f`를 붙이면 계속 보기) |
| 한 프로그램만 다시 켜기 | `sudo dolivectl recover web` (`livekit`, `caddy`도 가능). 직전 기록을 `/var/lib/dolive/recovery`에 보관 |
| 자세한 systemd 상태 | `sudo dolivectl status` |

다시 켜기·복구를 하면 방 안 사람들의 연결이 잠시 끊길 수 있습니다. 방송 중에는 꼭 필요할 때만 씁니다.

## 11. 운영진과 방송 목록

권한(마스터·운영진·방 주인·회원·비회원)과 방송 만들기는 [첫 화면 안내](../../README.md#입장과-권한)를 따릅니다. 서버에서 관리하는 방법은 다음과 같습니다.

- Linux에는 켜기 창의 톱니바퀴가 없습니다. 운영진은 파일을 직접 고칩니다. 한 줄에 도름스 닉네임 한 명.

  ```text
  sudo -u dolive nano /opt/dolive/server/config/staff.txt
  ```

  `sudo -u dolive`를 꼭 붙여서 실행 계정 소유로 저장합니다. 다시 켤 필요는 없습니다.
- 방송 목록(`rooms.txt`)은 입장 화면에서 고칩니다. 마스터는 [9번](#9-마스터로-들어가기-ssh-터널) 터널로 들어옵니다.
- 채팅 글·사진은 서버 메모리에만 있고 방이 비거나 웹이 다시 켜지면 사라집니다(윈도우와 같음).

## 12. 백업과 복원

```text
sudo dolivectl backup
```

`/var/backups/dolive/dolive-backup-날짜-시각.tar.gz`가 생깁니다. 들어가는 것: 설정 파일(`/etc/dolive/dolive.env`), 방송 목록, 운영진, 옮겨 온 `.env.local`, 도름스 연동 메타데이터(`.dorms-login.json`, 있으면 `.dorms-login` 폴더), Caddy 인증서·ACME 계정. 모델까지 넣으려면 `--with-models`를 붙입니다(약 400MB).

- 백업에는 비밀값과 방 비밀번호가 있습니다. **서버 밖 개인 보관 장소로 옮기고**, 공개 링크·깃허브에 올리지 않습니다.
- 백업 파일은 root만 읽을 수 있습니다(권한 600). root로 접속한다면 관리자 컴퓨터에서 `scp root@203.0.113.10:/var/backups/dolive/dolive-backup-*.tar.gz .`로 가져옵니다. 일반 계정이면 서버에서 `sudo cp /var/backups/dolive/파일이름 ~/ && sudo chown $USER ~/파일이름`로 복사해 가져온 뒤 서버의 복사본은 지웁니다.
- 연달아 백업해도 이름이 겹치지 않고, 이미 있는 백업 파일을 덮어쓰지 않습니다. 백업 중 공간 부족 등으로 실패하면 `[실패]`로 끝나고 반쪽 파일을 남기지 않습니다.
- 다른 폴더에 두려면 `sudo dolivectl backup /root/dolive-backups`처럼 전체 경로를 적습니다. 없는 폴더는 root 전용(700)으로 만들고, 이미 있는 폴더는 소유자·권한·다른 파일을 바꾸지 않습니다. DOLIVE 코드 폴더(`/opt/dolive`), `/etc`, `/var/lib/dolive`, `/tmp`처럼 서비스·시스템이 쓰거나 누구나 쓸 수 있는 폴더는 거절합니다.
- Droplet 자동 백업(Backups)을 켜 두면 서버 전체도 되돌릴 수 있습니다.
- 업데이트와 복원은 시작 전에 자동으로 백업을 하나 더 만듭니다(같은 규칙). 그 백업을 만들지 못하면 아무것도 바꾸지 않고 멈춥니다.

되살리기:

```text
sudo dolivectl restore /var/backups/dolive/dolive-backup-20261014-120000-000.tar.gz
```

복원은 지금 상태를 먼저 따로 백업한 뒤, 방송을 닫고 서버를 끄고 파일을 되돌리고 다시 켭니다. 끝에 `--no-start`를 붙이면 되돌린 뒤 켜지 않습니다(새 서버로 옮길 때). 되살린 설정 파일의 공인 IP가 이 서버에 없으면 고치라고 알려 줍니다.

### 새 Droplet으로 옮기기

옛 서버의 방송 목록·운영진·설정·인증서를 새 Droplet으로 옮기는 순서입니다. **새 IP와 DNS를 정하기 전에는 서버를 켜지 않습니다.** 옛 IP로 켜진 통화 서버가 잘못된 주소를 알려 주는 일을 막기 위해서입니다.

1. 옛 서버에서 `sudo dolivectl stop`으로 끄고 `sudo dolivectl backup`으로 마지막 백업을 만든 뒤 관리자 컴퓨터로 가져옵니다. 이후 옛 서버는 켜지 않습니다.
2. 새 Droplet을 [3번](#3-droplet-만들기)처럼 만들고 [5번](#5-방화벽) 방화벽을 연결합니다. 새 공인 IP를 적어 둡니다.
3. [6번](#6-설치)의 1·2단계(기본 도구, 코드 받기)를 합니다.
4. **모델 준비까지 설치하되 켜지 않습니다.** 모델(약 400MB)을 받고 웹 화면을 만듭니다. 여기서 만든 설정 파일은 다음 단계에서 백업의 것으로 바뀝니다.

   ```text
   sudo /opt/dolive/scripts/linux/dolive-install.sh --no-start --domain 같은도메인 --public-ip 새IP
   ```

5. 백업 파일을 새 Droplet에 올리고(예: `scp dolive-backup-….tar.gz root@새IP:/root/`) **켜지 않고** 되살립니다. 설정 파일·방송 목록·운영진·도름스 연동 파일·인증서가 돌아옵니다.

   ```text
   sudo dolivectl restore /root/dolive-backup-….tar.gz --no-start
   ```

6. 공인 IP를 새 값으로 확정합니다. `sudo nano /etc/dolive/dolive.env`에서 `DOLIVE_PUBLIC_IP=`를 새 IP로 고치고 저장합니다. 주소(도메인)를 바꾼다면 `DOLIVE_DOMAIN`, `LIVEKIT_PUBLIC_URL`, `DORMS_SITE_URL`도 함께 고치고 도름스 등록 주소도 바꿉니다.
7. DNS A 레코드를 새 IP로 바꿉니다([4번](#4-주소dns-연결)). 내 컴퓨터에서 `nslookup 도메인`이 새 IP를 보여 줄 때까지 기다립니다.
8. 켭니다. 켜질 때 설정 파일을 읽으므로 통화 서버가 새 IP를 씁니다.

   ```text
   sudo dolivectl start
   sudo dolivectl doctor
   sudo dolivectl selftest
   ```

9. [8번](#8-실제-접속-확인)의 휴대폰 확인을 합니다. 확인이 끝나면 옛 Droplet은 삭제해야 요금이 멈춥니다(삭제 전에 백업을 다시 확인).

이미 켜져 있는 서버에서 설정 파일을 고쳤다면 `sudo dolivectl restart` 또는 설치 스크립트를 다시 실행해야 적용됩니다.

## 13. 새 버전으로 바꾸기

1. 사람들에게 점검 시간을 알립니다.
2. 실행합니다.

   ```text
   sudo dolivectl update
   ```

   이 명령은 백업 → 방송 닫기 → 새 코드 받기(`git pull --ff-only`와 같음) → 설치 부품·웹 화면 다시 만들기 → 켜기 → 응답 확인을 차례로 합니다. 보통 몇 분 걸립니다.
3. **실패하면 자동으로 이전 코드와 이전 웹 화면으로 되돌려 다시 켭니다.** 화면에 실패 이유와 기록 위치(`/var/lib/dolive/build.log`)가 나옵니다. 되돌린 뒤에도 켜지지 않으면 백업으로 [복원](#12-백업과-복원)합니다.
4. 이 명령은 `git clone`으로 설치한 서버에서만 씁니다. [깃허브에 아직 없는 코드로 설치하기](#깃허브에-아직-없는-코드로-설치하기)로 설치했다면 그 절의 바꾸는 순서를 따릅니다.
5. 서버에서 코드를 직접 고친 적이 있으면 덮어쓰지 않으려고 멈춥니다. 강제로 덮어쓰지 말고 유지보수 담당자와 확인합니다.
6. 끝나면 [8번](#8-실제-접속-확인)의 휴대폰 확인을 합니다.

Node.js·LiveKit·Caddy·모델의 버전은 [server/linux/versions.env](../../server/linux/versions.env)에 고정되어 있습니다. 유지보수 담당자가 이 파일의 버전과 공식 체크섬을 바꿔 올리면, 업데이트 때 설치 스크립트가 새 프로그램을 받아 체크섬을 확인한 뒤 다시 켭니다(업데이트는 세 프로그램을 모두 잠시 끄고 켭니다). 체크섬이 다르면 받은 파일을 쓰지 않고 멈춥니다.

## 14. 문제가 생겼을 때

먼저 `sudo dolivectl health`와 `sudo dolivectl doctor`를 실행합니다. 기록을 다른 사람에게 보낼 때는 비밀값·개인정보가 없는지 확인합니다.

| 증상 | 확인 순서 |
| :--- | :--- |
| 설치가 중간에 멈춤 | 화면의 `[실패]` 줄과 `/var/lib/dolive/build.log`로 원인을 고친 뒤 같은 설치 명령을 다시 실행. 앞서 파일만 바뀌고 적용되지 못한 프로그램을 이번에 다시 켭니다 |
| 설치 중 "체크섬이 달라요" | 받는 중 파일이 깨졌거나 배포처가 바뀐 것. 다시 실행해 보고, 계속되면 유지보수 담당자에게 알립니다. 무시하고 넘기지 않습니다 |
| 웹 화면 만들기 실패 | `/var/lib/dolive/build.log` 끝부분 → 메모리 부족이면 Droplet 사양 확인 → 설치 스크립트를 `--build`로 다시 실행 |
| 바깥 주소가 안 열림 | DNS A 레코드가 Droplet IP인지 → 클라우드 방화벽의 443 → `sudo dolivectl logs caddy` |
| 인증서 오류 | A 레코드와 AAAA 레코드(다른 곳을 가리키면 지우기) → 443 허용 → Cloudflare 주황 구름 끄기 → Caddy 기록. 인증서를 여러 번 실패하면 발급처가 잠시 막을 수 있으니 원인을 고친 뒤 기다립니다 |
| 입장은 되지만 소리·영상이 안 옴 | 방화벽의 TCP 7881, UDP 50000~60000 → 설정의 `DOLIVE_PUBLIC_IP`가 실제 공인 IP(또는 Reserved IP)인지 → 고쳤다면 `sudo dolivectl restart` → `sudo dolivectl logs livekit`의 `starting LiveKit server` 줄의 `nodeIP`가 그 IP인지 |
| 입장권 오류 | `/etc/dolive/dolive.env`의 `LIVEKIT_API_KEY`·`LIVEKIT_API_SECRET`이 비어 있거나 쓸 수 없는 글자가 있는지(`sudo dolivectl doctor`), 고친 뒤 `restart` 했는지. 키 이름은 `dolive`가 아니어도 됩니다 |
| 통화 서버가 계속 꺼짐 | `sudo dolivectl logs livekit`에서 `[실패]` 줄. 설정이 빠진 경우 다시 켜기를 멈추고 이유를 적어 둡니다 |
| 도름스 로그인 실패 | 도름스 사이트 등록·허용 → `DORMS_CLIENT_ID` → `DORMS_SITE_URL`이 `https://도메인`인지 → 도름스에 등록한 사이트 주소가 지금 도메인과 같은지 |
| 도름네이션이 안 됨 | 도름스 관리자 승인이 끝났는지(사이트 카드의 상태) → 보내는 사람이 처음 한 번 보내기를 허용했는지 → 오늘 한도(하루 3도름) |
| 글 읽기 실패 | `sudo dolivectl selftest` → `sudo dolivectl logs web` → 모델 파일(`doctor`) → CPU 사용률(`top`) |
| 빈 방 채팅이 안 지워짐 | `selftest` 결과 → `sudo dolivectl logs livekit`에서 webhook 오류 |
| SSH가 갑자기 안 됨 | 등록한 SSH 키를 가진 컴퓨터인지 → 클라우드 방화벽의 SSH 규칙(모두 허용인지, IP로 묶었다면 IP가 바뀌었는지) → Recovery Console |

## 15. 사양과 한계

- **목표**: 평소 10~20명, 최대 50명, 방송 약 3시간, 주 4~5회. 방송(방)은 최대 4개. 화면공유를 보는 사람이 많고 일부만 마이크·카메라를 켜는 사용을 기준으로 합니다. 전송량은 참가자 한 명 평균 3Mbps로 어림합니다([2번](#데이터-전송량트래픽-어림-계산)).
- **4 vCPU / 8GB는 시작 사양**입니다. 50명 동시 접속과 그 상태의 글 읽기는 **실제 부하시험을 하지 않았으므로 보장하지 않습니다.** 처음 몇 번의 큰 방송에서 DigitalOcean 제어판의 CPU·메모리·Bandwidth 그래프를 확인하세요. CPU가 오래 80%를 넘거나 소리가 끊기면 Droplet을 더 큰 사양으로 바꿉니다(Resize, 잠시 꺼짐).
- 글 읽기는 모든 방송이 한 줄로 차례를 기다립니다. 웹은 의도적으로 한 프로세스만 씁니다(채팅·사진·글 읽기 순서가 그 메모리에 있기 때문).
- 채팅 사진은 합쳐서 300MB까지 메모리에 둡니다.
- TURN(통신을 중계하는 별도 서버)은 설정하지 않았습니다. UDP와 7881번이 모두 막힌 회사·학교 망에서는 연결되지 않을 수 있습니다.

## 16. 파일 위치

| 위치 | 내용 |
| :--- | :--- |
| `/opt/dolive` | DOLIVE 코드 (실행 계정 `dolive` 소유) |
| `/etc/dolive/dolive.env` | 도메인·공인 IP·통화 키·도름스 설정 (root와 `dolive`만 읽음) |
| `/opt/dolive/server/config/rooms.txt`, `staff.txt` | 방송 목록·운영진 (윈도우와 같은 형식) |
| `/opt/dolive/apps/web/models/supertonic` | 글 읽기 모델 |
| `/opt/dolive/server/bin` | 받은 Node.js·LiveKit·Caddy (버전 기록 `.versions`) |
| `/var/lib/private/dolive-caddy` | HTTPS 인증서·ACME 계정 (지우면 인증서를 새로 받음) |
| `/var/lib/dolive` | 웹 빌드 기록(`build.log`), 복구 기록(`recovery`) |
| `/var/lib/dolive-applied` | 각 프로그램이 마지막으로 정상 기동한 파일·설정의 지문 (설치 재실행 때 다시 켤지 판단, root 전용) |
| `/var/backups/dolive` | 백업 파일 |
| `server/linux/` | Linux용 Caddy·LiveKit·systemd 설정, 고정 버전과 체크섬 |
| `scripts/linux/` | 설치 스크립트, `dolivectl`, 시험 도구 |
| 기록 | `journalctl` (`sudo dolivectl logs`) |

## 17. 확인한 것과 아직 확인하지 못한 것

개발용 컴퓨터(Apple 칩)에서 시험 전용 가상 머신을 만들고, 그 안의 Ubuntu 24.04 **ARM64** 컨테이너에서 systemd로 실제 설치·운영 명령을 시험했습니다(`scripts/linux/tests/container-test.sh`). 인증서는 Caddy 내부 시험 인증서만 썼고, 시험 중 외부 인증서 발급처에는 연결하지 않았습니다.

| 시험 묶음 | 확인한 내용 |
| :--- | :--- |
| 첫 설치 | 프로그램·모델 체크섬, 세 서비스 실행·자동 시작(각각 확인), 실행 계정, 비밀값이 Caddy·명령줄에 없음, LiveKit이 설정의 공인 IP 사용 |
| 번호와 주소 | 3000·7880은 127.0.0.1만, 7881·443은 바깥, Caddy 관리 창구 없음, `localhost`가 IPv4·IPv6 둘 다일 때 웹·통화 연결 |
| 마스터 경계 | 바깥 주소·위조 헤더·Host/SNI 위조로 마스터 불가, 서버 안·SSH 터널에서만 마스터 |
| 점검과 기능 시험 | `doctor`가 인증서 미확인(끝 코드 2)·확인 완료(0)·바깥 주소에 열린 내부 번호(1)를 구분, `selftest`의 네 목소리 글 읽기, 서버 안 입장·채팅·사진·빈 방 정리, **`wss://도메인` → Caddy 경유 WebSocket 연결과 SDK 입장·퇴장** |
| 다시 설치 | 설정·방송 목록·운영진·모델·인증서 보존, 바뀐 것 없으면 다시 켜지 않음. **설치가 다시 켜기 단계에서 실패한 뒤 다시 실행하면 바뀐 공인 IP·Caddy 설정이 실행 중 프로그램에 적용**, Caddy 설정만 바뀌면 Caddy만 다시 켬 |
| 복구·끄기·켜기·재부팅 | 한 프로그램만 다시 켜기, 강제 종료 뒤 자동 재기동, 재부팅 뒤 자동 시작과 인증서 유지 |
| 백업과 복원 | 연달아 만든 두 백업이 서로 다른 파일이고 각 시점 내용 그대로 복원, 복원 직전 자동 백업도 새 파일, 기존 폴더의 소유자·권한·다른 파일 보존, 새 폴더 700, 코드·서비스·임시 폴더 거절, 공간 부족 시 실패 보고와 반쪽 파일 없음 |
| 새 서버로 옮기기 | 켜지 않고 설치(모델 받기) → 켜지 않고 복원 → 새 IP 확정 → 켜기: 설정·방송 목록·운영진·인증서 보존, 실행 중 LiveKit이 새 IP 사용, `doctor`·`selftest` 통과 |
| 업데이트 | 성공, 깨진 코드면 실패 보고 후 이전 코드로 되돌려 정상 기동 |
| 기존 통화 키 옮기기 | 시험용으로 새로 만든 윈도우식 `.env.local`(키 이름 `dolive` 아님, 임의 비밀값)로 설치: 이름·비밀값이 그대로 옮겨지고(비밀값은 해시로 비교) 입장권 키와 퇴장 알림 키가 같은 키, `doctor`·`selftest`(네 목소리, 마지막 퇴장 때 빈 방 정리, `wss://도메인` 입장·퇴장) 통과, 다시 설치·재부팅 뒤에도 보존. 쓸 수 없는 글자가 든 값은 설치가 설정 파일을 만들지 않고 멈추고, 설정 파일에 잘못 넣으면 LiveKit이 설정 오류로 멈춤(반복 재시작 없음). 새 설치의 기본 키 이름 `dolive`도 같은 시험에서 확인 |
| 안전 | systemd 설정 검사, 외부 ACME 기록·계정 저장소 없음, 시험 가상 머신의 binfmt 등록이 시험 전후 같음 |

**x86-64**(실제 Droplet과 같은 종류)는 에뮬레이션이 불안정해(설치 부품 설치 중 충돌, Caddy 실행 간헐 충돌) systemd 전체 시험을 하지 못했습니다. 에뮬레이션으로는 프로그램 받기·체크섬, 설치 부품(`npm ci`), 네이티브 모듈 불러오기, 세 목소리 글 읽기 합성만 따로 확인했고, 속도 값은 성능 근거가 아닙니다.

다음은 **실제 Droplet에서 아직 확인하지 못했습니다.** [18번](#18-실제-운영-전-확인-순서) 순서로 확인하세요.

- x86-64 Droplet에서의 설치·기동 전체와 글 읽기 속도
- 실제 도메인으로 Let's Encrypt 인증서 받기(443번 방식)
- 모바일 데이터 휴대폰의 바깥 접속, 양방향 통화, 화면공유, 카메라
- 실제 도름스 로그인과 도름네이션
- DigitalOcean 클라우드 방화벽과 Reserved IP 조합의 통화 연결
- 10명 이상 동시 접속 부하 (50명은 보장하지 않음)

## 18. 실제 운영 전 확인 순서

실제 방송 공지 전에 아래를 순서대로 하고 결과를 적어 둡니다. 한 단계가 실패하면 다음으로 넘어가지 않습니다.

1. **주소와 인증서**: DNS A 레코드 → `sudo dolivectl doctor` 마지막 줄이 `DNS·HTTPS 준비 확인됨`인지(끝 코드 0). 관리자 컴퓨터 브라우저에서 `https://도메인`이 경고 없이 열리는지.
2. **서버 안 기능**: `sudo dolivectl selftest`가 `[실패]` 없이 끝나는지(글 읽기 네 목소리, 서버 안 경로, 바깥 `wss://` 경로).
3. **휴대폰 바깥 접속**: 와이파이를 끈 휴대폰(가능하면 통신사 두 곳)과 다른 망의 컴퓨터로 입장 → 양방향 목소리, 화면공유 보기·하기, 카메라, 채팅 글·사진, `/` 글 읽기.
4. **도름스·도름네이션**: 회원 로그인·로그아웃, 비회원 입장, 운영진·방 주인 권한, 도름네이션 소액 1건과 화면 표시. 실패하면 도름스 등록 주소와 `DORMS_SITE_URL`부터 확인.
5. **사람 수를 늘려 시험 방송**: 10명 → 20명 → 50명 순서로 단계마다 따로 합니다. 각 단계는 화면공유 1개를 모두가 보고, 일부(예: 2~3명)만 카메라·마이크를 켜고, 중간중간 `/` 글 읽기를 넣어 **목표 3시간**(최소 1시간)을 유지합니다. 50명을 모으기 어렵다면 그 단계는 "미확인"으로 남깁니다.
6. **단계마다 기록할 것**

   | 관찰 항목 | 보는 곳 | 기록 |
   | :--- | :--- | :--- |
   | CPU 사용률(최고·평균) | DigitalOcean 제어판 Graphs, 서버의 `top` | 오래 80%를 넘는지 |
   | 메모리 사용량 | 제어판 Graphs, `free -h` | 남은 메모리, 스왑 사용 여부 |
   | 전송량 | 제어판 Bandwidth | 1시간당 GB → [2번](#데이터-전송량트래픽-어림-계산)의 1인 1.35GB 가정과 비교 |
   | 끊김·지연 | 참가자 체감, `sudo dolivectl logs livekit` | 소리 끊김·화면 멈춤 시각, 다시 들어온 사람 수 |
   | 글 읽기 대기 | 실제 방송 중 체감 | 입력 뒤 읽기까지 걸린 시간 |
   | 프로그램 재시작 | `sudo dolivectl status`, `sudo dolivectl logs` | 방송 중 자동 재시작이 있었는지 |

7. **판단**: 각 단계에서 CPU가 오래 80%를 넘거나 끊김이 반복되면 더 큰 사양으로 바꾸고 그 단계를 다시 합니다. 시험한 최대 인원까지만 "확인됨"으로 적고, 시험하지 않은 인원(예: 50명)은 보장하지 않습니다.
