# DOLIVE 서버 시작/종료 창. 프로젝트 폴더의 "DOLIVE" 바로 가기가 검은 창 없이 이걸 띄운다
# (conhost --headless powershell ... dolive_panel.ps1). 실제로 켜고 끄는 일은 start_dolive.ps1 이 한다.
# Saved as UTF-8 with BOM so Windows PowerShell 5.1 shows the Korean text correctly.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Win -Name Dwm -MemberDefinition @'
[DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, string lParam);
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
$hostUrl = "http://localhost"

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
# 둥근 버튼을 직접 그린다. 윈도우 기본 방식(Region으로 모서리 자르기)은 모서리가 계단처럼 자글자글해서,
# 바탕을 창 색으로 칠하고 그 위에 부드럽게(AntiAlias) 둥근 사각형과 글자를 그린다. 마우스를 올리면 조금 밝게, 못 누를 땐 글자를 흐리게
function Button($text, $x, $y, $w, $h, $size) {
    $b = New-Object Windows.Forms.Button
    $b.Text = $text; $b.Location = "$x,$y"; $b.Size = "$w,$h"; $b.Font = Font $size -Bold
    $b.FlatStyle = "Flat"; $b.FlatAppearance.BorderSize = 0; $b.ForeColor = [Drawing.Color]::White
    $b.Cursor = [Windows.Forms.Cursors]::Hand
    $b.Add_Paint({
        param($s, $e)
        $g = $e.Graphics; $g.SmoothingMode = "AntiAlias"
        $g.Clear($s.Parent.BackColor)
        $r = 10; $d = $r * 2; $w = $s.Width - 1; $h = $s.Height - 1
        $p = New-Object Drawing.Drawing2D.GraphicsPath
        $p.AddArc(0, 0, $d, $d, 180, 90); $p.AddArc($w - $d, 0, $d, $d, 270, 90)
        $p.AddArc($w - $d, $h - $d, $d, $d, 0, 90); $p.AddArc(0, $h - $d, $d, $d, 90, 90); $p.CloseFigure()
        $c = $s.BackColor
        if ($s.Enabled -and $s.ClientRectangle.Contains($s.PointToClient([Windows.Forms.Cursor]::Position))) {
            $c = [Drawing.Color]::FromArgb([Math]::Min(255, $c.R + 20), [Math]::Min(255, $c.G + 20), [Math]::Min(255, $c.B + 20))
        }
        $brush = New-Object Drawing.SolidBrush $c
        $g.FillPath($brush, $p); $brush.Dispose(); $p.Dispose()
        $fg = if ($s.Enabled) { $s.ForeColor } else { Color "#a1a1aa" }
        $flags = [Windows.Forms.TextFormatFlags]"HorizontalCenter, VerticalCenter"
        [Windows.Forms.TextRenderer]::DrawText($g, $s.Text, $s.Font, $s.ClientRectangle, $fg, $flags)
    })
    $b.Add_MouseEnter({ param($s) $s.Invalidate() })
    $b.Add_MouseLeave({ param($s) $s.Invalidate() })
    $form.Controls.Add($b); $b
}

$form = New-Object Windows.Forms.Form
$form.Text = "DOLIVE"
$form.Icon = New-Object Drawing.Icon (Join-Path $PSScriptRoot "icons\dolive.ico")
$form.ClientSize = "308,292"
$form.FormBorderStyle = "FixedSingle"; $form.MaximizeBox = $false; $form.StartPosition = "CenterScreen"
$form.BackColor = Color "#18181b"
# 창 제목 줄도 어둡게 (윈도우 11)
$form.Add_HandleCreated({ $on = 1; [void][Win.Dwm]::DwmSetWindowAttribute($form.Handle, 20, [ref]$on, 4) })

