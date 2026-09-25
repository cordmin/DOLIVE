# Start DOLIVE (LiveKit + web + Caddy) in the background.
#   -Local : LiveKit + web only (no DuckDNS/Caddy), for testing on this PC
#   -Build : rebuild the web first (run after code changes)
#   -Stop  : stop everything
param([switch]$Stop, [switch]$Build, [switch]$Local)

$root = Split-Path $PSScriptRoot -Parent
$web = Join-Path $root "apps\web"
$logs = Join-Path $root "server\logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Stop-All {
    Get-Process livekit-server, caddy -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object CommandLine -like "*next*start*" |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

function Start-Bg($name, $exe, $argList, $dir) {
    Start-Process $exe -ArgumentList $argList -WorkingDirectory $dir -WindowStyle Hidden `
        -RedirectStandardOutput "$logs\$name.out.log" -RedirectStandardError "$logs\$name.err.log" | Out-Null
}

function Test-Port($port) {
    Test-NetConnection 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
}

Stop-All
if ($Stop) { "DOLIVE stopped."; return }

$env:LIVEKIT_PUBLIC_URL = ""
if (-not $Local) {
    $cfg = @{}
    Get-Content "$root\server\config\duckdns.env" -Encoding UTF8 |
        Where-Object { $_ -match '^\s*(\w+)=(.*)$' } |
        ForEach-Object { $cfg[$Matches[1]] = $Matches[2].Trim() }
    $cfg.DUCKDNS_DOMAIN = "$($cfg.DUCKDNS_DOMAIN)".ToLower()
    if (-not $cfg.DUCKDNS_DOMAIN -or -not $cfg.DUCKDNS_TOKEN) {
        "Fill in server\config\duckdns.env first."; return
    }
    # Tell DuckDNS our current home IP (it rarely changes; re-run this script if it does)
    $res = Invoke-RestMethod "https://www.duckdns.org/update?domains=$($cfg.DUCKDNS_DOMAIN)&token=$($cfg.DUCKDNS_TOKEN)"
    if ($res -ne "OK") { "DuckDNS update failed. Check the name and token in server\config\duckdns.env"; return }
    $env:DOLIVE_DOMAIN = "$($cfg.DUCKDNS_DOMAIN).duckdns.org"
    $env:LIVEKIT_PUBLIC_URL = "wss://$env:DOLIVE_DOMAIN"
}

if ($Build -or -not (Test-Path "$web\.next\BUILD_ID")) {
    "Building web..."
    Push-Location $web
    npm.cmd run build | Out-File "$logs\build.log" -Encoding utf8
    $ok = $LASTEXITCODE -eq 0
    Pop-Location
    if (-not $ok) { "Web build failed. See server\logs\build.log"; return }
}

Start-Bg livekit "$root\server\bin\livekit-server.exe" "--config server\config\livekit.yaml" $root
Start-Bg web "node" "node_modules\next\dist\bin\next start -H 127.0.0.1 -p 3000" $web
if (-not $Local) {
    Start-Bg caddy "$root\server\bin\caddy.exe" "run --config server\config\Caddyfile --adapter caddyfile" $root
}

Start-Sleep -Seconds 5
$checks = [ordered]@{ "LiveKit (7880)" = 7880; "Web (3000)" = 3000 }
if (-not $Local) { $checks["Caddy (443)"] = 443 }
foreach ($c in $checks.GetEnumerator()) {
    "{0,-16} {1}" -f $c.Key, $(if (Test-Port $c.Value) { "OK" } else { "FAILED - see server\logs" })
}
"Host (admin): http://localhost:3000"
if (-not $Local) { "Friends:      https://$env:DOLIVE_DOMAIN" }
