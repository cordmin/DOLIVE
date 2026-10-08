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

# DOLIVE 설정 창 (관리자(방장) 줄 톱니바퀴). 왼쪽 메뉴 [방송 관리자] [채팅방 관리], 오른쪽에 고른 쪽 내용.
# 바꿀 때마다 바로 파일에 저장하고, 웹 서버(apps/web/lib/server.ts)가 요청마다 파일을 다시 읽어서 바로 적용된다

# 방송 관리자(운영진) = 채팅방에서 방장 권한(화면공유·마이크 끄기·화면공유 허락)을 받는 도름스 회원 (isStaff, 다음 입장부터).
# 닉네임을 한 줄 칸에 적고 [+](또는 Enter), 배지의 X 로 지운다
$staffFile = "$root\server\config\staff.txt"
$staff = @{ names = New-Object Collections.Generic.List[string]; flow = $null; box = $null }
function Save-Staff { [IO.File]::WriteAllLines($staffFile, [string[]]$staff.names, (New-Object Text.UTF8Encoding $false)) }

# 채팅방 관리 = 방송 목록. 한 줄에 "방 이름<탭>비밀번호<탭>staff 또는 everyone". 마지막 칸이 없으면 방송 관리자만.
# 파일이 없으면(처음) 웹 서버처럼 비밀번호 없는 DOLIVE 방 하나로 본다. 방을 지우면 그 방에 있던 사람은 모두 나가진다 (api/end)
$roomsFile = "$root\server\config\rooms.txt"
$roomCfg = @{ list = New-Object Collections.Generic.List[object]; flow = $null; name = $null; pw = $null; plus = $null; edit = $null }  # edit = 고치는 중인 배지
function Save-Rooms {
    [IO.File]::WriteAllLines($roomsFile, [string[]]@($roomCfg.list | ForEach-Object { "$($_.name)`t$($_.pw)`t$($_.share)" }), (New-Object Text.UTF8Encoding $false))
}

# 설정 창 왼쪽 메뉴와 오른쪽 내용 (같은 순서)
$settings = @{ navs = $null; pages = $null }

# 다 그린 뒤 한 번에 보여 준다 (직접 그리는 칸이 지웠다 그리는 순간이 보여 깜빡이지 않게. 윈도우가 숨겨 둔 설정이라 꺼내서 켠다)
function NoFlicker($c) { [Windows.Forms.Control].GetProperty("DoubleBuffered", [Reflection.BindingFlags]"NonPublic, Instance").SetValue($c, $true) }

# 둥근 사각형 모양 (r = 모서리 둥글기)
function RoundRect($x, $y, $w, $h, $r) {
    $d = $r * 2; $p = New-Object Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90); $p.CloseFigure(); $p
}

# 배지 글자(이름·자물쇠)를 바꾸고 글자에 맞게 너비를 다시 잰다
function Set-BadgeText($b, $name, [bool]$lock) {
    $tw = [Windows.Forms.TextRenderer]::MeasureText($name, $b.Font, [Drawing.Size]::Empty, [Windows.Forms.TextFormatFlags]::NoPadding).Width
    $b.Tag.name = $name; $b.Tag.lock = $lock
    $b.Size = $(if ($b.Tag.room) { "390,94" } else { "$($tw + 44 + $(if ($lock) { 18 } else { 0 })),30" }); $b.Invalidate()
}

