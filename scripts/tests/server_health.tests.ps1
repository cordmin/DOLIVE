$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../server_health.ps1"
foreach ($case in @(@($false, $false, 'off'), @($true, $false, 'error'), @($true, $true, 'ok'))) {
    if ((Get-DoliveServiceState $case[0] $case[1]) -ne $case[2]) { throw '상태 구분 실패' }
}
# 실제 프로그램은 끄지 않고, 어떤 프로그램을 고르는지만 확인한다.
function Get-CimInstance($Filter) {
    if ($Filter -match 'node.exe') {
        [pscustomobject]@{ ProcessId = 1; CommandLine = 'node next start -H 127.0.0.1 -p 3000' }
        [pscustomobject]@{ ProcessId = 2; CommandLine = 'node next dev -p 3001' }
    } elseif ($Filter -match 'livekit') { [pscustomobject]@{ ProcessId = 3 } }
    else { [pscustomobject]@{ ProcessId = 4 } }
}
function Stop-Process($Id, [switch]$Force) { $script:stopped += $Id }
function Copy-Item { }
function Start-Process($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError) {
    if ($WindowStyle -ne 'Hidden') { throw '검은 창이 뜨면 안 됩니다' }
    $script:started = $FilePath
}
$savedPublicUrl = $env:LIVEKIT_PUBLIC_URL
$savedDomain = $env:DOLIVE_DOMAIN
try {
    foreach ($case in @(@('web', 1), @('livekit', 3), @('caddy', 4))) {
        $script:stopped = @(); $script:started = $null
        . "$PSScriptRoot/../recover_dolive.ps1" -Service $case[0]
        if ($script:stopped.Count -ne 1 -or $script:stopped[0] -ne $case[1] -or -not $script:started) { throw '고른 프로그램만 켜기 실패' }
    }
} finally { $env:LIVEKIT_PUBLIC_URL = $savedPublicUrl; $env:DOLIVE_DOMAIN = $savedDomain }
'상태 구분과 개별 켜기 확인 통과'
