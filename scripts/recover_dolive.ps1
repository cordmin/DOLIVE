param([Parameter(Mandatory)][ValidateSet('livekit', 'web', 'caddy')][string]$Service)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logs = Join-Path $root 'server/logs'
# 다른 두 프로그램은 건드리지 않고, 고른 프로그램만 다시 켠다.
$processName = @{ livekit = 'livekit-server.exe'; web = 'node.exe'; caddy = 'caddy.exe' }[$Service]
Get-CimInstance Win32_Process -Filter "Name='$processName'" | Where-Object {
    $Service -ne 'web' -or $_.CommandLine -match 'next start.*-p 3000'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$domain = Get-Content "$root/server/config/duckdns.env" -Encoding UTF8 | Where-Object { $_ -match '^\s*DUCKDNS_DOMAIN=(.+)$' } | ForEach-Object { $Matches[1].Trim().ToLower() } | Select-Object -First 1
$env:DOLIVE_DOMAIN = "$domain.duckdns.org"
$env:LIVEKIT_PUBLIC_URL = "wss://$env:DOLIVE_DOMAIN"
$setup = @{
    livekit = @{ exe = "$root/server/bin/livekit-server.exe"; args = '--config server/config/livekit.yaml'; dir = $root }
    web = @{ exe = 'node'; args = 'node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000'; dir = "$root/apps/web" }
    caddy = @{ exe = "$root/server/bin/caddy.exe"; args = 'run --config server/config/Caddyfile --adapter caddyfile'; dir = $root }
}[$Service]
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($kind in @('out', 'err')) {
    $file = "$logs/$Service.$kind.log"
    if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination "$logs/$Service-before-recovery-$stamp.$kind.log" }
}
Start-Process -FilePath $setup.exe -ArgumentList $setup.args -WorkingDirectory $setup.dir -WindowStyle Hidden -RedirectStandardOutput "$logs/$Service.out.log" -RedirectStandardError "$logs/$Service.err.log" | Out-Null