# 배지: 살짝 둥근 알약 모양 + 오른쪽 X (누르면 $onRemove 에 이름을 넘기고 배지를 없앤다). -Lock 이면 이름 뒤에 자물쇠(비밀번호 방).
# 마우스가 X 위에 있으면 빨간 동그라미 위에 흰 X (그때 손가락 커서). $tipText 는 배지에 마우스를 올리면 뜨는 글.
# 배지를 돌려준다. Tag.pick(누르면 부름)·Tag.drag(끌어서 놓으면 부름)를 붙이면 그 배지는 누르기·끌어서 순서 바꾸기가 된다 (채팅방 관리)
function Add-Badge($flow, $name, $onRemove, $tipText, [switch]$Lock) {
    $b = New-Object Windows.Forms.Panel
    $b.Margin = "0,0,8,8"; $b.Font = Font 10
    $b.Tag = @{ name = $name; remove = $onRemove; lock = $false; pick = $null; drag = $null; down = $null; hl = $false }
    Set-BadgeText $b $name ([bool]$Lock)
    NoFlicker $b
    $b.Add_Paint({
        param($s, $e)
        $g = $e.Graphics; $g.SmoothingMode = "AntiAlias"; $g.Clear($s.Parent.BackColor)
        if ($s.Tag.down -and $s.Tag.down.moved) {  # 끄는 중: 원래 자리는 점선 빈칸 (놓으면 여기에 들어간다)
            $edge = RoundRect 1 1 ($s.Width - 3) ($s.Height - 3) 12
            $pen = New-Object Drawing.Pen((Color "#52525b"), 1.5); $pen.DashStyle = "Dash"; $g.DrawPath($pen, $edge); $pen.Dispose(); $edge.Dispose()
            return
        }
        $p = RoundRect 0 0 ($s.Width - 1) ($s.Height - 1) $(if ($s.Tag.room) { 12 } else { 9 })
        # 고치는 중(hl)이면 보라 테두리
        $brush = New-Object Drawing.SolidBrush (Color $(if ($s.Tag.room) { "#232327" } else { "#3f3f46" })); $g.FillPath($brush, $p); $brush.Dispose()
        if ($s.Tag.hl) {  # 굵은 선은 가장자리에서 반이 잘리니 안쪽으로 1px 들여 그린다
            $edge = RoundRect 1 1 ($s.Width - 3) ($s.Height - 3) 8
            $pen = New-Object Drawing.Pen((Color "#6366f1"), 2.5); $g.DrawPath($pen, $edge); $pen.Dispose(); $edge.Dispose()
        }
        $p.Dispose()
        $flags = [Windows.Forms.TextFormatFlags]"VerticalCenter, NoPadding"
        $titleY = if ($s.Tag.room) { 8 } else { 0 }; $titleH = if ($s.Tag.room) { 30 } else { $s.Height }
        $titleX = if ($s.Tag.room) { 16 } else { 12 }; $titleSpace = if ($s.Tag.room) { 76 } else { 40 }
        [Windows.Forms.TextRenderer]::DrawText($g, $s.Tag.name, $s.Font, (New-Object Drawing.Rectangle $titleX, $titleY, ($s.Width - $titleSpace), $titleH), (Color "#f4f4f5"), $flags)
        if ($s.Tag.lock) {
            $lockFont = New-Object Drawing.Font("Segoe MDL2 Assets", 8)
            [Windows.Forms.TextRenderer]::DrawText($g, [string][char]0xE72E, $lockFont, (New-Object Drawing.Rectangle ($s.Width - 48), $titleY, 18, $titleH),
                (Color "#a1a1aa"), [Windows.Forms.TextFormatFlags]"HorizontalCenter, VerticalCenter")
            $lockFont.Dispose()
        }
        $hot = $s.Cursor -eq [Windows.Forms.Cursors]::Hand  # X 위에 있는지는 커서 모양으로 기억한다 (MouseMove)
        # X 는 선 두 개로 직접 그린다 (글꼴 글자는 칸 가운데에서 살짝 비껴 나와서 동그라미 한가운데에 안 맞는다)
        $cx = $s.Width - 17; $cy = if ($s.Tag.room) { 23 } else { $s.Height / 2 }
        if ($hot) {  # 지우는 버튼이라는 걸 알게 X 뒤에 빨간 동그라미
            $red = New-Object Drawing.SolidBrush (Color "#ef4444"); $g.FillEllipse($red, ($cx - 10), ($cy - 10), 20, 20); $red.Dispose()
        }
        $pen = New-Object Drawing.Pen((Color $(if ($hot) { "#ffffff" } else { "#a1a1aa" })), 1.5)
        $g.DrawLine($pen, ($cx - 4), ($cy - 4), ($cx + 4), ($cy + 4)); $g.DrawLine($pen, ($cx - 4), ($cy + 4), ($cx + 4), ($cy - 4)); $pen.Dispose()
    })
    $b.Add_MouseDown({ param($s, $e) if ($e.Button -eq "Left" -and (-not $s.Tag.room -or $e.Y -lt 40)) { $s.Tag.down = @{ x = $e.X; y = $e.Y; onX = $e.X -ge $s.Width - 30; moved = $false } } })
    $b.Add_MouseMove({
        param($s, $e)
        $d = $s.Tag.down
        # 끌기: 조금(4px) 움직이면 시작. 카드 그림(ghost, 보라 테두리)이 마우스를 따라 위아래로 움직이고,
        # 원래 카드는 점선 빈칸이 되어 그림 가운데 높이에 맞춰 목록 안 자리를 바로바로 옮긴다 (누른 채면 카드 밖으로 나가도 이 카드가 마우스를 받는다)
        if ($d -and $s.Tag.drag -and -not $d.onX) {
            $flow = $s.Parent; $page = $flow.Parent
            if (-not $d.moved) {
                if ([Math]::Abs($e.X - $d.x) + [Math]::Abs($e.Y - $d.y) -lt 4) { return }
                $bmp = New-Object Drawing.Bitmap $s.Width, $s.Height
                $s.DrawToBitmap($bmp, $s.ClientRectangle)
                $g = [Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = "AntiAlias"
                $edge = RoundRect 1 1 ($s.Width - 3) ($s.Height - 3) 11
                $pen = New-Object Drawing.Pen((Color "#6366f1"), 2.5); $g.DrawPath($pen, $edge); $pen.Dispose(); $edge.Dispose(); $g.Dispose()
                $ghost = New-Object Windows.Forms.PictureBox
                $ghost.Image = $bmp; $ghost.Size = $s.Size; $ghost.Enabled = $false
                $ghost.Location = $page.PointToClient($s.PointToScreen([Drawing.Point]::Empty))
                $page.Controls.Add($ghost); $ghost.BringToFront()
                $d.ghost = $ghost; $d.moved = $true
                foreach ($c in $s.Controls) { $c.Visible = $false }
                $s.Invalidate()
            }
            $mouse = [Windows.Forms.Cursor]::Position
            $d.ghost.Top = [Math]::Max($flow.Top - 8, [Math]::Min($flow.Bottom - $d.ghost.Height + 8, $page.PointToClient($mouse).Y - $d.y))
            # 목록 위아래 끝 가까이 끌면 그쪽으로 스크롤
            $y = $flow.PointToClient($mouse).Y
            if ($y -lt 24 -or $y -gt $flow.Height - 24) {
                $flow.AutoScrollPosition = New-Object Drawing.Point 0, (-$flow.AutoScrollPosition.Y + $(if ($y -lt 24) { -16 } else { 16 }))
                Update-Bar $flow
            }
            $mid = $flow.PointToClient($page.PointToScreen((New-Object Drawing.Point 0, ($d.ghost.Top + $d.ghost.Height / 2)))).Y; $i = 0
            foreach ($c in $flow.Controls) { if ($c -ne $s -and $c.Top + $c.Height / 2 -lt $mid) { $i++ } }
            if ($flow.Controls.GetChildIndex($s) -ne $i) { $flow.Controls.SetChildIndex($s, $i) }
            return
        }
        # X 안팎을 넘나들 때만 다시 그린다 (움직일 때마다 그리면 깜빡인다). 끌 수 있는 배지는 몸통 위에서 십자 화살표 커서
        $hot = $e.X -ge $s.Width - 30 -and (-not $s.Tag.room -or $e.Y -lt 40)
        if ($hot -ne ($s.Cursor -eq [Windows.Forms.Cursors]::Hand)) {
            $s.Cursor = $(if ($hot) { [Windows.Forms.Cursors]::Hand } elseif ($s.Tag.drag) { [Windows.Forms.Cursors]::SizeAll } else { [Windows.Forms.Cursors]::Default }); $s.Invalidate()
        }
    })
    $b.Add_MouseUp({
        param($s)
        $d = $s.Tag.down; $s.Tag.down = $null
        if ($d -and $d.moved) {
            $d.ghost.Image.Dispose(); $d.ghost.Dispose()
            foreach ($c in $s.Controls) { $c.Visible = $true }
            & $s.Tag.drag; $s.Invalidate()
        }
    })
    $b.Add_MouseLeave({ param($s) if ($s.Cursor -eq [Windows.Forms.Cursors]::Hand) { $s.Cursor = [Windows.Forms.Cursors]::Default; $s.Invalidate() } })
    # 클릭은 손을 떼기(MouseUp) 전에 온다. 끌었으면 아무것도 안 한다. X 는 누를 때와 뗄 때 모두 X 위여야 지운다
    $b.Add_MouseClick({
        param($s, $e)
        $d = $s.Tag.down
        if (-not $d -or $d.moved) { return }
        if ($e.X -lt $s.Width - 30) { if ($s.Tag.pick -and -not $d.onX) { & $s.Tag.pick $s }; return }
        if (-not $d.onX) { return }
        & $s.Tag.remove $s.Tag.name
        $s.Parent.Controls.Remove($s); $s.Dispose()
    })
    if ($tipText) { $tip.SetToolTip($b, $tipText) }
    $flow.Controls.Add($b)
    $b
}

$removeStaff = { param($n) [void]$staff.names.Remove($n); Save-Staff }

# 서버가 켜져 있으면 그 방을 바로 닫는다 (안에 있던 사람은 "방송이 끝났어요"). 꺼져 있으면 바로 실패해서 넘어간다
function End-Room($n) {
    $body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ room = $n } -Compress))
    try { Invoke-RestMethod -Method Post "http://127.0.0.1:3000/api/end" -Body $body -ContentType "application/json" -TimeoutSec 3 | Out-Null } catch {}
}
$removeRoom = {
    param($n)
    if ($roomCfg.edit -and $roomCfg.edit.Tag.name -eq $n) { End-Edit }
    [void]$roomCfg.list.Remove(($roomCfg.list | Where-Object { $_.name -eq $n } | Select-Object -First 1)); Save-Rooms
    End-Room $n
}
# 끌어서 놓으면: 배지 순서대로 목록을 다시 줄 세워 저장 (입장 화면 방송 목록도 이 순서)
$moveRoom = {
    $order = @(foreach ($c in $roomCfg.flow.Controls) { $n = $c.Tag.name; $roomCfg.list | Where-Object { $_.name -eq $n } })
    $roomCfg.list.Clear(); foreach ($r in $order) { $roomCfg.list.Add($r) }
    Save-Rooms
}
# 방 배지를 누르면 고치기: 이름·비밀번호를 위 칸에 채우고 [+] 가 체크(저장)로. 같은 배지를 다시 누르거나 Esc 면 그만둔다
$pickRoom = {
    param($b)
    $same = $roomCfg.edit -eq $b
    End-Edit
    if ($same) { return }
    $r = $roomCfg.list | Where-Object { $_.name -eq $b.Tag.name } | Select-Object -First 1
    $roomCfg.edit = $b; $b.Tag.hl = $true; $b.Invalidate()
    $roomCfg.name.Text = $r.name; $roomCfg.pw.Text = $r.pw
    $tip.SetToolTip($roomCfg.plus, "저장"); $roomCfg.plus.Invalidate()
    [void]$roomCfg.name.Focus(); $roomCfg.name.Select($roomCfg.name.Text.Length, 0)  # 글자 커서는 이름 끝에 (다 골라 두지 않는다)
}
function End-Edit {
    if (-not $roomCfg.edit) { return }
    $roomCfg.edit.Tag.hl = $false; $roomCfg.edit.Invalidate(); $roomCfg.edit = $null
    $roomCfg.name.Text = ""; $roomCfg.pw.Text = ""
    $tip.SetToolTip($roomCfg.plus, "추가"); $roomCfg.plus.Invalidate()
}
function RoomTip($r) {
    $password = if ($r.pw) { "비밀번호: $($r.pw)" } else { "비밀번호 없음" }
    $share = if ($r.share -eq "everyone") { "누구나" } else { "방송 관리자만" }
    "$password`n운영 권한: $share"
}
function Add-RoomBadge($r) {
    $b = Add-Badge $roomCfg.flow $r.name $removeRoom (RoomTip $r) -Lock:([bool]$r.pw)
    $b.Tag.room = $r; $b.Tag.pick = $pickRoom; $b.Tag.drag = $moveRoom; $b.Margin = "0,0,0,12"
    $b.BackColor = Color "#232327"
    $b.Font = Font 11 -Bold; Set-BadgeText $b $r.name ([bool]$r.pw)
    # 둘째 줄: 왼쪽에 "운영 권한", 같은 줄 오른쪽에 같은 폭 버튼 두 개
    $b.Controls.Add((Label "운영 권한" 16 54 9 "#a1a1aa"))
    $buttons = @()
    foreach ($i in 0, 1) {
        $button = Button @("방송 관리자만", "누구나")[$i] (88 + $i * 147) 46 139 34 10
        $button.Tag = @{ value = @("staff", "everyone")[$i] }
        $button.AccessibleName = "$($r.name) 운영 권한 $($button.Text)"
        $button.BackColor = Color $(if ($r.share -eq $button.Tag.value) { "#4f46e5" } else { "#35353b" })
        $button.Add_Click({
            param($s)
            $card = $s.Parent; $card.Tag.room.share = $s.Tag.value
            Save-Rooms
            foreach ($choice in $card.Tag.buttons) {
                $choice.BackColor = Color $(if ($choice.Tag.value -eq $card.Tag.room.share) { "#4f46e5" } else { "#35353b" })
            }
            $tip.SetToolTip($card, (RoomTip $card.Tag.room))
        })
        $b.Controls.Add($button); $buttons += $button
    }
    $b.Tag.buttons = $buttons
}