# 로고: "DO"는 흰색, "LIVE"는 빨간색으로 한 칸에 붙여 그린다
$logoFont = Font 26 -Bold
# 칸 폭은 글자 폭만큼만 (넓으면 오른쪽 상태 글자를 덮어 가린다)
$logoW = [Windows.Forms.TextRenderer]::MeasureText("DOLIVE", $logoFont, [Drawing.Size]::Empty, [Windows.Forms.TextFormatFlags]::NoPadding).Width + 4
$logo = New-Object Windows.Forms.Label
$logo.Location = "24,24"; $logo.Size = "$logoW,48"; $logo.BackColor = [Drawing.Color]::Transparent
$logo.Add_Paint({
    param($s, $e)
    $flags = [Windows.Forms.TextFormatFlags]::NoPadding
    $w = [Windows.Forms.TextRenderer]::MeasureText($e.Graphics, "DO", $logoFont, [Drawing.Size]::Empty, $flags).Width
    [Windows.Forms.TextRenderer]::DrawText($e.Graphics, "DO", $logoFont, (New-Object Drawing.Point 0, 0), [Drawing.Color]::White, $flags)
    [Windows.Forms.TextRenderer]::DrawText($e.Graphics, "LIVE", $logoFont, (New-Object Drawing.Point $w, 0), (Color "#ef4444"), $flags)
})
$form.Controls.Add($logo)

# 상태 글자는 로고 오른쪽 같은 줄에
$sx = 24 + $logoW + 12
$status = Label "" $sx 37 12 "#a1a1aa"
$tip = New-Object Windows.Forms.ToolTip
# 켜고 끄는 동안 상태 글자 앞에서 빙글빙글 도는 동그라미
$spin = New-Object Windows.Forms.Label
$spin.Location = "$sx,39"; $spin.Size = "20,20"; $spin.BackColor = [Drawing.Color]::Transparent; $spin.Visible = $false; $spin.Tag = 0
$spin.Add_Paint({
    param($s, $e)
    $e.Graphics.SmoothingMode = "AntiAlias"
    $pen = New-Object Drawing.Pen((Color "#3f3f46"), 3)
    $e.Graphics.DrawEllipse($pen, 2, 2, 15, 15)
    $pen.Color = Color "#facc15"; $pen.StartCap = "Round"; $pen.EndCap = "Round"
    $e.Graphics.DrawArc($pen, 2, 2, 15, 15, $s.Tag, 90)
    $pen.Dispose()
})
$form.Controls.Add($spin)
$spinTimer = New-Object Windows.Forms.Timer
$spinTimer.Interval = 30
$spinTimer.Add_Tick({ $spin.Tag = ($spin.Tag + 12) % 360; $spin.Invalidate() })
$power = Button "" 24 92 260 58 15

$line = New-Object Windows.Forms.Label
$line.Location = "24,174"; $line.Size = "260,1"; $line.BackColor = Color "#3f3f46"
$form.Controls.Add($line)

# 운영진 = 채팅방에서 방장 권한(화면공유·마이크 끄기·화면공유 허락)을 받는 도름스 회원.
# 톱니바퀴 창에서 닉네임을 한 줄 칸에 적고 [+](또는 Enter), 배지의 X 로 지운다. 바꿀 때마다 바로 파일에 저장하고,
# 웹 서버(apps/web/lib/server.ts isStaff)가 요청마다 이 파일을 다시 읽어서 다음 입장부터 적용된다
$staffFile = "$root\server\config\staff.txt"
$staff = @{ names = New-Object Collections.Generic.List[string]; flow = $null; box = $null; wrap = $null }
function Save-Staff { [IO.File]::WriteAllLines($staffFile, [string[]]$staff.names, (New-Object Text.UTF8Encoding $false)) }

# 다 그린 뒤 한 번에 보여 준다 (직접 그리는 칸이 지웠다 그리는 순간이 보여 깜빡이지 않게. 윈도우가 숨겨 둔 설정이라 꺼내서 켠다)
function NoFlicker($c) { [Windows.Forms.Control].GetProperty("DoubleBuffered", [Reflection.BindingFlags]"NonPublic, Instance").SetValue($c, $true) }

# 둥근 사각형 모양 (r = 모서리 둥글기)
function RoundRect($x, $y, $w, $h, $r) {
    $d = $r * 2; $p = New-Object Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90); $p.CloseFigure(); $p
}

