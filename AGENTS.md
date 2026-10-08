# DOLIVE 인수인계 (AI 작업자용)

2026-10-07 작성. 지금까지 Claude 가 만들고 관리하던 DOLIVE 를 이어받는 AI 작업자(GPT 등)를 위한 문서다.
작업 전에 이 파일을 끝까지 읽는다. 아래 "사용자와 말하는 법"과 "정해진 것들"은 사용자가 직접 정한 규칙이다.

---

## 1. 사용자와 말하는 법 (반드시 지킬 것)

- 항상 **한국어**로, **초등학생도 알아듣는 쉬운 말**로 말한다. 중간 안내 한 줄, 긴 작업 뒤 결과 보고도 마찬가지다. (영어로 결과를 보고했다가 사용자가 크게 화낸 적이 두 번 있다)
- 전문 용어와 영어 단어는 쓰지 않는다. 꼭 써야 하면 바로 옆에 쉬운 말로 풀어 쓴다. 예: "포트포워딩(밖에서 들어오는 길)"
- 결론을 먼저 짧게 말하고, 이유는 한두 줄만 붙인다.
- 사용자가 직접 해야 할 일은 "1. 2. 3." 순서로 아주 쉽게 적는다.
- **이모지는 어디에도 쓰지 않는다.** 앱 화면 글자, 코드 주석, 문서, 커밋 메시지, 답변 모두.
- 디자인·아이콘 후보를 고르게 할 때는 글로만 설명하지 말고 실제 화면처럼 그린 **그림 파일(PNG)**을 먼저 보여 준다.
- "추가해 달라"인지 "바꿔 달라"인지 헷갈리면 물어본다. 사용자가 원래 쓰던 것(예: 서연 목소리)을 지우기 전에는 꼭 물어본다.
- 새 도구나 라이브러리가 필요하면 깃허브 오픈소스부터 찾아 비교해서 보여 준다. 컴퓨터에 원래 깔린 것은 그다음이다.

## 2. DOLIVE 가 뭔가

동호회용 음성 채팅 + 화면공유 + 채팅 웹사이트. 디스코드 비슷한데 얼굴(카메라) 대신 프로필 사진을 쓴다.