# 칸에 적은 닉네임 추가 (빈칸·이미 있는 이름은 넘어간다. 대소문자는 같은 이름으로 본다)
function Add-Staff {
    $name = $staff.box.Text.Trim()
    $staff.box.Text = ""; [void]$staff.box.Focus()
    if (-not $name -or ($staff.names | Where-Object { $_ -ieq $name })) { return }
    $staff.names.Add($name); Save-Staff; [void](Add-Badge $staff.flow $name $removeStaff)
}

# 방 추가, 고치는 중이면 그 방 저장 (방 이름이 비었거나 다른 방과 같으면 넘어간다. 탭은 파일 칸 나누기라 뺀다)
function Add-Room {
    $name = ($roomCfg.name.Text -replace "`t", " ").Trim()
    $pw = ($roomCfg.pw.Text -replace "`t", "").Trim()
    if (-not $name) { [void]$roomCfg.name.Focus(); return }
    $b = $roomCfg.edit
    $old = if ($b) { $b.Tag.name }
    if ($roomCfg.list | Where-Object { $_.name -ieq $name -and $_.name -ne $old }) { [void]$roomCfg.name.Focus(); $roomCfg.name.SelectAll(); return }
    if ($b) {
        $r = $roomCfg.list | Where-Object { $_.name -eq $old } | Select-Object -First 1
        $r.name = $name; $r.pw = $pw; Save-Rooms
        Set-BadgeText $b $name ([bool]$pw); $tip.SetToolTip($b, (RoomTip $r))
        # 방 이름 = 통화 서버의 방 이름이라 켜진 방은 이름을 못 바꾼다. 옛 이름 방은 닫고, 사람들은 새 이름으로 다시 들어온다
        if ($name -cne $old) { End-Room $old }
        End-Edit; [void]$roomCfg.name.Focus()
        return
    }
    $roomCfg.name.Text = ""; $roomCfg.pw.Text = ""; [void]$roomCfg.name.Focus()
    $r = [pscustomobject]@{ name = $name; pw = $pw; share = "staff" }
    $roomCfg.list.Add($r); Save-Rooms; Add-RoomBadge $r
}