# 닉네임 배지: 살짝 둥근 알약 모양 + 오른쪽 X (누르면 지운다). 마우스가 X 위에 있으면 X 를 밝게 (그때 손가락 커서)
function Add-Badge($name) {
    $font = Font 10
    $tw = [Windows.Forms.TextRenderer]::MeasureText($name, $font, [Drawing.Size]::Empty, [Windows.Forms.TextFormatFlags]::NoPadding).Width
    $b = New-Object Windows.Forms.Panel
    $b.Size = "$($tw + 44),30"; $b.Margin = "0,0,8,8"; $b.Tag = $name; $b.Font = $font
    NoFlicker $b
    $b.Add_Paint({
        param($s, $e)
        $g = $e.Graphics; $g.SmoothingMode = "AntiAlias"; $g.Clear($s.Parent.BackColor)
        $p = RoundRect 0 0 ($s.Width - 1) ($s.Height - 1) 9
        $brush = New-Object Drawing.SolidBrush (Color "#3f3f46"); $g.FillPath($brush, $p); $brush.Dispose(); $p.Dispose()
        $flags = [Windows.Forms.TextFormatFlags]"VerticalCenter, NoPadding"
        [Windows.Forms.TextRenderer]::DrawText($g, $s.Tag, $s.Font, (New-Object Drawing.Rectangle 12, 0, ($s.Width - 40), $s.Height), (Color "#f4f4f5"), $flags)
        $hot = $s.Cursor -eq [Windows.Forms.Cursors]::Hand  # X 위에 있는지는 커서 모양으로 기억한다 (MouseMove)
        $xFont = New-Object Drawing.Font("Segoe MDL2 Assets", 7)
        [Windows.Forms.TextRenderer]::DrawText($g, [string][char]0xE711, $xFont, (New-Object Drawing.Rectangle ($s.Width - 30), 0, 26, $s.Height),
            $(if ($hot) { Color "#ffffff" } else { Color "#a1a1aa" }), [Windows.Forms.TextFormatFlags]"HorizontalCenter, VerticalCenter")
        $xFont.Dispose()
    })
    # X 안팎을 넘나들 때만 다시 그린다 (움직일 때마다 그리면 깜빡인다)
    $b.Add_MouseMove({
        param($s, $e)
        $hot = $e.X -ge $s.Width - 30
        if ($hot -ne ($s.Cursor -eq [Windows.Forms.Cursors]::Hand)) {
            $s.Cursor = $(if ($hot) { [Windows.Forms.Cursors]::Hand } else { [Windows.Forms.Cursors]::Default }); $s.Invalidate()
        }
    })
    $b.Add_MouseLeave({ param($s) if ($s.Cursor -eq [Windows.Forms.Cursors]::Hand) { $s.Cursor = [Windows.Forms.Cursors]::Default; $s.Invalidate() } })
    $b.Add_MouseClick({
        param($s, $e)
        if ($e.X -lt $s.Width - 30) { return }
        [void]$staff.names.Remove($s.Tag); Save-Staff
        $staff.flow.Controls.Remove($s); $s.Dispose()
    })
    $staff.flow.Controls.Add($b)
}

# 칸에 적은 닉네임 추가 (빈칸·이미 있는 이름은 넘어간다. 대소문자는 같은 이름으로 본다)
function Add-Staff {
    $name = $staff.box.Text.Trim()
    $staff.box.Text = ""; [void]$staff.box.Focus()
    if (-not $name -or ($staff.names | Where-Object { $_ -ieq $name })) { return }
    $staff.names.Add($name); Save-Staff; Add-Badge $name
}