- 주소: `https://dolive.duckdns.org` (친구들), 서버 PC 에서는 `http://localhost` (방장)
- 서버 비용 0원. 집 윈도우 PC 한 대가 서버다. 도커 없이 윈도우 프로그램을 바로 돌린다.
- 웹 전용 (휴대폰 앱 없음). 한 방 11~20명 목표.
- 입장은 **도름스(https://dorms.school) 회원만**. 서버 PC 에서 localhost 로 들어온 사람은 로그인 없이 방장이다.

## 3. 구조

```
친구 브라우저 --443--> 공유기(SK GNT245) --> 서버 PC
                                           Caddy (443, 인증서 자동)
                                             /rtc, /twirp  -> LiveKit 127.0.0.1:7880 (통화 서버)
                                             나머지        -> Next.js 127.0.0.1:3000 (웹 화면 + API)
친구 브라우저 --TCP 7881, UDP 50000-60000--> LiveKit (실제 소리·화면 데이터)
```

- **LiveKit** (`server/bin/livekit-server.exe`): 음성·화면공유를 주고받는 통화 서버. 설정 `server/config/livekit.yaml`
- **Next.js 16** (`apps/web`): 입장 화면, 방 화면, API. 채팅 기록·채팅 사진은 **서버 메모리에만** 있다 (서버를 끄면 사라짐, 파일로 저장하지 않는 것이 사용자 결정).
- **Caddy** (`server/bin/caddy.exe`): https 인증서를 받고 바깥 요청을 위 둘로 나눠 준다. 설정 `server/config/Caddyfile`
- **DuckDNS**: 켤 때마다 집 공인 IP 를 `dolive.duckdns.org` 에 알린다 (`scripts/start_dolive.ps1`).
- **TTS**: 채팅에 "/글" 을 쓰면 서버가 Supertonic 3 (`apps/web/models/supertonic`, 약 400MB, 깃에 없음) 으로 읽어서 "음성" 참여자로 방에 소리를 흘린다 (`apps/web/lib/voice.ts`).

## 4. 폴더 지도

| 위치 | 내용 |
| :--- | :--- |
| `DOLIVE.lnk` | 서버 켜기 창 바로가기 (`scripts/dolive_panel.ps1` 를 창 없이 연다) |
| `scripts/dolive_panel.ps1` | 서버 켜기/끄기 창 + 톱니바퀴 "DOLIVE 설정" 창 ([방송 관리자]=운영진, [채팅방 관리]=방 목록) |
| `scripts/start_dolive.ps1` | 실제로 켜고 끄는 스크립트. `-Stop` 끄기, `-Build` 웹 다시 만들기, `-Local` 바깥 연결 없이 이 PC 에서만 |
| `apps/web/app/page.tsx` | 입장 화면 (프로필 사진 고르기, 닉네임, 방송 목록, "LIVE 입장") |
| `apps/web/app/room/*` | 방 화면 (stage=참여자 줄, chat=채팅, share=화면공유, tts=TTS 설정 창, menu=오른쪽 클릭 메뉴, reactions) |
| `apps/web/app/api/*` | token(입장권), chat(채팅), voice/tts(음성), rooms(방송 목록), end/kick/mute/share(방장 기능), auth/dorms(도름스 로그인), preview(링크 미리보기) |
| `apps/web/lib/server.ts` | 방장 판단(isLocal), 운영진(staff.txt), 방 목록(rooms.txt), LiveKit 에 일 시키기 |
| `apps/web/lib/chat.ts` | 채팅 기록 (메모리, 사진은 합쳐서 300MB 까지) |
| `apps/web/lib/dormsLogin.ts` | 도름스 로그인 (dorms-login 도구 v0.2.0 이 넣은 코드, `.dorms-login.json`) |
| `assets/profile/1~11.webp` | 기본 프로필 사진 (240x300) |
| `server/logs/` | 켤 때 나오는 기록 (`livekit/web/caddy .out.log .err.log`, `build.log`) |
| `DOLIVE_Master_Plan.md` | 처음 기획서 (일부 옛 내용. 이 문서가 더 최신) |

## 5. 깃에 없는 파일 (폴더째 복사로만 옮겨짐, 절대 커밋하지 말 것)

| 파일 | 내용 |
| :--- | :--- |
| `server/config/livekit.yaml` | LiveKit 설정 + 비밀 키 (`livekit.example.yaml` 이 틀) |
| `server/config/duckdns.env` | DuckDNS 이름과 토큰 (`duckdns.example.env` 가 틀) |
| `server/config/staff.txt` | 운영진 도름스 닉네임, 한 줄에 한 명 |
| `server/config/rooms.txt` | 방송 목록, 한 줄에 `방 이름<탭>비밀번호<탭>staff 또는 everyone` (비밀번호 비워도 됨). 마지막 칸이 없거나 staff면 운영 권한은 방송 관리자만, everyone이면 "누구나" 방(아래 8번). 파일이 없으면 비밀번호 없는 "DOLIVE" 방 하나 |
| `apps/web/.env.local` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (livekit.yaml 의 keys 와 같아야 함), `DORMS_CLIENT_ID`, `DORMS_SITE_URL` |
| `server/bin/*.exe` | livekit-server, caddy, lk(LiveKit 명령 도구) |
| `apps/web/models/supertonic/` | TTS 모델. 다시 받는 법은 `apps/web/lib/voice.ts` 맨 위 주석 |

staff.txt, rooms.txt 는 서버 켜기 창 톱니바퀴에서 고치면 바로 저장되고, 웹 서버가 요청마다 다시 읽어서 재시작 없이 바로 적용된다.

## 6. 켜고 끄기

- 보통: `DOLIVE.lnk` 더블클릭 → 켜기 창에서 켜기/끄기.
- 명령으로: `powershell -ExecutionPolicy Bypass -File scripts\start_dolive.ps1` (끄기는 `-Stop`).
- `apps/web/app`, `components`, `lib`, `package.json` 이 마지막 빌드보다 새로우면 켤 때 **알아서 다시 빌드**한다 (1분쯤). 그래서 코드를 고친 뒤에는 서버를 껐다 켜면 반영된다.
- 끌 때 먼저 `/api/end` 를 불러서 방 안 사람들에게 "방송이 끝났어요" 를 띄운다.
- 개발용 서버: `npm --prefix apps/web run dev -- -p 3001` (실제 서버가 3000 을 쓰고 있으므로 다른 번호). 개발 서버도 같은 LiveKit(7880)을 쓰므로 LiveKit 은 켜져 있어야 한다.

## 7. 집 네트워크

- 공유기: **SK브로드밴드 GNT245**, 관리 화면 `http://192.168.75.1`. 공인 IP 1.247.94.20 (거의 안 바뀜).
- 서버 PC 내부 주소 **192.168.75.193** 고정: 공유기 [서비스] → 왼쪽 [서비스] → [DHCP] → 맨 아래 [MAC 기반 할당]. 2026-10-08 부터 서버 PC 는 라이젠 5 7600X PC(유선, MAC `34-5A-60-6C-03-69`). 그 전에 쓰던 191번 PC 는 폐기했다.
- 포트포워딩 ([서비스] → [방화벽] → [포트 포워딩]): TCP 443, TCP 7881, UDP 50000-60000 → 192.168.75.193 (DOLIVE-HTTPS / DOLIVE-RTC-TCP / DOLIVE-RTC-UDP 세 줄).
  이 공유기는 줄을 고치는 기능이 없어서, 주소를 바꾸려면 그 줄만 체크해 [선택된 항목 삭제] 하고 새로 [추가] 한다. [모두 삭제] 는 누르지 않는다.
  예전에 있던 "horizon" (49152) 줄은 폐기한 191번 PC 용이라 2026-10-08 사용자가 지웠다.
- 서버 PC 성능: TTS("/글") 가 CPU 를 가장 많이 쓴다. 인텔 N100(4코어) 으로 시험했을 때 TTS 를 쓸 때마다 CPU 100% 로 모두 렉이 걸렸다. 7600X 는 한 줄에 0.35초쯤으로 여유. 5600G 급(6코어) 이상을 쓴다. TTS 가 쓰는 코어 수를 묶으면 렉은 줄지만 TTS 가 늦게 나와서 사용자가 원하지 않았다.
- 이 공유기는 바깥 80번 포트를 막는다. 그래서 Caddy 는 `disable_http_challenge` 로 443 번만 써서 인증서를 받는다. 80 번을 쓰는 방법으로 바꾸지 말 것.
- 윈도우 네트워크가 "공용" 으로 잡혀 있을 수 있어서 방화벽 허용은 공용 쪽에도 있어야 한다.

## 8. 정해진 것들 (사용자 결정, 다시 제안하지 말 것)

- **빼기로 한 것**: 카메라(웹캠), 녹화, AI 회의록 요약, 음성 인식, 휴대폰 앱, 도커. 사용자가 먼저 다시 말하기 전에는 제안하지 않는다. 2026-10-07 카메라를 만들다가 사용자 요청으로 모두 제거했다.
- **방장** = 서버 PC 에서 localhost 로 들어온 사람. **운영진** = staff.txt 에 적힌 도름스 닉네임 (방장 권한을 똑같이 받음, 다음 입장부터). 비밀번호로 관리자 로그인하는 방식은 없앴다.
- 방장·운영진 기능: 참여자 줄에서 오른쪽 클릭(휴대폰은 꾹 누르기) → 화면공유 권한 주기·거두기 / 마이크 끄기 / 강퇴하기. 강퇴한 사람이 다시 들어오는 것은 막지 않는다.
- 채팅방 관리의 "운영 권한"에서 "방송 관리자만" 또는 "누구나"를 고른다. 처음 값은 "방송 관리자만"(일반 참여자는 마이크만, 화면공유는 방장이 허락). "누구나" 방은 운영진이 없어도 열 수 있는 방이다: 지금 남아 있는 사람 중 **가장 먼저 들어온 사람**이 방장처럼 화면공유·강퇴·마이크 끄기·공유 허락을 할 수 있고, 그 사람이 나가거나 강퇴되면 **그다음으로 먼저 들어온 사람**이 바로 이어받는다. 나머지 사람은 보통 방과 같다. 서버가 통화 서버의 입장·퇴장 소식(`/api/livekit`)마다 골라서 참여자 표시 `roomAdmin` 을 붙인다 (`lib/chat.ts` 의 `pickHost`). 방장·운영진 권한과 비밀번호 확인은 그대로. 설정은 저장 후 다음 입장부터 적용.
- **방송 여러 개**: 입장 화면에서는 "방송 목록" 이라고 부른다 ("채팅방 목록" 이라고 쓰지 말 것). 비밀번호 방은 비밀번호 창, 방장·운영진은 안 물음. 방장·운영진이 들어가 있거나 누군가 화면공유 중이면 방 이름 옆 ON AIR. 방을 지우면 안에 있던 사람은 바로 나가진다. 채팅 기록·음성은 방마다 따로.
- **프로필 사진**: 2줄 x 6칸. 기본 사진 1~9번 + 도름스 프로필 사진 + 내 사진(점선 빈 원) + [+]. 내 사진은 **서버에 파일로 저장 금지**. 그 사람 브라우저(localStorage)에 남기고, 입장할 때 서버 메모리에만 올린다.
- 말하는 사람은 초록 테두리만. 위아래로 튀는 움직임 효과는 넣지 말 것 ("정신 사납다").
- **채팅 기록**: 한 명이라도 남아 있으면 글·사진을 메모리에 쌓아서 나중에 들어온 사람도 본다. 모두 나가면 그 방의 글·사진을 지운다. 파일 저장은 안 한다. 읽어 주는 '음성' 참여자는 인원에 넣지 않는다.
- **TTS**: 목소리는 서연·하은(여자) / 민준·마왕(남자) 4개. 입력 방식은 끄기 / 항상 / "/입력" 세 가지, 처음 값은 "/입력"·서연. 각자 마이크 스위치 왼쪽 "TTS" 버튼에서 고르고 브라우저에 저장. 보낸 사람도 바로 듣는다. 말풍선 앞 작은 스피커로 다시 듣기 (누를 때 서버가 다시 읽음, 소리 저장 안 함). 소리 크기는 `lib/voice.ts` 의 `PEAK`, `DRIVE` (2026-10-06 DRIVE 를 0 으로 낮춤).
- 방장 화면공유는 DOLIVE 창 소리(TTS·다른 사람 목소리)를 빼고 배경음악만 담는다. 말하거나 TTS 가 나올 때 화면공유 소리를 줄인다(마이크 30%, TTS 15%).
- 화면공유 고르는 창은 브라우저가 띄우는 것이라 직접 만들 수 없다.
- **휴대폰 화면은 사용자가 "완벽하다" 고 했다.** PC 화면을 고칠 때 휴대폰 쪽은 건드리지 않는다.

## 9. 코드를 고칠 때

- `apps/web` 의 Next.js 는 **16 버전**이라 예전에 알던 것과 다를 수 있다. 고치기 전에 `apps/web/node_modules/next/dist/docs/` 의 해당 안내를 먼저 읽는다 (`apps/web/AGENTS.md`).
- 기존 코드처럼 쓴다: 주석은 쉬운 한국어, 짧고 단순하게. 새 라이브러리나 추상화보다 이미 있는 코드와 기본 기능을 먼저 쓴다. 일부러 단순하게 한 곳은 `ponytail:` 주석으로 한계와 나중 방법을 적어 둔다.
- 화면 글자·버튼 이름은 사용자가 하나하나 정한 것이 많다. 이유 없이 바꾸지 않는다.
- 브라우저로 방(`/room`)에 들어가 확인했다면, 끝나면 꼭 `/` 로 나온다. 확인용 탭이 방에 남아 있으면 사용자 목소리가 서버 PC 스피커로 되울린다.
- 바꾼 뒤에는 서버를 껐다 켜서(자동 빌드) 실제로 확인하고, 실패하면 `server/logs/build.log` 를 본다.
- 커밋 메시지는 한국어로, 무엇을 왜 바꿨는지 쉬운 말로. 이모지 없이. 사용자가 원할 때만 커밋한다. 원격 저장소는 GitHub `https://github.com/cordmin/DOLIVE` (`origin`, `main` 가지). 올리기(푸시)도 사용자가 원할 때만. `DOLIVE.lnk` 는 안에 그 PC 의 폴더 위치가 들어 있어서 PC 마다 다르다. 다른 PC 에서 받은 것으로 덮어쓰지 말고, 고친 것도 올리지 않는다 (만드는 법은 11번 4).

## 10. 남은 일과 주의할 점

- 빈 방 채팅 삭제는 통화 서버의 퇴장 알림(`/api/livekit`)으로 처리하고 입장권 발급 전에도 확인한다. `livekit.yaml`의 `webhook` 설정이 필요하다(`livekit.example.yaml` 참고). 서명 없는 알림은 거절한다. 확인 명령: `cd apps/web; node tests/room-lifecycle.cjs`, "누구나" 방 운영 권한 넘겨주기는 `node tests/room-sharing.cjs --live` (둘 다 서버가 켜진 상태). 확인용 방만 만들고 끝나면 원래 목록으로 돌아간다.

- 도름스 "연결 끊기·입장 조건 바꾸기 → 다음 채팅부터 막히고 방에서 내보내짐(403)" 시험을 아직 못 했다. 도름스에 그 기능이 생기면 해야 한다.
- `app/api/auth/dorms/` 의 세 파일은 dorms-login 도구가 넣은 것인데, Caddy 뒤에서 주소가 틀어지는 문제 때문에 `publicUrl` 을 쓰게 고쳐 두었다. 도구를 업그레이드하면 이 차이를 다시 합쳐야 한다.
- `apps/web/.env.local` 의 "/admin 부방장 비밀번호" 주석은 옛날 것이다 (그 기능은 없어짐).
- 인증서는 Caddy 가 알아서 받고 갱신한다. 새 PC 에서 처음 켜면 새로 받는다 (443 이 바깥에서 열려 있어야 함).

## 11. 서버 PC 를 옮길 때

2026-10-08 지금 서버 PC 는 7600X(192.168.75.193) 이고, 아래 순서로 옮겼다 (바깥에서 443·7881 이 열린 것까지 확인, 휴대폰 데이터로 소리 시험은 사용자가 할 차례). 다시 다른 PC 로 옮길 때 이 순서를 따른다. 옛 PC 에서 새 PC 로 DOLIVE 폴더를 통째로 복사하고(깃에 없는 파일 때문에 GitHub 에서 받는 것만으로는 안 된다), 공유기 7번의 고정 주소와 포트포워딩을 새 PC 로 맞춘 뒤:

1. 새 PC 에 **Node.js 24 LTS** 설치 (옛 PC 는 v24.15.0). `node -v` 로 확인.
2. 폴더가 다 복사됐는지 확인: 5번 표의 파일들이 다 있는지, 특히 `server/config/livekit.yaml`, `duckdns.env`, `apps/web/.env.local`, `server/bin/*.exe`, `apps/web/models/supertonic/`.
3. 방화벽 열기 (관리자 PowerShell):
   ```powershell
   New-NetFirewallRule -DisplayName "DOLIVE 443"        -Direction Inbound -Protocol TCP -LocalPort 443         -Action Allow
   New-NetFirewallRule -DisplayName "DOLIVE LiveKit TCP" -Direction Inbound -Protocol TCP -LocalPort 7881        -Action Allow
   New-NetFirewallRule -DisplayName "DOLIVE LiveKit UDP" -Direction Inbound -Protocol UDP -LocalPort 50000-60000 -Action Allow
   ```
   처음 켤 때 윈도우가 "허용할까요?" 창을 띄우면 허용(공용 포함)을 누른다.
4. `DOLIVE.lnk` 다시 만들기 (안에 옛 PC 의 폴더 경로가 박혀 있음). 폴더 위치를 `$d` 에 넣고:
   ```powershell
   $d = "C:\...\DOLIVE"
   $s = (New-Object -ComObject WScript.Shell).CreateShortcut("$d\DOLIVE.lnk")
   $s.TargetPath = "C:\Windows\System32\conhost.exe"
   $s.Arguments = "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$d\scripts\dolive_panel.ps1`""
   $s.WorkingDirectory = $d
   $s.IconLocation = "$d\scripts\icons\dolive.ico,0"
   $s.Save()
   ```
5. 켜기 창에서 켜고, 세 줄(통화 서버 / 웹 화면 / 바깥 연결)이 모두 OK 인지 본다. 웹 만들기가 실패하면 `apps/web` 에서 `npm ci` 로 부품을 다시 깔고 다시 켠다.
6. 새 PC 브라우저에서 `http://localhost` 로 방장 입장, **휴대폰 데이터(와이파이 끈 상태)** 로 `https://dolive.duckdns.org` 에 들어가 도름스 로그인 → 입장 → 서로 소리가 들리는지, 화면공유가 보이는지, "/글" TTS 가 나오는지 확인.
7. 새 PC 가 잠들지 않게: 설정 → 시스템 → 전원 → 화면/절전 모두 "안 함".
8. 옛 PC 에서는 DOLIVE 서버를 더 켜지 않는다.

## 12. 문제가 생기면

- 먼저 `server/logs/` 의 `*.err.log`, `build.log` 를 본다.
- 바깥에서만 안 들어와짐: 서버 PC 주소가 193 인지(`ipconfig`), 포트포워딩, 방화벽, `duckdns.env` 순서로 본다. 공유기 안(같은 와이파이)에서 시험하면 바깥 경로를 확인 못 하니 휴대폰 데이터로 시험한다.
- 들어가지는데 소리가 안 됨: UDP 50000-60000 과 TCP 7881 (포트포워딩·방화벽), `livekit.yaml` 의 `use_external_ip: true` 확인.
- "입장권" 오류: `.env.local` 의 LIVEKIT 키와 `livekit.yaml` 의 keys 가 같은지 확인.
- 인증서 오류: 443 이 바깥에서 열려 있는지, `caddy.err.log` 확인. 80 번은 이 공유기에서 못 쓴다.
