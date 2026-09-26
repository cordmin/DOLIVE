# DOLIVE 켜기/끄기 창. 프로젝트 폴더의 "DOLIVE" 바로 가기가 검은 창 없이 이걸 띄운다
# (conhost --headless powershell ... dolive_panel.ps1). 실제로 켜고 끄는 일은 start_dolive.ps1 이 한다.
# Saved as UTF-8 with BOM so Windows PowerShell 5.1 shows the Korean text correctly.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Win -Name Dwm -MemberDefinition @'
[DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
'@
[Windows.Forms.Application]::EnableVisualStyles()

# 한 개만 띄운다. 이미 떠 있으면(트레이에 숨어 있어도) 그 창을 앞으로 부르고 끝낸다
$created = $false
$wake = New-Object Threading.EventWaitHandle($false, "AutoReset", "DOLIVE_panel_wake", [ref]$created)
if (-not $created) { [void]$wake.Set(); return }

$root = Split-Path $PSScriptRoot -Parent
$starter = Join-Path $PSScriptRoot "start_dolive.ps1"
$logs = Join-Path $root "server\logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$domain = (Get-Content "$root\server\config\duckdns.env" -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^\s*DUCKDNS_DOMAIN=(.+)$' } | ForEach-Object { $Matches[1].Trim().ToLower() }) | Select-Object -First 1
$friendsUrl = "https://$domain.duckdns.org"
$hostUrl = "http://localhost:3000"

function Color($hex) { [Drawing.ColorTranslator]::FromHtml($hex) }
function Font($size, [switch]$Bold) {
    New-Object Drawing.Font("Malgun Gothic", $size, $(if ($Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }))
}
function Label($text, $x, $y, $size, $color, [switch]$Bold) {
    $l = New-Object Windows.Forms.Label
    $l.Text = $text; $l.Location = "$x,$y"; $l.AutoSize = $true
    $l.Font = Font $size -Bold:$Bold; $l.ForeColor = Color $color; $l.BackColor = [Drawing.Color]::Transparent
    $form.Controls.Add($l); $l
}
# 버튼 모서리를 둥글게
function Round($ctl, $r) {
    $d = $r * 2; $w = $ctl.Width; $h = $ctl.Height
    $p = New-Object Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $d, $d, 180, 90); $p.AddArc($w - $d, 0, $d, $d, 270, 90)
    $p.AddArc($w - $d, $h - $d, $d, $d, 0, 90); $p.AddArc(0, $h - $d, $d, $d, 90, 90); $p.CloseFigure()
    $ctl.Region = New-Object Drawing.Region $p
}
function Button($text, $x, $y, $w, $h, $size) {
    $b = New-Object Windows.Forms.Button
    $b.Text = $text; $b.Location = "$x,$y"; $b.Size = "$w,$h"; $b.Font = Font $size -Bold
    $b.FlatStyle = "Flat"; $b.FlatAppearance.BorderSize = 0; $b.ForeColor = [Drawing.Color]::White
    $b.Cursor = [Windows.Forms.Cursors]::Hand
    # 창이 뒤로 가면 윈도우가 테두리를 1줄 그려서, 테두리 색을 늘 바탕색과 같게 맞춘다
    $b.Add_BackColorChanged({ param($s) $s.FlatAppearance.BorderColor = $s.BackColor })
    Round $b 10
    $form.Controls.Add($b); $b
}

$form = New-Object Windows.Forms.Form
$form.Text = "DOLIVE"
$form.Icon = New-Object Drawing.Icon (Join-Path $PSScriptRoot "icons\dolive.ico")
$form.ClientSize = "360,318"
$form.FormBorderStyle = "FixedSingle"; $form.MaximizeBox = $false; $form.StartPosition = "CenterScreen"
$form.BackColor = Color "#18181b"
# 창 제목 줄도 어둡게 (윈도우 11)
$form.Add_HandleCreated({ $on = 1; [void][Win.Dwm]::DwmSetWindowAttribute($form.Handle, 20, [ref]$on, 4) })

# 로고: "DO"는 흰색, "LIVE"는 빨간색으로 한 칸에 붙여 그린다
$logo = New-Object Windows.Forms.Label
$logo.Location = "24,20"; $logo.Size = "240,48"; $logo.BackColor = [Drawing.Color]::Transparent
$logoFont = Font 26 -Bold
$logo.Add_Paint({
    param($s, $e)
    $flags = [Windows.Forms.TextFormatFlags]::NoPadding
    $w = [Windows.Forms.TextRenderer]::MeasureText($e.Graphics, "DO", $logoFont, [Drawing.Size]::Empty, $flags).Width
    [Windows.Forms.TextRenderer]::DrawText($e.Graphics, "DO", $logoFont, (New-Object Drawing.Point 0, 0), [Drawing.Color]::White, $flags)
    [Windows.Forms.TextRenderer]::DrawText($e.Graphics, "LIVE", $logoFont, (New-Object Drawing.Point $w, 0), (Color "#ef4444"), $flags)
})
$form.Controls.Add($logo)

$status = Label "" 26 76 12 "#a1a1aa"
$power = Button "" 24 116 312 58 15