# 한 줄 입력칸: 둥근 테두리 칸 안에 테두리 없는 글자칸 (글자칸에 있으면 테두리가 보라색). 빈칸일 때 흐린 $hint, Enter 는 $onEnter
function New-Input($parent, $x, $y, $w, $hint, $onEnter) {
    $wrap = New-Object Windows.Forms.Panel
    $wrap.Location = "$x,$y"; $wrap.Size = "$w,38"; NoFlicker $wrap
    $wrap.Add_Paint({
        param($s, $e)
        $g = $e.Graphics; $g.SmoothingMode = "AntiAlias"; $g.Clear($s.Parent.BackColor)
        $p = RoundRect 0 0 ($s.Width - 1) ($s.Height - 1) 9
        $brush = New-Object Drawing.SolidBrush (Color "#27272a"); $g.FillPath($brush, $p); $brush.Dispose()
        $pen = New-Object Drawing.Pen((Color $(if ($s.Controls[0].Focused) { "#6366f1" } else { "#3f3f46" })), 1)
        $g.DrawPath($pen, $p); $pen.Dispose(); $p.Dispose()
    })
    $box = New-Object Windows.Forms.TextBox
    $box.BorderStyle = "None"; $box.Font = Font 11; $box.BackColor = Color "#27272a"; $box.ForeColor = Color "#f4f4f5"
    $box.Location = "12,9"; $box.Width = $w - 24; $box.MaxLength = 40
    $box.Tag = @{ hint = $hint; enter = $onEnter }
    $box.Add_HandleCreated({ param($s) [void][Win.Dwm]::SendMessage($s.Handle, 0x1501, [IntPtr]1, $s.Tag.hint) })
    $box.Add_GotFocus({ param($s) $s.Parent.Invalidate() }); $box.Add_LostFocus({ param($s) $s.Parent.Invalidate() })
    $box.Add_KeyDown({
        param($s, $e)
        if ($e.KeyCode -eq "Enter") { $e.SuppressKeyPress = $true; & $s.Tag.enter }
        elseif ($e.KeyCode -eq "Escape" -and $roomCfg.edit) { $e.SuppressKeyPress = $true; End-Edit }  # 방 고치기 그만두기
    })
    $wrap.Controls.Add($box); $parent.Controls.Add($wrap)
    $box
}

