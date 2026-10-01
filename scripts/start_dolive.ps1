# Start DOLIVE (LiveKit + web + Caddy) in the background.
#   -Local : LiveKit + web only (no DuckDNS/Caddy), for testing on this PC
#   -Build : rebuild the web first (run after code changes)
#   -Stop  : stop everything
#   The "DOLIVE" shortcut in the project folder opens scripts\dolive_panel.ps1 (on/off window), which runs this.
# Saved as UTF-8 with BOM so Windows PowerShell 5.1 shows the Korean text correctly.
param([switch]$Stop, [switch]$Build, [switch]$Local)

$root = Split-Path $PSScriptRoot -Parent
$web = Join-Path $root "apps\web"
$logs = Join-Path $root "server\logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Stop-All {
    Get-Process livekit-server, caddy -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object CommandLine -like "*next start*" |  # not the dev server's start-server.js
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

function Start-Bg($name, $exe, $argList, $dir) {
    Start-Process $exe -ArgumentList $argList -WorkingDirectory $dir -WindowStyle Hidden `
        -RedirectStandardOutput "$logs\$name.out.log" -RedirectStandardError "$logs\$name.err.log" | Out-Null
}

function Test-Port($port) {
    Test-NetConnection 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
}

function Say($text, $color = "Gray") { Write-Host "  $text" -ForegroundColor $color }
function Line { Write-Host "  ------------------------------------------" -ForegroundColor DarkGray }

$Host.UI.RawUI.WindowTitle = "DOLIVE"
Write-Host ""
Write-Host "  DO" -NoNewline -ForegroundColor White
Write-Host "LIVE" -ForegroundColor Red
Line

Say $(if ($Stop) { "끄는 중..." } else { "켜는 중..." }) DarkGray

# Before stopping, close the broadcast room so viewers see "방송이 끝났어요" right away (apps/web/app/api/end)
if ($Stop) {
    try { Invoke-RestMethod -Method Post "http://127.0.0.1:3000/api/end" -TimeoutSec 3 | Out-Null } catch {}
}
Stop-All
if ($Stop) {
    Say "[ 끔 ] 통화 서버, 웹 화면, 바깥 연결을 모두 껐어요" Green
    return
}

$env:LIVEKIT_PUBLIC_URL = ""
if (-not $Local) {
    $cfg = @{}
    Get-Content "$root\server\config\duckdns.env" -Encoding UTF8 |
        Where-Object { $_ -match '^\s*(\w+)=(.*)$' } |
        ForEach-Object { $cfg[$Matches[1]] = $Matches[2].Trim() }
    $cfg.DUCKDNS_DOMAIN = "$($cfg.DUCKDNS_DOMAIN)".ToLower()
    if (-not $cfg.DUCKDNS_DOMAIN -or -not $cfg.DUCKDNS_TOKEN) {
        Say "[실패] server\config\duckdns.env 를 먼저 채워 주세요" Red
        return
    }
    # Tell DuckDNS our current home IP (it rarely changes; re-run this script if it does)
    $res = Invoke-RestMethod "https://www.duckdns.org/update?domains=$($cfg.DUCKDNS_DOMAIN)&token=$($cfg.DUCKDNS_TOKEN)"
    if ($res -ne "OK") {
        Say "[실패] 주소(DuckDNS) 갱신 실패. server\config\duckdns.env 의 이름과 토큰을 확인해 주세요" Red
        return
    }
    $env:DOLIVE_DOMAIN = "$($cfg.DUCKDNS_DOMAIN).duckdns.org"
    $env:LIVEKIT_PUBLIC_URL = "wss://$env:DOLIVE_DOMAIN"
    Say "[ OK ] 집 인터넷 주소를 $env:DOLIVE_DOMAIN 에 알렸어요" Green
}

# 웹 화면 코드가 마지막으로 만든 뒤에 바뀌었으면 알아서 새로 만든다
$built = Get-Item "$web\.next\BUILD_ID" -ErrorAction SilentlyContinue
$changed = $built -and (Get-ChildItem "$web\app", "$web\components", "$web\lib", "$web\package.json" -Recurse -File |
    Where-Object LastWriteTime -gt $built.LastWriteTime | Select-Object -First 1)
if ($Build -or -not $built -or $changed) {
    Say "[ .. ] 웹 화면 새로 만드는 중 (1분쯤 걸려요)" Yellow
    Push-Location $web
    npm.cmd run build | Out-File "$logs\build.log" -Encoding utf8
    $ok = $LASTEXITCODE -eq 0
    Pop-Location
    if (-not $ok) {
        Say "[실패] 웹 화면 만들기 실패. server\logs\build.log 를 확인해 주세요" Red
        return
    }
}

Start-Bg livekit "$root\server\bin\livekit-server.exe" "--config server\config\livekit.yaml" $root
Start-Bg web "node" "node_modules\next\dist\bin\next start -H 127.0.0.1 -p 3000" $web
if (-not $Local) {
    Start-Bg caddy "$root\server\bin\caddy.exe" "run --config server\config\Caddyfile --adapter caddyfile" $root
}

Start-Sleep -Seconds 5
$checks = [ordered]@{ "통화 서버 (LiveKit)" = 7880; "웹 화면" = 3000 }
if (-not $Local) { $checks["바깥 연결 (Caddy)"] = 443 }
$allOk = $true
foreach ($c in $checks.GetEnumerator()) {
    if (Test-Port $c.Value) { Say "[ OK ] $($c.Key)" Green } else { Say "[실패] $($c.Key)" Red; $allOk = $false }
}

Line
if ($allOk) { Say "모두 켜졌어요!" White } else { Say "일부가 켜지지 않았어요. server\logs 폴더의 기록을 확인해 주세요" Red }
Write-Host ""
Say "방장 (이 컴퓨터)   $(if ($Local) { 'http://localhost:3000' } else { 'http://localhost' })" Cyan
if (-not $Local) { Say "친구들            https://$env:DOLIVE_DOMAIN" Cyan }