function Show-Staff {
    $dlg = New-Object Windows.Forms.Form
    $dlg.Text = "운영진"; $dlg.Icon = $form.Icon
    $dlg.ClientSize = "308,300"; $dlg.FormBorderStyle = "FixedSingle"; $dlg.MaximizeBox = $false; $dlg.MinimizeBox = $false
    $dlg.StartPosition = "CenterParent"; $dlg.BackColor = $form.BackColor
    $dlg.Add_HandleCreated({ param($s) $on = 1; [void][Win.Dwm]::DwmSetWindowAttribute($s.Handle, 20, [ref]$on, 4) })

    # 한 줄 입력칸: 둥근 테두리 칸 안에 테두리 없는 글자칸 (글자칸에 있으면 테두리가 보라색)
    $wrap = New-Object Windows.Forms.Panel
    $wrap.Location = "24,24"; $wrap.Size = "216,38"; NoFlicker $wrap
    $wrap.Add_Paint({
        param($s, $e)
        $g = $e.Graphics; $g.SmoothingMode = "AntiAlias"; $g.Clear($s.Parent.BackColor)
        $p = RoundRect 0 0 ($s.Width - 1) ($s.Height - 1) 9
        $brush = New-Object Drawing.SolidBrush (Color "#27272a"); $g.FillPath($brush, $p); $brush.Dispose()
        $pen = New-Object Drawing.Pen((Color $(if ($staff.box.Focused) { "#6366f1" } else { "#3f3f46" })), 1)
        $g.DrawPath($pen, $p); $pen.Dispose(); $p.Dispose()
    })
    $box = New-Object Windows.Forms.TextBox
    $box.BorderStyle = "None"; $box.Font = Font 11; $box.BackColor = Color "#27272a"; $box.ForeColor = Color "#f4f4f5"
    $box.Location = "12,9"; $box.Width = 192; $box.MaxLength = 40
    $box.Add_HandleCreated({ param($s) [void][Win.Dwm]::SendMessage($s.Handle, 0x1501, [IntPtr]1, "도름스 닉네임") })  # 빈칸일 때 흐린 안내 글
    $box.Add_GotFocus({ $staff.wrap.Invalidate() }); $box.Add_LostFocus({ $staff.wrap.Invalidate() })
    $box.Add_KeyDown({ param($s, $e) if ($e.KeyCode -eq "Enter") { $e.SuppressKeyPress = $true; Add-Staff } })
    $wrap.Controls.Add($box)
    $dlg.Controls.Add($wrap)
    $staff.box = $box; $staff.wrap = $wrap

    # 동그란 [+] 버튼
    $plus = New-Object Windows.Forms.Button
    $plus.Location = "248,24"; $plus.Size = "38,38"; $plus.FlatStyle = "Flat"; $plus.FlatAppearance.BorderSize = 0
    $plus.Cursor = [Windows.Forms.Cursors]::Hand; NoFlicker $plus
    $plus.Add_Paint({
        param($s, $e)
        $g = $e.Graphics; $g.SmoothingMode = "AntiAlias"; $g.Clear($s.Parent.BackColor)
        $hot = $s.ClientRectangle.Contains($s.PointToClient([Windows.Forms.Cursor]::Position))
        $brush = New-Object Drawing.SolidBrush (Color $(if ($hot) { "#6366f1" } else { "#4f46e5" }))
        $g.FillEllipse($brush, 0, 0, $s.Width - 1, $s.Height - 1); $brush.Dispose()
        $f = New-Object Drawing.Font("Segoe MDL2 Assets", 11)
        [Windows.Forms.TextRenderer]::DrawText($g, [string][char]0xE710, $f, $s.ClientRectangle, [Drawing.Color]::White, [Windows.Forms.TextFormatFlags]"HorizontalCenter, VerticalCenter")
        $f.Dispose()
    })
    $plus.Add_MouseEnter({ param($s) $s.Invalidate() }); $plus.Add_MouseLeave({ param($s) $s.Invalidate() })
    $plus.Add_Click({ Add-Staff })
    $tip.SetToolTip($plus, "추가")
    $dlg.Controls.Add($plus)

    # 배지들이 왼쪽부터 차례로 쌓이는 자리 (넘치면 아랫줄로, 더 넘치면 스크롤)
    $flow = New-Object Windows.Forms.FlowLayoutPanel
    $flow.Location = "24,78"; $flow.Size = "268,206"; $flow.AutoScroll = $true; $flow.BackColor = $dlg.BackColor
    $dlg.Controls.Add($flow)
    $staff.flow = $flow

    $staff.names.Clear()
    foreach ($n in (Get-Content $staffFile -Encoding UTF8 -ErrorAction SilentlyContinue)) {
        $n = $n.Trim()
        if ($n -and -not ($staff.names | Where-Object { $_ -ieq $n })) { $staff.names.Add($n); Add-Badge $n }
    }
    $dlg.Add_Shown({ [void]$staff.box.Focus() })
    [void]$dlg.ShowDialog($form)
    $dlg.Dispose()
}