# 동그란 [+] 버튼 (누르면 $onClick). 방을 고치는 중이면 채팅방 쪽 버튼은 체크(저장) 모양. 버튼을 돌려준다
function New-Plus($parent, $x, $y, $onClick) {
    $plus = New-Object Windows.Forms.Button
    $plus.Location = "$x,$y"; $plus.Size = "38,38"; $plus.FlatStyle = "Flat"; $plus.FlatAppearance.BorderSize = 0
    $plus.Cursor = [Windows.Forms.Cursors]::Hand; $plus.Tag = $onClick; NoFlicker $plus
    $plus.Add_Paint({
        param($s, $e)
        $g = $e.Graphics; $g.SmoothingMode = "AntiAlias"; $g.Clear($s.Parent.BackColor)
        $hot = $s.ClientRectangle.Contains($s.PointToClient([Windows.Forms.Cursor]::Position))
        $brush = New-Object Drawing.SolidBrush (Color $(if ($hot) { "#6366f1" } else { "#4f46e5" }))
        $g.FillEllipse($brush, 0, 0, $s.Width - 1, $s.Height - 1); $brush.Dispose()
        $f = New-Object Drawing.Font("Segoe MDL2 Assets", 11)
        [Windows.Forms.TextRenderer]::DrawText($g, [string][char]$(if ($s -eq $roomCfg.plus -and $roomCfg.edit) { 0xE73E } else { 0xE710 }), $f, $s.ClientRectangle, [Drawing.Color]::White, [Windows.Forms.TextFormatFlags]"HorizontalCenter, VerticalCenter")
        $f.Dispose()
    })
    $plus.Add_MouseEnter({ param($s) $s.Invalidate() }); $plus.Add_MouseLeave({ param($s) $s.Invalidate() })
    $plus.Add_Click({ param($s) & $s.Tag })
    $tip.SetToolTip($plus, "추가")
    $parent.Controls.Add($plus)
    $plus
}

