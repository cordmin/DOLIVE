# 통화와 웹은 실제 응답, 접속 프로그램은 연결을 받는지 확인한다.
function Test-DoliveResponse($url) {
    try {
        $request = [Net.HttpWebRequest]::Create($url)
        $request.Method = 'HEAD'; $request.Timeout = 1500; $request.AllowAutoRedirect = $false
        $request.Proxy = $null
        $response = $request.GetResponse()
        try { return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400 }
        finally { $response.Close() }
    } catch { return $false }
}

function Get-DoliveServiceState([bool]$running, [bool]$responding) {
    if (-not $running) { return 'off' }
    if ($responding) { return 'ok' }
    return 'error'
}

function Get-DoliveHealth {
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='livekit-server.exe' OR Name='caddy.exe'" -ErrorAction Stop)
    $ports = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | ForEach-Object { $_.Port })
    foreach ($service in @(
        @{ id = 'livekit'; process = 'livekit-server.exe'; port = 7880; url = 'http://127.0.0.1:7880/' },
        @{ id = 'web'; process = 'node.exe'; port = 3000; url = 'http://127.0.0.1:3000/' },
        @{ id = 'caddy'; process = 'caddy.exe'; port = 443; url = $null }
    )) {
        $running = [bool]($processes | Where-Object {
            $_.Name -eq $service.process -and ($service.id -ne 'web' -or $_.CommandLine -match 'next start.*-p 3000')
        })
        $responding = $ports -contains $service.port
        if ($responding -and $service.url) { $responding = Test-DoliveResponse $service.url }
        [pscustomobject]@{ id = $service.id; state = Get-DoliveServiceState $running $responding }
    }
}