# 한 줄에 이름(왼쪽, LIVE OFF 글자색) + [접속하기](그 주소를 연다) + 오른쪽 작은 아이콘 버튼. 두 줄 모두 같은 자리·같은 크기
# 아이콘은 윈도우에 들어 있는 기호 글꼴(Segoe MDL2 Assets)의 모양: 관리자 줄은 톱니바퀴(운영진 창), 클라이언트 줄은 복사(누르면 체크 표시로)
function LinkRow($title, $url, $y, [switch]$Staff) {
    [void](Label $title 24 ($y + 4) 11 "#a1a1aa")
    $go = Button "접속하기" 166 $y 80 30 9
    $go.BackColor = Color "#3f3f46"; $go.Tag = $url
    $go.Add_Click({ param($s) Start-Process $s.Tag })
    $icon = Button ([string][char]$(if ($Staff) { 0xE713 } else { 0xE8C8 })) 254 $y 30 30 9
    $icon.Font = New-Object Drawing.Font("Segoe MDL2 Assets", 11)
    $icon.BackColor = Color "#3f3f46"; $icon.Tag = $url
    if ($Staff) {
        $icon.Add_Click({ Show-Staff })
        $tip.SetToolTip($icon, "운영진 (관리자 권한 주기)")
    } else {
        $icon.Add_Click({ param($s) [Windows.Forms.Clipboard]::SetText($s.Tag); $s.Text = [string][char]0xE73E })
        $tip.SetToolTip($icon, "주소 복사")
    }
}
# 관리자(방장) = 이 PC / 클라이언트 = 친구들 주소 (도름스 로그인해야 들어간다. 운영진은 톱니바퀴에서 정한다)
LinkRow "관리자(방장)" $hostUrl 194 -Staff
LinkRow "클라이언트" $friendsUrl 238

# 켜고 끄는 일은 뒤에서 start_dolive.ps1 로 (그동안 창이 멈추지 않게)
$job = @{ proc = $null; wantOn = $false }
function IsOn { [bool](Get-Process livekit-server -ErrorAction SilentlyContinue) }

function Show-State($note) {
    if ($job.proc) { return }
    $spinTimer.Stop(); $spin.Visible = $false; $status.Left = $sx
    if (IsOn) {
        $status.Text = "●  LIVE ON"; $status.ForeColor = Color "#4ade80"
        $power.Text = "서버 종료"; $power.BackColor = Color "#3f3f46"
    } else {
        $status.Text = "●  LIVE OFF"; $status.ForeColor = Color "#a1a1aa"
        $power.Text = "서버 시작"; $power.BackColor = Color "#4f46e5"
    }
    # 로고 옆 자리가 좁아서 짧게 쓰고, 자세한 안내는 마우스를 올리면 뜬다
    if ($note) { $status.Text = "●  잘 안 됐어요"; $status.ForeColor = Color "#f87171" }
    $tip.SetToolTip($status, $note)
    $power.Enabled = $true
}

$power.Add_Click({
    $job.wantOn = -not (IsOn)
    $status.Text = $(if ($job.wantOn) { "시작 중..." } else { "종료 중..." })
    $status.ForeColor = Color "#facc15"
    $status.Left = $sx + 26; $spin.Visible = $true; $spinTimer.Start()
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
# 서버 차단 및 종료 = 서버까지 모두 끄고(바깥에서 못 들어오게) 이 창도 끝낸다
[void]$menu.Items.Add("서버 차단 및 종료", $null, {
    $job.quit = $true; $form.Hide(); $tray.Text = "DOLIVE 종료 중..."
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
        Show-State $(if ((IsOn) -ne $job.wantOn) { "server\logs 폴더를 확인해 주세요" })
    } elseif (-not $job.proc -and $status.ForeColor.ToArgb() -ne (Color "#f87171").ToArgb()) {
        Show-State  # 다른 곳에서 켜고 꺼도 따라가게
    }
})
$timer.Start()

Show-State
# ShowDialog는 창을 숨기면 끝나버려서, 숨겨도 계속 도는 Application.Run을 쓴다
[Windows.Forms.Application]::Run($form)
$tray.Dispose()