# 목록 옆 얇은 막대: 목록이 칸보다 길 때만 보이고, 보이는 만큼의 길이·위치로
function Update-Bar($flow) {
    $bar = $flow.Tag; $view = $flow.ClientSize.Height; $total = $flow.DisplayRectangle.Height
    $bar.Visible = $total -gt $view + 1
    if (-not $bar.Visible) { return }
    $h = [Math]::Max(30, [int]($view * $view / $total))
    $bar.Height = $h; $bar.Top = [int]((-$flow.AutoScrollPosition.Y) * ($view - $h) / ($total - $view)); $bar.Invalidate()
}

# 오른쪽 내용 한 쪽: 제목 + 흐린 설명 + 배지들이 왼쪽부터 차례로 쌓이는 자리(넘치면 아랫줄로, 더 넘치면 스크롤). 입력칸은 92 줄에 둔다
function New-Page($dlg, $title, $desc) {
    $page = New-Object Windows.Forms.Panel
    $page.Location = "168,0"; $page.Size = "448,600"; $page.BackColor = $dlg.BackColor
    $page.Controls.Add((Label $title 24 24 14 "#f4f4f5" -Bold))
    $page.Controls.Add((Label $desc 26 60 9 "#a1a1aa"))
    # 윈도우 기본 스크롤바는 흰색이라(어두운 모양으로 안 바뀜) 목록을 감싼 칸(clip) 밖으로 밀어내 감추고, 얇은 회색 막대(bar)를 직접 그린다.
    # 오른쪽 여백(Padding) = 숨은 스크롤바 폭이라, 스크롤바가 생겨도 방 카드(390)가 들어가서 좌우 스크롤바는 안 생긴다
    $sbw = [Windows.Forms.SystemInformation]::VerticalScrollBarWidth
    $clip = New-Object Windows.Forms.Panel
    $clip.Location = "24,148"; $clip.Size = "412,432"; $clip.BackColor = $page.BackColor
    $flow = New-Object Windows.Forms.FlowLayoutPanel
    $flow.Size = "$(412 + $sbw),432"; $flow.Padding = "0,0,$sbw,0"; $flow.AutoScroll = $true; $flow.BackColor = $page.BackColor
    $bar = New-Object Windows.Forms.Panel
    $bar.Location = "404,0"; $bar.Size = "6,30"; $bar.Visible = $false; $bar.BackColor = $page.BackColor; $bar.Tag = @{ flow = $flow; grab = $null }
    NoFlicker $bar
    $bar.Add_Paint({
        param($s, $e)
        $g = $e.Graphics; $g.SmoothingMode = "AntiAlias"; $g.Clear($s.BackColor)
        $p = RoundRect 0 0 ($s.Width - 1) ($s.Height - 1) 3
        $brush = New-Object Drawing.SolidBrush (Color $(if ($s.Tag.grab -or $s.ClientRectangle.Contains($s.PointToClient([Windows.Forms.Cursor]::Position))) { "#71717a" } else { "#3f3f46" }))
        $g.FillPath($brush, $p); $brush.Dispose(); $p.Dispose()
    })
    # 막대를 잡고 끌면 그만큼 목록이 움직인다
    $bar.Add_MouseDown({ param($s) $s.Tag.grab = @{ y = [Windows.Forms.Cursor]::Position.Y; top = $s.Top } })
    $bar.Add_MouseMove({
        param($s)
        $grab = $s.Tag.grab; if (-not $grab) { return }
        $f = $s.Tag.flow; $view = $f.ClientSize.Height; $total = $f.DisplayRectangle.Height
        $top = [Math]::Max(0, [Math]::Min($view - $s.Height, $grab.top + [Windows.Forms.Cursor]::Position.Y - $grab.y))
        $f.AutoScrollPosition = New-Object Drawing.Point 0, ([int]($top * ($total - $view) / ($view - $s.Height)))
        Update-Bar $f
    })
    $bar.Add_MouseUp({ param($s) $s.Tag.grab = $null; $s.Invalidate() })
    $bar.Add_MouseEnter({ param($s) $s.Invalidate() }); $bar.Add_MouseLeave({ param($s) $s.Invalidate() })
    $flow.Tag = $bar
    $flow.Add_Scroll({ Update-Bar $this }); $flow.Add_MouseWheel({ Update-Bar $this }); $flow.Add_Layout({ Update-Bar $this })
    $clip.Controls.Add($flow); $clip.Controls.Add($bar); $bar.BringToFront()
    $page.Controls.Add($clip)
    $dlg.Controls.Add($page)
    @{ page = $page; flow = $flow }
}

