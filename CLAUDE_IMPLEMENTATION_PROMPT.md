# [CLAUDE_TASK] DOLIVE 구현 지침서

> 최종 수정: 2026-09-26. 확정 사양은 `DOLIVE_Master_Plan.md`가 기준이다.
> 녹화·AI 요약·음성 인식(Whisper/Ollama)은 사용자 결정으로 제외했다. 다시 넣자고 하기 전에는 만들지 않는다.

---

## 1. 호스트 환경 (제약 조건)
* **OS**: Windows 11 (PowerShell 5.1)
* **Node.js** `v24.15.0`: `npm.cmd`, `npx.cmd` 사용
* **도커 없음**: 모든 서버는 윈도우 exe 또는 로컬 프로세스
* **스크립트**: `.ps1` 사용. `.bat`은 ASCII만
* **네트워크**: SK브로드밴드 GNT245 직결 (내부 IP 192.168.75.191 고정). 외부 80번 포트 사용 불가

---

## 2. 현재 구성

| 부분 | 위치 | 비고 |
|---|---|---|
| 통화 서버 | `server/bin/livekit-server.exe`, `server/config/livekit.yaml` | 7880, TCP 7881, UDP 50000-60000. `use_external_ip` + `advertise_internal_ip` |
| 웹 | `apps/web` (Next.js 16.3, Tailwind 4, `@livekit/components-react`) | `127.0.0.1:3000`에만 열림 |
| 토큰 | `apps/web/app/api/token/route.ts` | Host가 localhost이고 X-Forwarded-For가 루프백뿐이면 방장. 바깥 사용자에게는 `LIVEKIT_PUBLIC_URL` |
| 아바타 그림 | `apps/web/app/avatars/[name]/[frame]/route.ts` | 루트 `assets/avatars`를 그대로 보여 줌 |
| HTTPS | `server/bin/caddy.exe`, `server/config/Caddyfile` | `/rtc*`, `/twirp/*` → 7880, 나머지 → 3000. 인증서는 TLS-ALPN(443)만 |
| 주소 | `server/config/duckdns.env` | `dolive.duckdns.org`. 스크립트 실행 때 IP 갱신 |
| 실행 | `scripts/start_dolive.ps1` | `-Local`(내 PC만), `-Build`(코드 바꾼 뒤), `-Stop` |

* 채팅방은 하나 (`ROOM = "dolive"`, 주소 `/room`). 입장 화면(`app/page.tsx`)에서 마이크/카메라를 미리 켜 보고, 그 상태(`sessionStorage` mic/cam)로 입장.
* 채팅: `useChat` (LiveKit 기본 토픽 `lk.chat`). 저장하지 않음.
* 개발 모드: 미리보기(`.claude/launch.json`)는 `autoPort`로 3001번 이후의 빈 번호를 써서, 3000번 완성품 웹과 같이 켜 둘 수 있다.

---

### git에 없는 파일 (새로 받았을 때 준비)
* `server/bin/`: [LiveKit v1.13.7 windows_amd64](https://github.com/livekit/livekit/releases), [Caddy windows_amd64](https://github.com/caddyserver/caddy/releases)의 exe
* `server/config/livekit.yaml`: `livekit.example.yaml`을 복사하고 비밀번호(32자 이상) 넣기
* `server/config/duckdns.env`: `duckdns.example.env`를 복사하고 이름·토큰 넣기
* `apps/web/.env.local`: `LIVEKIT_API_KEY=dolive`, `LIVEKIT_API_SECRET=<livekit.yaml과 같은 값>`
* `npm.cmd --prefix apps/web install`

## 3. 캐릭터
* 4종: cocomong, doraemon, pororo, shinchan (`apps/web/lib/dolive.ts`의 `AVATARS`). 그림은 `assets/avatars/<id>/idle.png`, `talk.png`.
* 저장된 캐릭터가 목록에 없으면 `savedAvatar()`가 첫 캐릭터로 바꿔 줌.