$line = New-Object Windows.Forms.Label
$line.Location = "24,194"; $line.Size = "312,1"; $line.BackColor = Color "#3f3f46"
$form.Controls.Add($line)

[void](Label "DOLIVE 링크" 24 210 9.5 "#71717a")
$friends = New-Object Windows.Forms.LinkLabel
$friends.Text = $friendsUrl; $friends.Location = "24,230"; $friends.AutoSize = $true; $friends.Font = Font 11
$friends.LinkColor = Color "#67e8f9"; $friends.ActiveLinkColor = Color "#a5f3fc"; $friends.LinkBehavior = "HoverUnderline"
$friends.Add_LinkClicked({ Start-Process $friendsUrl })
$form.Controls.Add($friends)
$copy = Button "주소 복사" 256 226 80 28 9
$copy.BackColor = Color "#3f3f46"
$copy.Add_Click({
    [Windows.Forms.Clipboard]::SetText($friendsUrl)
    $copy.Text = "복사됨"
})

[void](Label "방장(관리자) 링크" 24 264 9.5 "#71717a")
$admin = New-Object Windows.Forms.LinkLabel
$admin.Text = $hostUrl; $admin.Location = "24,284"; $admin.AutoSize = $true; $admin.Font = Font 11
$admin.LinkColor = Color "#67e8f9"; $admin.ActiveLinkColor = Color "#a5f3fc"; $admin.LinkBehavior = "HoverUnderline"
$admin.Add_LinkClicked({ Start-Process $hostUrl })
$form.Controls.Add($admin)

# 켜고 끄는 일은 뒤에서 start_dolive.ps1 로 (그동안 창이 멈추지 않게)
$job = @{ proc = $null; wantOn = $false }
function IsOn { [bool](Get-Process livekit-server -ErrorAction SilentlyContinue) }

function Show-State($note) {
    if ($job.proc) { return }
    if (IsOn) {
        $status.Text = "●  켜져 있어요"; $status.ForeColor = Color "#4ade80"
        $power.Text = "끄기"; $power.BackColor = Color "#3f3f46"
    } else {
        $status.Text = "●  꺼져 있어요"; $status.ForeColor = Color "#a1a1aa"
        $power.Text = "켜기"; $power.BackColor = Color "#4f46e5"
    }
    if ($note) { $status.Text = $note; $status.ForeColor = Color "#f87171" }
    $power.Enabled = $true
}

$power.Add_Click({
    $job.wantOn = -not (IsOn)
    $status.Text = $(if ($job.wantOn) { "●  켜는 중... (10초쯤)" } else { "●  끄는 중..." })
    $status.ForeColor = Color "#facc15"
    $power.Enabled = $false
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$starter`"" + $(if ($job.wantOn) { "" } else { " -Stop" })
    $job.proc = Start-Process powershell -ArgumentList $argList -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$logs\panel.out.log" -RedirectStandardError "$logs\panel.err.log"
})

# X를 누르면 끄지 않고 작업 표시줄 오른쪽 아래(트레이)로 숨긴다. 서버는 그대로 켜져 있다
$tray = New-Object Windows.Forms.NotifyIcon
$tray.Icon = $form.Icon; $tray.Text = "DOLIVE"; $tray.Visible = $true
function Show-Panel { $form.Show(); $form.WindowState = "Normal"; $form.Activate() }
$menu = New-Object Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add("열기", $null, { Show-Panel })
# 끝내기 = 서버까지 모두 끄고(바깥에서 못 들어오게) 이 창도 끝낸다
[void]$menu.Items.Add("끝내기 (서버 끄기)", $null, {
    $job.quit = $true; $form.Hide(); $tray.Text = "DOLIVE 끄는 중..."
    if ($job.proc -and -not $job.proc.HasExited) { $job.proc.Kill() }  # 켜는 중이었으면 멈추고
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$starter`" -Stop" -WindowStyle Hidden -Wait
    $form.Close()
})
$tray.ContextMenuStrip = $menu
$tray.Add_MouseClick({ param($s, $e) if ($e.Button -eq "Left") { Show-Panel } })
$form.Add_FormClosing({
    param($s, $e)
    if ($job.quit -or $e.CloseReason -ne "UserClosing") { return }
    $e.Cancel = $true; $form.Hide()
    if (-not $job.told) { $job.told = $true; $tray.ShowBalloonTip(3000, "DOLIVE", "여기 숨어 있어요. 누르면 다시 열려요", "None") }
})

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 800
$timer.Add_Tick({
    if ($wake.WaitOne(0)) { Show-Panel }
    if ($job.proc -and $job.proc.HasExited) {
        $job.proc = $null
        Show-State $(if ((IsOn) -ne $job.wantOn) { "●  잘 안 됐어요. server\logs 폴더를 확인해 주세요" })
    } elseif (-not $job.proc -and $status.ForeColor.ToArgb() -ne (Color "#f87171").ToArgb()) {
        Show-State  # 다른 곳에서 켜고 꺼도 따라가게
    }
})
$timer.Start()

Show-State
# ShowDialog는 창을 숨기면 끝나버려서, 숨겨도 계속 도는 Application.Run을 쓴다
[Windows.Forms.Application]::Run($form)
$tray.Dispose()