# 왼쪽 메뉴에서 i 번째를 고른다: 그 쪽만 보이고, 메뉴 버튼은 고른 것만 밝은 바탕, 첫 입력칸에 글자 커서
function Select-Page($i) {
    for ($j = 0; $j -lt $settings.pages.Count; $j++) {
        $settings.pages[$j].Visible = $j -eq $i
        $settings.navs[$j].BackColor = Color $(if ($j -eq $i) { "#3f3f46" } else { "#111113" }); $settings.navs[$j].Invalidate()
    }
    [void]$(if ($i -eq 0) { $staff.box } else { $roomCfg.name }).Focus()
}

function Show-Settings {
    $dlg = New-Object Windows.Forms.Form
    $dlg.Text = "DOLIVE 설정"; $dlg.Icon = $form.Icon
    $dlg.ClientSize = "616,600"  # 예전 운영진 창(308x300)의 2배
    $dlg.FormBorderStyle = "FixedSingle"; $dlg.MaximizeBox = $false; $dlg.MinimizeBox = $false
    $dlg.StartPosition = "CenterParent"; $dlg.BackColor = $form.BackColor
    $dlg.Add_HandleCreated({ param($s) $on = 1; [void][Win.Dwm]::DwmSetWindowAttribute($s.Handle, 20, [ref]$on, 4) })

    # 방송 관리자: 닉네임 칸 + [+]
    $a = New-Page $dlg "방송 관리자" "도름스 닉네임을 적으면 그 사람은 방송에서 방장 권한을 받아요"
    $staff.box = New-Input $a.page 24 92 346 "도름스 닉네임" { Add-Staff }
    [void](New-Plus $a.page 386 92 { Add-Staff })
    $staff.flow = $a.flow

    # 채팅방 관리: 방 이름 칸 + 비밀번호 칸 + [+]. 자물쇠 = 비밀번호 방 (배지에 마우스를 올리면 비밀번호가 보인다)
    # 방은 한 줄에 하나씩 (끌어서 위아래 순서를 바꾼다)
    $b = New-Page $dlg "채팅방 관리" "각 방의 운영 권한: 화면공유 · 강퇴 · 마이크 끄기"
    $b.flow.FlowDirection = "TopDown"; $b.flow.WrapContents = $false
    # 방 목록·창의 빈 곳을 누르면 고치기를 그만둔다 (새 방을 바로 넣을 수 있게)
    $b.flow.Add_MouseClick({ End-Edit }); $b.page.Add_MouseClick({ End-Edit })
    $roomCfg.name = New-Input $b.page 24 92 200 "방 이름" { Add-Room }
    $roomCfg.pw = New-Input $b.page 232 92 138 "비밀번호" { Add-Room }
    $roomCfg.plus = New-Plus $b.page 386 92 { Add-Room }
    $roomCfg.flow = $b.flow

    # 왼쪽 메뉴 (창보다 살짝 어두운 바탕)
    $side = New-Object Windows.Forms.Panel
    $side.Location = "0,0"; $side.Size = "168,600"; $side.BackColor = Color "#111113"
    $dlg.Controls.Add($side)
    $settings.pages = @($a.page, $b.page)
    $settings.navs = @(
        foreach ($i in 0, 1) {
            $nb = Button @("방송 관리자", "채팅방 관리")[$i] 12 (24 + $i * 48) 144 40 10
            $nb.Tag = $i; $nb.Add_Click({ param($s) Select-Page $s.Tag })
            $side.Controls.Add($nb); $nb
        }
    )

    $staff.names.Clear()
    foreach ($n in (Get-Content $staffFile -Encoding UTF8 -ErrorAction SilentlyContinue)) {
        $n = $n.Trim()
        if ($n -and -not ($staff.names | Where-Object { $_ -ieq $n })) { $staff.names.Add($n); [void](Add-Badge $staff.flow $n $removeStaff) }
    }
    $roomCfg.list.Clear(); $roomCfg.edit = $null
    $lines = if (Test-Path $roomsFile) { Get-Content $roomsFile -Encoding UTF8 } else { "DOLIVE`t" }
    foreach ($line in $lines) {
        $name, $pw, $share = "$line" -split "`t", 3
        $name = $name.Trim()
        if ($name -and -not ($roomCfg.list | Where-Object { $_.name -ieq $name })) {
            $r = [pscustomobject]@{ name = $name; pw = "$pw"; share = $(if ($share -eq "everyone") { "everyone" } else { "staff" }) }
            $roomCfg.list.Add($r); Add-RoomBadge $r
        }
    }
    $dlg.Add_Shown({ Select-Page 0 })
    [void]$dlg.ShowDialog($form)
    $dlg.Dispose()
}

# 한 줄에 이름(왼쪽, LIVE OFF 글자색) + [접속하기](그 주소를 연다) + 오른쪽 작은 아이콘 버튼. 두 줄 모두 같은 자리·같은 크기
# 아이콘은 윈도우에 들어 있는 기호 글꼴(Segoe MDL2 Assets)의 모양: 관리자 줄은 톱니바퀴(DOLIVE 설정 창), 클라이언트 줄은 복사(누르면 체크 표시로)
function LinkRow($title, $url, $y, [switch]$Staff) {
    [void](Label $title 24 ($y + 4) 11 "#a1a1aa")
    $go = Button "접속하기" 166 $y 80 30 9
    $go.BackColor = Color "#3f3f46"; $go.Tag = $url
    $go.Add_Click({ param($s) Start-Process $s.Tag })
    $icon = Button ([string][char]$(if ($Staff) { 0xE713 } else { 0xE8C8 })) 254 $y 30 30 9
    $icon.Font = New-Object Drawing.Font("Segoe MDL2 Assets", 11)
    $icon.BackColor = Color "#3f3f46"; $icon.Tag = $url
    if ($Staff) {
        $icon.Add_Click({ Show-Settings })
        $tip.SetToolTip($icon, "DOLIVE 설정 (방송 관리자, 채팅방 관리)")
    } else {
        $icon.Add_Click({ param($s) [Windows.Forms.Clipboard]::SetText($s.Tag); $s.Text = [string][char]0xE73E })
        $tip.SetToolTip($icon, "주소 복사")
    }
}
# 관리자(방장) = 이 PC / 클라이언트 = 친구들 주소 (도름스 로그인해야 들어간다. 방송 관리자(운영진)와 채팅방은 톱니바퀴에서 정한다)
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
