@echo off
rem ==========================================================================
rem  Kibborg UI demo — launcher. Экраны описаны в Kibborg_CLI/UI.md.
rem  Тело скрипта лежит ниже строки-маркера и исполняется PowerShell.
rem  cmd до маркера не доходит: выход происходит строкой выше.
rem
rem  FROZEN: visual golden интерфейса. Демо фиксирует спеку UI.md и больше не
rem  развивается: новые экраны и фичи не добавляются, изменения — только по
rem  правкам спеки. Боевой рендер — пакет @kibborg/tui (PLAN.md R3), не этот файл.
rem
rem  Запуск:  kibborg-demo.bat                 — интерактивное меню экранов
rem           kibborg-demo.bat live            — живой кадр: ввод, overlay, режимы
rem           kibborg-demo.bat all             — все слайды подряд
rem           kibborg-demo.bat session         — один слайд по имени
rem           kibborg-demo.bat 3               — один слайд по номеру
rem           kibborg-demo.bat all --plain     — без цвета и анимации (CI)
rem           kibborg-demo.bat all --truecolor — принудительный 24-бит цвет
rem ==========================================================================
setlocal
chcp 65001 >nul
set "KPS=powershell"
where pwsh >nul 2>nul && set "KPS=pwsh"
set "KDEMO_DIR=%~dp0"
set "KARG=%*"
%KPS% -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); $m=[regex]::Match($t,'(?m)^#PS-MARK'); if(-not $m.Success){ Write-Error 'marker not found'; exit 9 }; & ([scriptblock]::Create($t.Substring($m.Index)))"
set "KRC=%ERRORLEVEL%"
endlocal & exit /b %KRC%

#PS-MARK
# ---------------------------------------------------------------------------
# Kibborg UI demo — рендер слайдов и живого кадра из Kibborg_CLI/UI.md.
# Это мок интерфейса (не агентское ядро): проверяются геометрия, токены темы,
# плотности, диалоги и поведение нижней зоны (composer + overlay + статус).
# Файлы на диске не меняет.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$script:Esc = [char]27
$script:RawArgs = @()
if ($env:KARG) { $script:RawArgs = @($env:KARG -split '\s+' | Where-Object { $_ -ne '' }) }
$script:Plain = $false
$script:ForceTrue = $false
foreach ($a in $script:RawArgs) {
    switch -Regex ($a) {
        '^--?(plain|nocolor|no-color)$' { $script:Plain = $true }
        '^--?truecolor$' { $script:ForceTrue = $true }
    }
}
if ($env:NO_COLOR -and -not $script:ForceTrue) { $script:Plain = $true }
if ($env:TERM -eq 'dumb') { $script:Plain = $true }
$script:Animated = (-not $script:Plain) -and (-not [Console]::IsOutputRedirected)

$script:TrueColor = $false
if (-not $script:Plain) {
    if ($script:ForceTrue -or $env:WT_SESSION -or $env:COLORTERM -or $env:TERM_PROGRAM) { $script:TrueColor = $true }
}

# --- токены темы (UI.md §2) -------------------------------------------------
$script:Tok = @{
    Accent  = @(92, 225, 230)
    Shimmer = @(154, 240, 243)
    Success = @(61, 220, 151)
    Warn    = @(245, 185, 66)
    Error   = @(255, 92, 122)
    Muted   = @(122, 132, 148)
    Subtle  = @(58, 66, 80)
    Text    = @(214, 222, 235)
    Surface = @(22, 27, 34)
    Bash    = @(232, 121, 249)
    Perm    = @(165, 180, 252)
}
$script:Fall = @{
    Accent = '96'; Shimmer = '96'; Success = '92'; Warn = '93'; Error = '91'
    Muted = '90'; Subtle = '90'; Text = '97'; Surface = '0'; Bash = '95'; Perm = '94'
}

function KcFallbackFor {
    param($Rgb)
    $lum = (0.299 * $Rgb[0] + 0.587 * $Rgb[1] + 0.114 * $Rgb[2])
    if ($lum -ge 190) { return '97' }
    if ($lum -ge 150) { return '96' }
    if ($lum -ge 110) { return '94' }
    if ($lum -ge 70) { return '90' }
    return '34'
}

function Kc {
    param([string]$Name, [switch]$Bold, [switch]$Dim)
    if ($script:Plain) { return '' }
    $e = $script:Esc
    if ($script:TrueColor) {
        $rgb = $script:Tok[$Name]
        $s = "$e[38;2;$($rgb[0]);$($rgb[1]);$($rgb[2])m"
    }
    else {
        $s = "$e[$($script:Fall[$Name])m"
    }
    if ($Dim) { $s += "$e[2m" }
    if ($Bold) { $s += "$e[1m" }
    return $s
}

function KcRgb {
    param($Rgb, [switch]$Dim)
    if ($script:Plain) { return '' }
    $e = $script:Esc
    if ($script:TrueColor) { $s = "$e[38;2;$($Rgb[0]);$($Rgb[1]);$($Rgb[2])m" }
    else { $s = "$e[$(KcFallbackFor $Rgb)m" }
    if ($Dim) { $s += "$e[2m" }
    return $s
}

function Mix-Rgb {
    param($A, $B, [double]$T)
    @([int]($A[0] + ($B[0] - $A[0]) * $T), [int]($A[1] + ($B[1] - $A[1]) * $T), [int]($A[2] + ($B[2] - $A[2]) * $T))
}

$script:Z = if ($script:Plain) { '' } else { "$script:Esc[0m" }

function T {
    param([string]$Name, [string]$Text)
    if ($script:Plain) { return $Text }
    return (Kc $Name) + $Text + $script:Z
}

# --- display width: не .Length ----------------------------------------------
# Ширина строки в колонках терминала: CSI-последовательности игнорируются,
# комбинирующие и zero-width — 0, Wide/CJK/emoji — 2.
function Test-Wide-Codepoint {
    param([int]$C)
    return (($C -ge 0x1100 -and $C -le 0x115F) -or
            ($C -ge 0x2E80 -and $C -le 0x303E) -or
            ($C -ge 0x3041 -and $C -le 0x33FF) -or
            ($C -ge 0x3400 -and $C -le 0x4DBF) -or
            ($C -ge 0x4E00 -and $C -le 0x9FFF) -or
            ($C -ge 0xA000 -and $C -le 0xA4CF) -or
            ($C -ge 0xAC00 -and $C -le 0xD7A3) -or
            ($C -ge 0xF900 -and $C -le 0xFAFF) -or
            ($C -ge 0xFE30 -and $C -le 0xFE6F) -or
            ($C -ge 0xFF00 -and $C -le 0xFF60) -or
            ($C -ge 0xFFE0 -and $C -le 0xFFE6) -or
            ($C -ge 0x1F300 -and $C -le 0x1FAFF) -or
            ($C -ge 0x20000 -and $C -le 0x3FFFD))
}

function Test-ZeroWidth-Codepoint {
    param([int]$C)
    return (($C -ge 0x0300 -and $C -le 0x036F) -or ($C -ge 0x200B -and $C -le 0x200F) -or ($C -eq 0xFE0F) -or ($C -eq 0x200D) -or ($C -ge 0xFE00 -and $C -le 0xFE0F))
}

# Ширина строки в колонках: CSI не считается, комбинирующие = 0, Wide/CJK/emoji
# = 2, tab = 4. Итерация идёт по code points, а не по char: surrogate-пары
# (emoji вне BMP) не должны разваливаться на два «широких» символа.
function Get-DisplayWidth {
    param([string]$s)
    if (-not $s) { return 0 }
    $t = $s -replace "$([char]27)\[[0-9;?]*[a-zA-Z]", ''
    $arr = $t.ToCharArray()
    $w = 0
    $i = 0
    while ($i -lt $arr.Length) {
        $cp = [int]$arr[$i]
        $len = 1
        if ([char]::IsHighSurrogate($arr[$i]) -and ($i + 1) -lt $arr.Length -and [char]::IsLowSurrogate($arr[$i + 1])) {
            $cp = [char]::ConvertToUtf32($arr[$i], $arr[$i + 1])
            $len = 2
        }
        $i += $len
        if ($cp -eq 9) { $w += 4; continue }
        if ($cp -lt 32 -or $cp -eq 127) { continue }
        if (Test-ZeroWidth-Codepoint $cp) { continue }
        if (Test-Wide-Codepoint $cp) { $w += 2 } else { $w += 1 }
    }
    return $w
}

function VLen {
    param([string]$s)
    return (Get-DisplayWidth $s)
}

function PadR {
    param([string]$s, [int]$w)
    $l = VLen $s
    if ($l -ge $w) { return $s }
    return $s + (' ' * ($w - $l))
}

function PadL {
    param([string]$s, [int]$w)
    $l = VLen $s
    if ($l -ge $w) { return $s }
    return (' ' * ($w - $l)) + $s
}

$script:CaptureMode = $false
$script:Capture = @()

function Out-Line {
    param([string]$s = '')
    if ($script:CaptureMode) { $script:Capture += , $s; return }
    [Console]::Out.WriteLine($s)
}
function Blank { Out-Line '' }

# --- геометрия: всё выводится из ширины терминала ---------------------------
function Get-ConsoleWidth {
    if ([Console]::IsOutputRedirected) { return 88 }
    $w = 0
    try { $w = [Console]::WindowWidth } catch { $w = 88 }
    if ($w -lt 40) { return 88 }
    return $w
}

function Sync-Geometry {
    $script:W = Get-ConsoleWidth
    $script:Inner = [Math]::Max(60, $script:W - 4)
    if ($script:W -lt 80) { $script:Density = 'compact' }
    elseif ($script:W -lt 110) { $script:Density = 'balanced' }
    else { $script:Density = 'rich' }
}

function Get-InnerWidth { return $script:Inner }
Sync-Geometry

function BoxTop {
    param([string]$Label = '', [string]$Right = '', [string]$Color = 'Subtle')
    $inner = Get-InnerWidth
    $l = if ($Label) { " $Label " } else { '' }
    $r = if ($Right) { " $Right " } else { '' }
    $fill = $inner - 3 - (VLen $l) - (VLen $r)
    if ($fill -lt 0) { $fill = 0 }
    return (T $Color '╭─') + (T Text $l) + (T $Color ('─' * $fill)) + (T Text $r) + (T $Color '─╮')
}
function BoxBot {
    param([string]$Color = 'Subtle')
    return (T $Color ('╰' + ('─' * ((Get-InnerWidth) - 2)) + '╯'))
}
function BoxLine {
    param([string]$Content = '', [string]$Color = 'Subtle')
    $inner = Get-InnerWidth
    return (T $Color '│') + (PadR (' ' + $Content) ($inner - 2)) + (T $Color '│')
}

# --- общие элементы ---------------------------------------------------------
function Show-Header {
    param([string]$Title)
    if ($script:Density -eq 'compact') {
        Out-Line ('  ' + (T Accent '◆ KIBBORG') + '  ' + (T Muted 'v1.0.0'))
    }
    else {
        Out-Line ('  ' + (T Accent '◆ KIBBORG') + '  ' + (T Muted 'v1.0.0') + '    ' + (T Muted '~/Projects/my-app') + '    ' + (T Warn 'main*') + '    ' + (T Text 'DeepSeek V4 Flash'))
    }
    Out-Line ('  ' + (T Subtle ('─' * ((Get-InnerWidth) - 4))))
    if ($Title) { Out-Line ('  ' + (T Muted $Title)); Blank }
}

# Полоса контекста: заполнение считается от процента, а не зашито.
function Bar10 {
    param([int]$Pct)
    $filled = [Math]::Round(10 * $Pct / 100)
    if ($filled -lt 0) { $filled = 0 }
    if ($filled -gt 10) { $filled = 10 }
    return (T Accent ('▓' * $filled)) + (T Subtle ('░' * (10 - $filled)))
}

# Состав статус-строки — алгоритм по ширине (UI.md §3), а не готовые макеты:
# состав режется по одному элементу с шагом порога, строка не переносится.
function Status-Text {
    param([int]$Pct = 18, [string]$Mode = 'Agent', [string]$Cost = '$0.04', [string]$Turn = '4.2s', [string]$Git = 'main*', [int]$Cols = 0)
    if ($Cols -le 0) { $Cols = $script:W }
    $ctx = (T Muted 'ctx ') + (T Text "$Pct%")
    if ($Cols -ge 72) { $ctx = $ctx + ' ' + (Bar10 $Pct) }
    $parts = @((T Text 'DeepSeek V4 Flash'), $ctx)
    if ($Cols -ge 110) { $parts += (T Muted $Cost) }
    if ($Cols -ge 80) { $parts += (T Muted $Turn) }
    if ($Cols -ge 88) { $parts += (T Warn $Git) }
    $parts += (T Accent $Mode)
    return ('  ' + ($parts -join (T Subtle ' · ')))
}

function Status-Line {
    param([int]$Pct = 18, [string]$Mode = 'Agent')
    Out-Line (Status-Text -Pct $Pct -Mode $Mode)
}

# Composer: ширина привязана к терминалу; подсказка гаснет, когда есть ввод.
# Dashed-линия ровно на всю ширину внутренней области (кратно паре «- »).
function Make-Dash {
    param([int]$Width)
    if ($Width -le 2) { return '' }
    $pairs = [Math]::Floor($Width / 2)
    $s = ('- ' * $pairs)
    if ($s.Length -gt $Width) { $s = $s.Substring(0, $Width) }
    elseif ($s.Length -lt $Width) { $s = $s + ('-' * ($Width - $s.Length)) }
    return $s
}

# Префикс строки ввода — единственное место, где задан отступ промпта.
# Курсор в live ставится по его display-width, а не по «магической» колонке.
function Get-ComposerPrefix {
    return ('  ' + (T Subtle '|') + ' ' + '  ' + (T Accent '>') + ' ')
}

function Get-ComposerInputOffset {
    return (Get-DisplayWidth (Get-ComposerPrefix))
}

# Хвост строки шириной не более $W колонок (итерация с конца, по code points).
function Take-TailWidth {
    param([string]$S, [int]$W)
    if ($W -le 0 -or -not $S) { return '' }
    $arr = $S.ToCharArray()
    $acc = 0
    $i = $arr.Length
    while ($i -gt 0) {
        $len = 1
        $cp = [int]$arr[$i - 1]
        if ($i -ge 2 -and [char]::IsLowSurrogate($arr[$i - 1]) -and [char]::IsHighSurrogate($arr[$i - 2])) {
            $cp = [char]::ConvertToUtf32($arr[$i - 2], $arr[$i - 1])
            $len = 2
        }
        $cw = 1
        if (Test-ZeroWidth-Codepoint $cp) { $cw = 0 }
        elseif (Test-Wide-Codepoint $cp) { $cw = 2 }
        if (($acc + $cw) -gt $W) { break }
        $acc += $cw
        $i -= $len
    }
    return $S.Substring($i)
}

# Видимая часть ввода: длинный draft показывается хвостом с маркером «…»,
# поэтому строка composer никогда не переносится терминалом.
function Get-ComposerView {
    param([string]$Draft)
    $avail = (Get-InnerWidth) - (Get-DisplayWidth (Get-ComposerPrefix)) - 1
    if ($avail -lt 1) { $avail = 1 }
    if ((Get-DisplayWidth $Draft) -le $avail) { return @{ Text = $Draft; Hidden = 0 } }
    $tail = Take-TailWidth $Draft ($avail - 1)
    return @{ Text = ('…' + $tail); Hidden = ($Draft.Length - $tail.Length) }
}

function Composer-Block {
    param([string]$Draft = '', [switch]$ShowHint)
    $inner = Get-InnerWidth
    $pad = '  '
    $dash = (T Subtle (Make-Dash $inner))
    $out = @()
    $out += ($pad + $dash)
    $view = Get-ComposerView $Draft
    $out += ((Get-ComposerPrefix) + (PadR ((T Text $view.Text) + (T Accent '_')) ($inner + 1 - (Get-DisplayWidth (Get-ComposerPrefix)))) + (T Subtle '|'))
    if ($ShowHint -and -not $Draft) {
        $out += ($pad + (T Subtle '|') + ' ' + (PadR ('    ' + (T Muted '@ files   / commands   ! shell   shift+enter nl')) ($inner - 3)) + (T Subtle '|'))
    }
    else {
        $out += ($pad + (T Subtle '|') + ' ' + (PadR '' ($inner - 3)) + (T Subtle '|'))
    }
    $out += ($pad + $dash)
    return $out
}

function Composer {
    param([string]$Draft = '')
    foreach ($l in (Composer-Block -Draft $Draft -ShowHint)) { Out-Line $l }
}

# --- анимация на reserved-строке (без \r-wipe и «угадывания» пробелов) ------
function Set-LineAt {
    param([int]$Y, [string]$Text)
    try {
        [Console]::SetCursorPosition(0, $Y)
        [Console]::Out.Write($Text + "$script:Esc[0K")
        return $true
    }
    catch { return $false }
}

$script:SpinFrames = @('·', '✢', '✳', '✶', '✻', '✽')

function Format-Spin {
    param([string]$Frame, [string]$Verb, [string]$Meta)
    '  ' + (T Shimmer $Frame) + '  ' + (T Text $Verb) + (T Muted ('…  ' + $Meta))
}

function Animate-Spin {
    param([int]$Y, [string]$Verb, [string]$Meta, [int]$Frames = 16)
    if (-not $script:Animated) {
        if ($Y -ge 0) { $null = Set-LineAt $Y (Format-Spin '✳' $Verb $Meta) } else { Out-Line (Format-Spin '✳' $Verb $Meta) }
        return
    }
    for ($i = 0; $i -lt $Frames; $i++) {
        $f = $script:SpinFrames[$i % $script:SpinFrames.Count]
        if (-not (Set-LineAt $Y (Format-Spin $f $Verb $Meta))) { break }
        Start-Sleep -Milliseconds 70
    }
    $null = Set-LineAt $Y (Format-Spin '✳' $Verb $Meta)
}

# --- wordmark: вертикальный градиент ice → accent, band анимируется ----------
function Get-Figlet {
    @(
        '██╗  ██╗██╗██████╗ ██████╗  ██████╗ ██████╗  ██████╗',
        '██║ ██╔╝██║██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔════╝',
        '█████╔╝ ██║██████╔╝██████╔╝██║   ██║██████╔╝██║  ███╗',
        '██╔═██╗ ██║██╔══██╗██╔══██╗██║   ██║██╔══██╗██║   ██║',
        '██║  ██╗██║██████╔╝██████╔╝╚██████╔╝██║  ██║╚██████╔╝',
        '╚═╝  ╚═╝╚═╝╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝'
    )
}

function Write-Figlet {
    $art = Get-Figlet
    $top = $script:Tok.Shimmer
    $bot = $script:Tok.Accent
    for ($i = 0; $i -lt $art.Count; $i++) {
        $t = 0.0
        if ($art.Count -gt 1) { $t = $i / ($art.Count - 1) }
        $col = Mix-Rgb $top $bot $t
        Out-Line ('  ' + (KcRgb $col) + $art[$i] + $script:Z)
    }
}

function Format-Band {
    param([double]$Phase = 0, [int]$Cells = 24)
    $s = ''
    for ($i = 0; $i -lt $Cells; $i++) {
        $k = [Math]::Abs([Math]::Sin($Phase + $i * 0.42))
        $ch = '░'
        if ($k -gt 0.78) { $ch = '█' }
        elseif ($k -gt 0.52) { $ch = '▓' }
        elseif ($k -gt 0.26) { $ch = '▒' }
        $col = Mix-Rgb $script:Tok.Accent $script:Tok.Shimmer $k
        $s += (KcRgb $col) + $ch
    }
    return $s + $script:Z
}

# --- 1. Welcome (first-run) -------------------------------------------------
function Show-Welcome {
    Blank
    # Figlet — только first-run и только при cols >= 72 (порог логотипа,
    # независимый от плотности: плотность влияет на recap и статус).
    if ($script:W -lt 72) {
        Out-Line ('  ' + (T Accent '◆ KIBBORG') + (T Muted '  v1.0.0'))
    }
    else {
        Write-Figlet
        $bandY = -1
        try { $bandY = [Console]::CursorTop } catch { $bandY = -1 }
        Out-Line ('  ' + (Format-Band 0) + '     ' + (T Muted 'v1.0.0'))
        if ($script:Animated -and $bandY -ge 0) {
            for ($f = 1; $f -le 14; $f++) {
                if (-not (Set-LineAt $bandY ('  ' + (Format-Band ($f * 0.30) 24) + '     ' + (T Muted 'v1.0.0')))) { break }
                Start-Sleep -Milliseconds 60
            }
        }
    }
    Blank
    Out-Line ('  ' + (T Text '~/Projects/my-app') + '   ' + (T Warn 'main*') + ' ' + (T Success '+12') + ' ' + (T Error '~4') + '   ' + (T Text 'DeepSeek V4 Flash') + '   ' + (T Accent 'Agent'))
    Blank
    Out-Line ('  ' + (T Muted 'Recent'))
    $recapW = (Get-InnerWidth) - 20
    Out-Line ('    ' + (T Muted '2h') + '  ' + (PadR ((T Text 'Auth guard + JWT refresh') + (T Muted ' · pending tests')) $recapW) + (T Subtle '8f31'))
    Out-Line ('    ' + (T Muted '1d') + '  ' + (PadR ((T Text 'Repo scan') + (T Muted ' · 4 findings in src/auth')) $recapW) + (T Subtle 'a91c'))
    Out-Line ('    ' + (T Muted '3d') + '  ' + (PadR ((T Text 'Worktree feat/payments') + (T Muted ' · plan accepted')) $recapW) + (T Subtle 'c0e2'))
    Blank
    Out-Line ('  ' + (T Accent '[enter]') + '  ' + (T Text 'New session'))
    Out-Line ('  ' + (T Accent '[f3]') + '     ' + (T Text 'Resume picker'))
    Out-Line ('  ' + (T Accent '[ctrl+w]') + ' ' + (T Text 'Isolated worktree'))
    Out-Line ('  ' + (T Accent '[ctrl+p]') + ' ' + (T Text 'Command palette'))

    Blank
    Out-Line ('  ' + (T Warn 'tip') + '  ' + (T Muted 'Shift+Tab cycles Ask → Plan → Agent → YOLO'))
    Blank
}

# --- 2. Compact header ------------------------------------------------------
function Show-Compact {
    Blank
    Out-Line ('  ' + (T Accent '◆ KIBBORG') + '  ' + (T Muted 'v1.0.0') + '    ' + (T Text '~/Projects/my-app') + '    ' + (T Warn 'main*') + '    ' + (T Text 'DeepSeek V4 Flash'))
    Out-Line ('  ' + (T Subtle ('─' * ((Get-InnerWidth) - 6))))
    Out-Line ('  ' + (T Muted 'Recent') + '   ' + (T Muted '2h') + '  ' + (T Text 'Auth guard + JWT refresh') + '    ' + (T Subtle '8f31') + ' ' + (T Accent '↵'))
    Blank
}

# --- 3. Session -------------------------------------------------------------
function Show-Session {
    Show-Header -Title 'Session · inline-режим (дефолт)'
    $sR = (T Accent 'Agent') + (T Muted ' · ') + (T Text 'write')
    $sL = '  ' + (T Accent '◆') + ' ' + (T Muted '8f31') + '  ' + (T Text 'Auth guard') + (T Muted ' · ') + (T Text '~/Projects/my-app')
    Out-Line ((PadR $sL ((Get-InnerWidth) - (VLen $sR))) + $sR)
    Blank
    Out-Line ('  ' + (T Muted 'You'))
    Out-Line ('  ' + (T Text 'проанализируй этот проект и найди проблемы'))
    Blank
    Out-Line ('  ' + (Format-Spin '✳' 'Scanning' '4.2s   esc interrupt   12.4k tok'))
    Blank
    Out-Line ('    ' + (T Success '✓') + '  ' + (T Muted 'read') + '     ' + (T Text 'README.md'))
    Out-Line ('    ' + (T Success '✓') + '  ' + (T Muted 'read') + '     ' + (T Text 'package.json'))
    Out-Line ('    ' + (T Accent '⚙') + '  ' + (T Muted 'search') + '   ' + (T Text 'src/**  auth'))
    Out-Line ('       ' + (T Subtle '⎿') + '  ' + (T Muted '14 files · 3 matches in src/auth/jwt.ts'))
    Out-Line ('    ' + (T Success '✓') + '  ' + (T Muted 'read') + '     ' + (T Text 'src/auth/jwt.ts'))
    Blank
    Out-Line ('  ' + (T Warn 'Planning'))
    Out-Line ('    ' + (T Text '1. Inspect project'))
    Out-Line ('    ' + (T Text '2. Read project manifest'))
    Out-Line ('    ' + (T Text '3. Scan source') + '  ' + (T Accent '←'))
    Out-Line ('    ' + (T Text '4. Report findings'))
    Out-Line ('    ' + (T Accent '[e]') + ' ' + (T Muted 'edit plan') + '   ' + (T Accent '[enter]') + ' ' + (T Muted 'execute') + '   ' + (T Accent '[esc]') + ' ' + (T Muted 'discard'))
    Blank
    Composer
    Status-Line
    Blank
}

# --- slash-палитра (общая для слайда и overlay) -----------------------------
function Highlight-Match {
    param([string]$Text, [string]$Query)
    if (-not $Query) { return (T Text $Text) }
    $idx = $Text.IndexOf($Query, [System.StringComparison]::OrdinalIgnoreCase)
    if ($idx -lt 0) { return (T Text $Text) }
    $head = $Text.Substring(0, $idx)
    $hit = $Text.Substring($idx, $Query.Length)
    $tail = $Text.Substring($idx + $Query.Length)
    return (T Text $head) + (T Accent $hit) + (T Text $tail)
}

function Get-PaletteItems {
    @(
        @{ Group = 'SESSION'; Name = '/new'; Desc = 'clear + fresh'; Key = 'ctrl+n' },
        @{ Group = 'SESSION'; Name = '/resume'; Desc = 'session picker'; Key = 'f3' },
        @{ Group = 'SESSION'; Name = '/fork'; Desc = 'branch this session'; Key = '' },
        @{ Group = 'SESSION'; Name = '/compact'; Desc = 'squeeze context'; Key = '' },
        @{ Group = 'MODEL'; Name = '/model'; Desc = 'switch model'; Key = 'ctrl+m' },
        @{ Group = 'MODEL'; Name = '/effort'; Desc = 'reasoning depth'; Key = '' },
        @{ Group = 'MODE'; Name = '/plan'; Desc = 'plan-only, no writes'; Key = 's-tab' },
        @{ Group = 'MODE'; Name = '/ask'; Desc = 'read-only'; Key = '' },
        @{ Group = 'MODE'; Name = '/yolo'; Desc = 'always-approve'; Key = '' },
        @{ Group = 'PROJECT'; Name = '/init'; Desc = 'write KIBBORG.md'; Key = '' },
        @{ Group = 'PROJECT'; Name = '/diff'; Desc = 'unstaged + session edits'; Key = '' }
    )
}

# Fuzzy-совпадение подпоследовательностью: 'mo' → /model, 'rsm' → /resume.
function Test-FuzzyMatch {
    param([string]$Text, [string]$Query)
    if (-not $Query) { return $true }
    $ti = 0
    foreach ($qc in $Query.ToCharArray()) {
        $found = $false
        while ($ti -lt $Text.Length) {
            if ([char]::ToLowerInvariant($Text[$ti]) -eq [char]::ToLowerInvariant($qc)) { $found = $true; $ti++; break }
            $ti++
        }
        if (-not $found) { return $false }
    }
    return $true
}

function Filter-Palette {
    param([string]$Query)
    $q = ''
    if ($Query) { $q = $Query.Trim().TrimStart('/') }
    $items = Get-PaletteItems
    if (-not $q) { return @($items) }
    $ql = $q.ToLowerInvariant()
    return @($items | Where-Object { (Test-FuzzyMatch $_.Name $q) -or ($_.Desc.ToLowerInvariant().Contains($ql)) })
}

# Состояние палитры: строки виджета, отфильтрованные пункты и индекс выбора.
function Get-PaletteState {
    param([string]$Query = '', [int]$Selected = 0)
    $items = @(Filter-Palette $Query)
    $idx = -1
    if ($items.Count -gt 0) { $idx = ((($Selected % $items.Count) + $items.Count) % $items.Count) }
    $q = ''
    if ($Query) { $q = $Query.Trim().TrimStart('/') }
    $lines = @()
    $lastGroup = ''
    $i = 0
    foreach ($it in $items) {
        if ($it.Group -ne $lastGroup) {
            if ($i -gt 0) { $lines += '' }
            $lastGroup = $it.Group
            $lines += ('   ' + (T Muted $it.Group))
        }
        $on = ($i -eq $idx)
        $mark = if ($on) { T Accent '▸' } else { ' ' }
        $name = PadR (Highlight-Match $it.Name $q) 12
        $desc = PadR (T Muted $it.Desc) 26
        $key = ''
        if ($it.Key) { $key = PadL (T Muted $it.Key) 8 }
        $lines += ($mark + ' ' + $name + $desc + $key)
        $i++
    }
    if ($items.Count -eq 0) { $lines += ('   ' + (T Muted 'нет совпадений')) }
    return [pscustomobject]@{ Lines = $lines; Items = $items; Index = $idx }
}

function Get-PaletteLines {
    param([string]$Query = '', [int]$Selected = 0, [switch]$Framed)
    $st = Get-PaletteState -Query $Query -Selected $Selected
    $lines = @()
    if ($Framed) { $lines += (BoxTop -Label 'commands') }
    $lines += $st.Lines
    if ($Framed) { $lines += (BoxBot) }
    return $lines
}

# --- 4. Slash-палитра -------------------------------------------------------
function Show-Palette {
    Show-Header -Title 'Slash-палитра · fuzzy, группы, preview'
    Out-Line ('  ' + (T Text '/mo') + (T Accent '█'))
    foreach ($l in (Get-PaletteLines -Query 'mo' -Selected 0 -Framed)) { Out-Line ('  ' + $l) }
    Out-Line ('    ' + (T Text '/model [name]') + '   ' + (T Muted 'DeepSeek V4 Flash · local · 128k'))
    Blank
}

# --- 5. Permission ----------------------------------------------------------
function Show-Permission {
    Show-Header -Title 'Permission · цвет рамки = тип действия'
    Out-Line ('  ' + (BoxTop -Label 'Allow Edit  src/auth/jwt.ts' -Color 'Accent'))
    Out-Line ('  ' + (BoxLine ((T Success '+ verifyRefresh()'))))
    Out-Line ('  ' + (BoxLine ((T Success '+ rotate tokens on 401'))))
    Out-Line ('  ' + (BoxLine ''))
    Out-Line ('  ' + (BoxLine ((T Accent '[y] once') + '   ' + (T Accent '[a] always session') + '   ' + (T Error '[n] deny') + '   ' + (T Muted '[esc]'))))
    Out-Line ('  ' + (BoxBot -Color 'Accent'))
    Blank
    Out-Line ('  ' + (BoxTop -Label 'Allow Bash  npm run build' -Color 'Bash'))
    Out-Line ('  ' + (BoxLine ((T Text 'npm run build') + (T Muted '   ← shell-инструмент, один «чужой» цвет'))))
    Out-Line ('  ' + (BoxLine ((T Bash '[y] once') + '   ' + (T Bash '[a] always session') + '   ' + (T Error '[n] deny') + '   ' + (T Muted '[esc]'))))
    Out-Line ('  ' + (BoxBot -Color 'Bash'))
    Blank
    Out-Line ('  ' + (BoxTop -Label 'Allow Bash  git push --force origin main' -Color 'Error'))
    Out-Line ('  ' + (BoxLine ((T Error 'destructive-действие: фокус по умолчанию на [n]'))))
    Out-Line ('  ' + (BoxLine ((T Muted '[y] once') + '   ' + (T Muted '[a] always session') + '   ' + (T Error '[n] deny') + '  ' + (T Accent '← фокус') + '   ' + (T Muted '[esc]'))))
    Out-Line ('  ' + (BoxBot -Color 'Error'))
    Blank
    Blank
}

# --- 6. Question ------------------------------------------------------------
function Show-Question {
    Show-Header -Title 'Question · single/multi-select + custom'
    Out-Line ('  ' + (BoxTop -Label 'Question  1/2' -Color 'Perm'))
    Out-Line ('  ' + (BoxLine ((T Text 'Какой объём ревью нужен?'))))
    Out-Line ('  ' + (BoxLine ((T Accent '▸') + ' ' + (T Text 'only src/auth'))))
    Out-Line ('  ' + (BoxLine ('  ' + (T Text 'весь src'))))
    Out-Line ('  ' + (BoxLine ('  ' + (T Text 'весь репозиторий'))))
    Out-Line ('  ' + (BoxLine ((T Muted 'other… > ') + (T Accent '_'))))
    Out-Line ('  ' + (BoxLine ''))
    Out-Line ('  ' + (BoxLine ((T Muted '[↑↓] выбрать   [space] отметить   [enter] подтвердить'))))
    Out-Line ('  ' + (BoxBot -Color 'Perm'))
    Blank
}

# --- 7. Plan review ---------------------------------------------------------
function Show-Plan {
    Show-Header -Title 'Plan review · правки кода запрещены до approve'
    Out-Line ('  ' + (BoxTop -Label 'Plan review' -Color 'Perm'))
    Out-Line ('  ' + (BoxLine ((T Text '1. Inspect project structure'))))
    Out-Line ('  ' + (BoxLine ((T Text '2. Read manifests and entrypoints'))))
    Out-Line ('  ' + (BoxLine ((T Text '3. Scan src/ for auth flow regressions'))))
    Out-Line ('  ' + (BoxLine ((T Text '4. Report findings with evidence'))))
    Out-Line ('  ' + (BoxLine ''))
    Out-Line ('  ' + (BoxLine ((T Accent '[e]') + ' ' + (T Text 'edit') + '   ' + (T Accent '[enter]') + ' ' + (T Text 'approve & execute') + '   ' + (T Error '[esc]') + ' ' + (T Text 'reject'))))
    Out-Line ('  ' + (BoxBot -Color 'Perm'))
    Blank
}

# --- 8. Resume picker -------------------------------------------------------
function Show-Resume {
    Show-Header -Title 'Resume picker · recap, git, модель, режим'
    Out-Line ('  ' + (T Text 'Resume session') + (PadL (T Muted '/resume') ((Get-InnerWidth) - 22)))
    Out-Line ('  ' + (BoxTop))
    Out-Line ('  ' + (BoxLine ((T Accent '▸') + ' ' + (T Text '8f31') + '  ' + (T Muted '2h') + '   ' + (T Text 'Auth guard + JWT refresh'))))
    Out-Line ('  ' + (BoxLine ('       ' + (T Warn 'main*') + '  ' + (T Accent 'Agent') + '  ' + (T Muted 'DeepSeek V4') + '  ' + (T Success '+18') + (T Error '/-4') + '  ' + (T Muted 'pending tests'))))
    Out-Line ('  ' + (BoxLine ('    ' + (T Text 'a91c') + '  ' + (T Muted '1d') + '   ' + (T Text 'Repo scan · 4 findings'))))
    Out-Line ('  ' + (BoxLine ('       ' + (T Muted 'main') + '   ' + (T Warn 'Plan') + '    ' + (T Muted 'DeepSeek V4') + '  ' + (T Success 'clean'))))
    Out-Line ('  ' + (BoxLine ('    ' + (T Text 'c0e2') + '  ' + (T Muted '3d') + '   ' + (T Text 'feat/payments worktree'))))
    Out-Line ('  ' + (BoxLine ('       ' + (T Muted 'wt') + '     ' + (T Accent 'Agent') + '   ' + (T Muted 'DeepSeek V3') + '  ' + (T Warn 'dirty 3 files'))))
    Out-Line ('  ' + (BoxBot))
    Out-Line ('  ' + (T Muted 'enter resume   ctrl+f fork   d delete   / find'))
    Blank
}

# --- 9. Модал с табами ------------------------------------------------------
function Show-Modal {
    Show-Header -Title 'Один модал на все расширения (K4.7)'
    $w = (Get-InnerWidth) - 6
    $tabs = (T Accent '[Skills]') + ' ' + (T Muted 'MCP') + ' ' + (T Muted 'Hooks') + ' ' + (T Muted 'Plugins') + ' ' + (T Muted 'Permissions')
    $l = ' Kibborg ─ '
    $fill = $w - 3 - (VLen $l) - (VLen $tabs)
    if ($fill -lt 1) { $fill = 1 }
    Out-Line ('  ' + (T Subtle '┌') + (T Muted $l) + $tabs + ' ' + (T Subtle ('─' * $fill)) + (T Subtle '┐'))
    $rows = @(
        ('  ' + (T Success '✓') + ' security-review        ' + (T Muted 'model-invocable   v3')),
        ('  ' + (T Success '✓') + ' graphify               ' + (T Muted 'user-invocable    v5')),
        ('  ' + (T Muted '·') + ' tunerpro-xdf-engineer  ' + (T Muted 'manual            v2')),
        '',
        ((T Muted '[enter] открыть  [space] enable/disable  [v] версии')),
        ((T Muted '[b] benchmark    [t] в корзину          [esc] выход'))
    )
    foreach ($r in $rows) {
        Out-Line ('  ' + (T Subtle '│') + (PadR (' ' + $r) ($w - 2)) + (T Subtle '│'))
    }
    Out-Line ('  ' + (T Subtle ('└' + ('─' * ($w - 2)) + '┘')))
    Blank
}

# --- 10. Плотности статус-строки -------------------------------------------
function Show-Status {
    Show-Header -Title 'Статус-строка · состав по ширине'
    $variants = @(
        @{ D = 'rich'; Cols = 120; Note = 'cols ≥ 110 — полный состав, включая стоимость' },
        @{ D = 'wide'; Cols = 96; Note = '96 ≤ cols < 110 — без стоимости' },
        @{ D = 'compact'; Cols = 84; Note = '80 ≤ cols < 88 — без git, turn остаётся' },
        @{ D = 'narrow'; Cols = 74; Note = '72 ≤ cols < 80 — только ctx, полоса и режим' },
        @{ D = 'minimal'; Cols = 64; Note = 'cols < 72 — полоса тоже выброшена' }
    )
    foreach ($v in $variants) {
        Out-Line ('  ' + (T Muted (PadR $v.D 10)) + (T Muted $v.Note))
        Out-Line (Status-Text -Pct 47 -Mode 'Agent' -Cols $v.Cols)
        Blank
    }
    Out-Line ('  ' + (T Muted 'ctx 18%  ') + (Bar10 18) + (T Muted '   ctx 47%  ') + (Bar10 47) + (T Muted '   ctx 86%  ') + (Bar10 86))
    Blank
    Out-Line ('  ' + (T Muted 'Footer завершённого хода (K2.6):'))
    Out-Line ('  ' + (T Success '✓') + '  ' + (T Text '14.1k tok') + (T Subtle ' · ') + (T Muted '$0.07') + (T Subtle ' · ') + (T Muted '18.4s') + (T Subtle ' · ') + (T Muted '6 tools') + (T Subtle ' · ') + (T Success '+82') + (T Error '/-11'))
    Blank
}

# --- 11. Fullscreen ---------------------------------------------------------
function Show-Fullscreen {
    Show-Header -Title 'Fullscreen (K7, --fullscreen) · панели, alt-screen, ресайз'
    $inner = (Get-InnerWidth)
    $c1 = [Math]::Max(12, [Math]::Floor($inner * 0.22))
    $c3 = [Math]::Max(12, [Math]::Floor($inner * 0.22))
    $c2 = $inner - $c1 - $c3 - 4
    Out-Line ('  ' + (T Subtle ('┌' + ('─' * ($c1 + 2)) + '┬' + ('─' * ($c2 + 2)) + '┬' + ('─' * ($c3 + 2)) + '┐')))
    Out-Line ('  ' + (T Subtle '│') + (' ' + (PadR ((T Muted 'Sessions')) $c1) + (T Subtle '│') + ' ' + (PadR ((T Muted 'Conversation')) $c2) + (T Subtle '│') + ' ' + (PadR ((T Muted 'Context')) $c3) + ' ') + (T Subtle '│'))
    $rows = @(
        @('▸ 8f31 Auth', 'You: проанализируй проект', 'system 6%'),
        @('  a91c Scan', '✳ Scanning… 4.2s  12.4k tok', 'tools 9%'),
        @('  c0e2 Pay', '  ✓ read README.md', 'chat 3%'),
        @('', '  ⚙ search src/** auth', '────────'),
        @('', '      ⎿ 3 matches in jwt.ts', '18%')
    )
    foreach ($r in $rows) {
        $a = if ($r[0] -like '▸*') { T Accent $r[0] } else { T Text $r[0] }
        Out-Line ('  ' + (T Subtle '│') + (' ' + (PadR $a $c1) + (T Subtle '│') + ' ' + (PadR ((T Text $r[1])) $c2) + (T Subtle '│') + ' ' + (PadR ((T Muted $r[2])) $c3) + ' ') + (T Subtle '│'))
    }
    Out-Line ('  ' + (T Subtle ('├' + ('─' * ($c1 + 2)) + '┴' + ('─' * ($c2 + 2)) + '┴' + ('─' * ($c3 + 2)) + '┤')))
    $tbL = (T Muted 'Tasks │ Jobs │ Goals │ Files │ Diff │ Queue')
    $tbR = (T Muted 'ctrl+o детали')
    $tabsBar = ' ' + $tbL + (' ' * [Math]::Max(1, ($inner - 3) - (VLen $tbL) - (VLen $tbR))) + $tbR
    Out-Line ('  ' + (T Subtle '│') + (PadR $tabsBar ($inner + 2)) + (T Subtle '│'))
    Out-Line ('  ' + (T Subtle ('└' + ('─' * ($inner + 2)) + '┘')))
    Blank
    Status-Line
    Blank
}

# --- 12. Headless / CI ------------------------------------------------------
function Show-Headless {
    Show-Header -Title 'Вне TUI · headless/CI (K5)'
    Out-Line ('  ' + (T Muted '$ ') + (T Text 'kibborg -p "describe the repo" --output-format json'))
    Out-Line ('  ' + (T Success '{"type":"result","subtype":"success","duration_ms":18420,"num_turns":6,'))
    Out-Line ('  ' + (T Success ' "result":"Репозиторий — плагинный агентный харнесс...","session_id":"8f31...",'))
    Out-Line ('  ' + (T Success ' "total_cost_usd":0.07,"is_error":false}'))
    Blank
    Out-Line ('  ' + (T Muted '$ ') + (T Text 'kibborg -p "..." --fail-on-question'))
    Out-Line ('  ' + (T Muted '$ ') + (T Text 'echo $?') + '   ' + (T Error '3') + (T Muted '   # нужен интерактивный ответ, промптов нет'))
    Blank
    Out-Line ('  ' + (T Muted 'Exit-коды:'))
    Out-Line ('    ' + (T Success '0') + '    ' + (T Text 'успех'))
    Out-Line ('    ' + (T Error '1') + '    ' + (T Text 'сбой задачи/инструмента'))
    Out-Line ('    ' + (T Warn '2') + '    ' + (T Text 'конфигурация, окружение или ключ'))
    Out-Line ('    ' + (T Warn '3') + '    ' + (T Text 'требуется интерактивное решение'))
    Out-Line ('    ' + (T Error '130') + '  ' + (T Text 'прервано пользователем (SIGINT)'))
    Blank
}

# --- 13. Карта slash-команд -------------------------------------------------
function Show-SlashMap {
    Show-Header -Title 'Карта slash-команд v1 (UI.md §6)'
    $groups = [ordered]@{
        'SESSION' = '/new /resume /sessions /fork /rename /home /quit'
        'CONTEXT' = '/compact /context /rewind /export /copy /find /transcript'
        'MODE'    = '/plan /ask /agent /yolo /always-approve /permissions'
        'MODEL'   = '/model /effort /status'
        'PROJECT' = '/init /memory /diff /review /add-dir /worktree'
        'SYS'     = '/doctor /usage /theme /config /help /tasks /goal'
        'EXT'     = '/mcp /skills /hooks /plugins'
        'GIT'     = '/commit (skill), /worktree'
    }
    foreach ($k in $groups.Keys) {
        Out-Line ('  ' + (T Accent (PadR $k 10)) + (T Text $groups[$k]))
    }
    Blank
    Out-Line ('  ' + (T Muted 'Клавиши:'))
    Out-Line ('    ' + (T Text 'Shift+Tab') + (T Muted ' цикл режимов   ') + (T Text 'Esc') + (T Muted ' снять overlay   ') + (T Text 'Ctrl+C') + (T Muted ' очистить ввод / прервать'))
    Out-Line ('    ' + (T Text '/ @ #') + (T Muted ' автодополнение команд, файлов, сессий   ') + (T Text 'Ctrl+R') + (T Muted ' история'))
    Out-Line ('    ' + (T Text 'Ctrl+X') + (T Muted ' лидер-клавиша (fullscreen)   ') + (T Text 'Ctrl+O') + (T Muted ' детали узла   ') + (T Text 'Ctrl+Q') + (T Muted ' выход'))
    Blank
}

# --- 14. Live-кадр ----------------------------------------------------------
# Один живой кадр вместо слайда: нижняя зона (composer + overlay + статус)
# перерисовывается на месте, лента допечатывается вверх, режим меняется
# на ходу, Esc снимает overlay и не убивает процесс.
$script:Modes = @(
    @{ Name = 'Ask'; Write = 'read-only'; Hint = 'чтение без записи' },
    @{ Name = 'Plan'; Write = 'plan-only'; Hint = 'правки кода после approve' },
    @{ Name = 'Agent'; Write = 'write'; Hint = 'запись и shell с подтверждением' },
    @{ Name = 'YOLO'; Write = 'write+shell'; Hint = 'без подтверждений (worktree)' }
)

function Show-Live {
    if ($script:CaptureMode) { Show-LiveScripted; return }
    Sync-Geometry
    $interactive = $true
    try { $null = [Console]::KeyAvailable } catch { $interactive = $false }
    if ([Console]::IsInputRedirected) { $interactive = $false }
    if (-not $interactive) { Show-LiveScripted; return }
    Start-LiveInteractive
}

# Сценарный прогон того же кадра (CI/пайп): та же геометрия и нижняя зона,
# но без ввода — фиксированная последовательность состояний.
function Show-LiveScripted {
    Blank
    Out-Line ('  ' + (T Muted '[live] сценарный прогон зоны (ввод недоступен — не TTY)'))
    Blank
    $sR = (T Accent 'Agent') + (T Muted ' · ') + (T Text 'write')
    $sL = '  ' + (T Accent '◆') + ' ' + (T Muted '8f31') + '  ' + (T Text 'Auth guard') + (T Muted ' · ') + (T Text '~/Projects/my-app')
    Out-Line ((PadR $sL ((Get-InnerWidth) - (VLen $sR))) + $sR)
    Blank
    Out-Line ('  ' + (T Muted 'You') + (T Muted '   · demo replay: текст не уходит в LLM'))
    Out-Line ('  ' + (T Text 'проанализируй auth и покажи проблемы'))
    Out-Line ('  ' + (Format-Spin '✳' 'Scanning' '1.2s   4.1k tok'))
    Out-Line ('    ' + (T Success '✓') + '  ' + (T Muted 'read') + '     ' + (T Text 'src/auth/jwt.ts'))
    Out-Line ('       ' + (T Subtle '⎿') + '  ' + (T Muted '1 file · 214 lines'))
    Out-Line ('    ' + (T Accent '⚙') + '  ' + (T Muted 'search') + '   ' + (T Text 'verifyRefresh'))
    Out-Line ('       ' + (T Subtle '⎿') + '  ' + (T Muted '3 matches in src/auth/jwt.ts'))
    Blank
    Out-Line ('  ' + (T Warn 'Planning'))
    Out-Line ('    ' + (T Text '1. Inspect project') + '   ' + (T Success '✓'))
    Out-Line ('    ' + (T Text '2. Read manifests') + '   ' + (T Success '✓'))
    Out-Line ('    ' + (T Text '3. Scan auth flow') + '  ' + (T Accent '←'))
    Blank
    Out-Line ('  ' + (T Text '/mo') + (T Accent '█'))
    foreach ($l in (Get-PaletteLines -Query 'mo' -Selected 0)) { Out-Line ('  ' + (T Subtle '│') + ' ' + $l) }
    Blank
    foreach ($l in (Composer-Block -Draft 'запусти тесты' -ShowHint)) { Out-Line $l }
    Out-Line (Status-Text -Pct 24 -Mode 'YOLO' -Turn '6.8s')
    Blank
    Out-Line ('  ' + (T Muted 'Длинный ввод не переносится: видна хвостовая часть, курсор остаётся в строке'))
    foreach ($l in (Composer-Block -Draft 'проанализируй все модули src/auth, собери проблемы и напиши отчёт с примерами кода' -ShowHint)) { Out-Line $l }
    Blank
    Out-Line ('  ' + (T Muted 'Контракт зоны: ') + (T Text 'Esc = overlay → plan-review → ход → ввод (выхода нет); выход = Ctrl+Q/Ctrl+D; Ctrl+C = ввод → ход → выход; Shift+Tab = режимы; / = палитра; Enter = ввод либо пункт'))
    Out-Line ('  ' + (T Muted 'Геометрия: ') + (T Text "$($script:W) cols") + (T Muted ' · inner ') + (T Text "$(Get-InnerWidth)") + (T Muted ' · offset курсора считается из префикса composer.'))
    Blank
}

function Start-LiveInteractive {
    Blank
    Out-Line ('  ' + (T Accent '◆ KIBBORG') + (T Muted '  v1.0.0') + '    ' + (T Text '~/Projects/my-app') + '    ' + (T Warn 'main*') + '    ' + (T Muted "live-кадр · $($script:W) cols"))
    Blank

    $draft = ''
    $modeIdx = 2
    $pct = 12
    $turn = 0
    $paletteOpen = $false
    $paletteSel = 0
    $script:LiveLog = @()
    $script:ZoneTop = [Console]::CursorTop
    $script:ZoneHeight = 4

    $script:LiveSteps = @(
        @(
            @{ Kind = 'you'; Text = 'проанализируй auth и покажи проблемы' },
            @{ Kind = 'spin'; Verb = 'Scanning'; Meta = '1.2s   4.1k tok' },
            @{ Kind = 'tool'; Mark = '✓'; Color = 'Success'; Name = 'read'; Arg = 'src/auth/jwt.ts' },
            @{ Kind = 'note'; Text = '1 file · 214 lines' },
            @{ Kind = 'tool'; Mark = '⚙'; Color = 'Accent'; Name = 'search'; Arg = 'verifyRefresh' },
            @{ Kind = 'note'; Text = '3 matches in src/auth/jwt.ts' },
            @{ Kind = 'plan'; Items = @('Inspect project', 'Read manifests', 'Scan auth flow') },
            @{ Kind = 'answer'; Text = 'Нашла 2 проблемы: refresh-токен не ротируется, verifyRefresh не проверяет exp.' },
            @{ Kind = 'footer'; Tok = '12.4k tok'; Cost = '$0.05'; Time = '7.1s'; Tools = '4 tools'; Diff = '+38/-6' }
        ),
        @(
            @{ Kind = 'you'; Text = 'покажи diff по jwt.ts' },
            @{ Kind = 'spin'; Verb = 'Reading'; Meta = '0.6s   1.1k tok' },
            @{ Kind = 'tool'; Mark = '✓'; Color = 'Success'; Name = 'read'; Arg = 'src/auth/jwt.ts' },
            @{ Kind = 'diff'; Add = '+ verifyRefresh()'; Del = '- // TODO refresh' },
            @{ Kind = 'answer'; Text = 'Готово: ротация токена добавлена, TODO убран.' },
            @{ Kind = 'footer'; Tok = '9.8k tok'; Cost = '$0.03'; Time = '4.2s'; Tools = '2 tools'; Diff = '+12/-2' }
        )
    )

    # --- зона как виджет известной высоты -----------------------------------
    # Позиция зоны — это CursorTop после печати ленты, высота — ZoneHeight.
    # Координаты не передаются вручную: любой сдвиг курсора самокорректируется.

    function Clear-Rows {
        param([int]$From, [int]$To)
        for ($y = $From; $y -le $To; $y++) { $null = Set-LineAt $y '' }
    }

    function Clear-Zone {
        Clear-Rows $script:ZoneTop ($script:ZoneTop + $script:ZoneHeight - 1)
        try { [Console]::SetCursorPosition(0, $script:ZoneTop) } catch { }
    }

    function Write-LogLines {
        param([string[]]$Lines)
        foreach ($l in $Lines) {
            [Console]::Out.Write($l + "$script:Esc[0K")
            [Console]::Out.WriteLine('')
            $script:LiveLog += $l
        }
        $script:ZoneTop = [Console]::CursorTop
    }

    # Лента печатается поверх прежней зоны; хвост старой зоны стирается.
    function Push-Log {
        param([string[]]$Lines)
        $oldBottom = $script:ZoneTop + $script:ZoneHeight - 1
        Clear-Zone
        Write-LogLines $Lines
        if ($script:ZoneTop -le $oldBottom) {
            Clear-Rows $script:ZoneTop $oldBottom
            try { [Console]::SetCursorPosition(0, $script:ZoneTop) } catch { }
        }
    }

    function Draw-Zone {
        $mode = $script:Modes[$modeIdx]
        $lines = @()
        $overlayRows = 0
        if ($paletteOpen) {
            $st = Get-PaletteState -Query $draft -Selected $paletteSel
            $lines += ('  ' + (T Text $draft) + (T Accent '█') + (T Muted '   фильтр от ввода · вверх/вниз выбрать · enter вставить'))
            foreach ($l in $st.Lines) { $lines += ('  ' + (T Subtle '│') + ' ' + $l) }
            $overlayRows = 1 + $st.Lines.Count
        }
        $lines += (Composer-Block -Draft $draft -ShowHint)
        $lines += (Status-Text -Pct $pct -Mode $mode.Name -Turn '0.0s')
        $top = [Console]::CursorTop
        $script:ZoneTop = $top
        $i = 0
        foreach ($l in $lines) {
            $null = Set-LineAt ($top + $i) $l
            $i++
        }
        $script:ZoneHeight = $lines.Count
        $col = (Get-ComposerInputOffset) + (Get-DisplayWidth (Get-ComposerView $draft).Text)
        try { [Console]::SetCursorPosition($col, ($top + $overlayRows + 1)) } catch { }
    }

    # Ожидание клавиши с поллингом ширины: resize применяется без нажатия.
    function Wait-Key-Or-Resize {
        while ($true) {
            try { if ([Console]::KeyAvailable) { return [Console]::ReadKey($true) } } catch { return $null }
            if ((Get-ConsoleWidth) -ne $script:W) { return $null }
            Start-Sleep -Milliseconds 120
        }
    }

    Out-Line ('  ' + (T Accent '◆') + ' ' + (T Muted '8f31') + '  ' + (T Text 'Auth guard') + (T Muted ' · ') + (T Text '~/Projects/my-app'))
    Blank
    Draw-Zone

    $ctrlC = 0
    $quit = $false
    while (-not $quit) {
        $key = Wait-Key-Or-Resize
        if ($null -eq $key) {
            if ((Get-ConsoleWidth) -ne $script:W) {
                Sync-Geometry
                Clear-Zone
                Draw-Zone
                continue
            }
            break
        }
        $ch = [string]$key.KeyChar
        $kk = [string]$key.Key
        $shift = ($key.Modifiers -band [ConsoleModifiers]::Shift) -ne 0
        $ctrl = ($key.Modifiers -band [ConsoleModifiers]::Control) -ne 0

        if ($ctrl -and $ch -eq 'q') { $quit = $true; break }

        if ($kk -eq 'Tab' -and $shift) {
            $modeIdx = ($modeIdx + 1) % $script:Modes.Count
            $mode = $script:Modes[$modeIdx]
            Clear-Zone
            Push-Log @('  ' + (T Muted 'Shift+Tab → режим ') + (T Accent $mode.Name) + (T Muted " ($($mode.Write) — $($mode.Hint))"))
            Draw-Zone
            continue
        }
        if ($kk -eq 'Tab') {
            if ($paletteOpen) { $paletteSel++; Clear-Zone; Draw-Zone }
            continue
        }
        if ($kk -eq 'UpArrow') {
            if ($paletteOpen) { $paletteSel--; Clear-Zone; Draw-Zone }
            continue
        }
        if ($kk -eq 'DownArrow') {
            if ($paletteOpen) { $paletteSel++; Clear-Zone; Draw-Zone }
            continue
        }
        if ($kk -eq 'Escape') {
            if ($paletteOpen) {
                $paletteOpen = $false
                $paletteSel = 0
                Clear-Zone
                Push-Log @('  ' + (T Muted 'Esc → overlay снят, процесс жив'))
                Draw-Zone
            }
            elseif ($draft) {
                $draft = ''
                Clear-Zone
                Draw-Zone
            }
            else {
                Clear-Zone
                Push-Log @('  ' + (T Muted 'Esc: отменять нечего (нет overlay, нет хода, ввод пуст). Выход — Ctrl+Q'))
                Draw-Zone
            }
            continue
        }
        if ($kk -eq 'Backspace') {
            if ($draft.Length -gt 0) { $draft = $draft.Substring(0, $draft.Length - 1) }
            $paletteSel = 0
            $paletteOpen = $draft.StartsWith('/')
            Clear-Zone
            Draw-Zone
            continue
        }
        if ($ctrl) {
            if ([int][char]$ch -eq 4 -and -not $draft) { $quit = $true; break }
            if ($ch -eq 'c' -or [int][char]$ch -eq 3) {
                if ($draft) {
                    $ctrlC = 0
                    $draft = ''
                    $paletteOpen = $false
                    $paletteSel = 0
                    Clear-Zone
                    Push-Log @('  ' + (T Muted 'Ctrl+C → ввод очищен, ход не прерван'))
                    Draw-Zone
                }
                else {
                    $ctrlC++
                    if ($ctrlC -ge 2) { $quit = $true; break }
                    Clear-Zone
                    Push-Log @('  ' + (T Warn 'Ctrl+C при пустом вводе → ещё раз = выход'))
                    Draw-Zone
                }
            }
            continue
        }
        if ($kk -eq 'Enter') {
            if (-not $draft) { continue }
            if ($paletteOpen) {
                $st = Get-PaletteState -Query $draft -Selected $paletteSel
                if ($st.Index -ge 0) {
                    $draft = $st.Items[$st.Index].Name + ' '
                    $paletteOpen = $false
                    $paletteSel = 0
                    Clear-Zone
                    Draw-Zone
                    continue
                }
            }
            $input = $draft
            $draft = ''
            $ctrlC = 0
            $paletteOpen = $false
            $paletteSel = 0
            $step = $script:LiveSteps[$turn % $script:LiveSteps.Count]
            $turn++
            Push-Log @('  ' + (T Muted 'You') + (T Muted '   · demo replay: текст не уходит в LLM'), '  ' + (T Text $input))
            $spinData = $step | Where-Object { $_.Kind -eq 'spin' } | Select-Object -First 1
            if ($spinData) {
                $spinY = [Console]::CursorTop
                Animate-Spin -Y $spinY -Verb $spinData.Verb -Meta $spinData.Meta
                [Console]::Out.WriteLine('')
                $script:ZoneTop = [Console]::CursorTop
            }
            $out = @()
            foreach ($it in $step) {
                switch ($it.Kind) {
                    'tool' { $out += ('    ' + (T $it.Color $it.Mark) + '  ' + (T Muted $it.Name) + '   ' + (T Text $it.Arg)) }
                    'note' { $out += ('       ' + (T Subtle '⎿') + '  ' + (T Muted $it.Text)) }
                    'diff' { $out += ('    ' + (T Success $it.Add)); $out += ('    ' + (T Error $it.Del)) }
                    'plan' {
                        $out += ''
                        $out += ('  ' + (T Warn 'Planning'))
                        $n = 1
                        foreach ($p in $it.Items) { $out += ('    ' + (T Text "$n. $p")); $n++ }
                    }
                    'answer' { $out += ''; $out += ('  ' + (T Text $it.Text)) }
                    'footer' {
                        $out += ('  ' + (T Success '✓') + '  ' + (T Text $it.Tok) + (T Subtle ' · ') + (T Muted $it.Cost) + (T Subtle ' · ') + (T Muted $it.Time) + (T Subtle ' · ') + (T Muted $it.Tools) + (T Subtle ' · ') + (T Success $it.Diff))
                    }
                }
            }
            Push-Log $out
            $pct = [Math]::Min(96, $pct + 9)
            Draw-Zone
            continue
        }
        if ($ch -and [int][char]$ch -ge 32) {
            $draft += $ch
            $paletteSel = 0
            $paletteOpen = $draft.StartsWith('/')
            Clear-Zone
            Draw-Zone
            continue
        }
    }

    try { [Console]::SetCursorPosition(0, $script:ZoneTop + 5) } catch { }
    Blank
    Out-Line ('  ' + (T Muted 'live-кадр завершён: ввод, overlay, режимы и геометрия проверены в этом терминале.'))
    Blank
}

# --- реестр экранов ---------------------------------------------------------
$script:Screens = [ordered]@{
    'welcome'    = @{ Title = 'Welcome (first-run)'; Phase = 'K1/K2'; Fn = { Show-Welcome } }
    'compact'    = @{ Title = 'Compact header'; Phase = 'K1'; Fn = { Show-Compact } }
    'session'    = @{ Title = 'Session: лента, composer, статус'; Phase = 'K1.2/K1.3'; Fn = { Show-Session } }
    'palette'    = @{ Title = 'Slash-палитра (fuzzy-подсветка)'; Phase = 'K4.1/K4.9'; Fn = { Show-Palette } }
    'permission' = @{ Title = 'Permission (3 цвета рамки)'; Phase = 'K3.1'; Fn = { Show-Permission } }
    'question'   = @{ Title = 'Question'; Phase = 'K3.2'; Fn = { Show-Question } }
    'plan'       = @{ Title = 'Plan review'; Phase = 'K3.3'; Fn = { Show-Plan } }
    'resume'     = @{ Title = 'Resume picker'; Phase = 'K2.2'; Fn = { Show-Resume } }
    'modal'      = @{ Title = 'Модал с табами'; Phase = 'K4.7'; Fn = { Show-Modal } }
    'status'     = @{ Title = 'Статус-строка (3 плотности, bar от %)'; Phase = 'K1.3'; Fn = { Show-Status } }
    'fullscreen' = @{ Title = 'Fullscreen: панели (display-width)'; Phase = 'K7.1/K7.2'; Fn = { Show-Fullscreen } }
    'headless'   = @{ Title = 'Headless / CI'; Phase = 'K5'; Fn = { Show-Headless } }
    'slashmap'   = @{ Title = 'Карта slash-команд и клавиш'; Phase = 'K4.1'; Fn = { Show-SlashMap } }
    'live'       = @{ Title = 'LIVE: welcome → session, ввод, /, Shift+Tab, Esc'; Phase = 'K1.4/K3.1/K3.3'; Fn = { Show-Live } }
}
$script:Order = @($script:Screens.Keys)

function Invoke-Screen {
    param([string]$Name, [int]$Index = 0, [int]$Total = 0)
    if ($Total -gt 0) {
        $head = "[$Index/$Total] $Name — $($script:Screens[$Name].Title)  ($($script:Screens[$Name].Phase))"
        Out-Line ('  ' + (T Subtle ('─' * ((Get-InnerWidth) - 4))))
        Out-Line ('  ' + (T Muted $head))
        Out-Line ('  ' + (T Subtle ('─' * ((Get-InnerWidth) - 4))))
    }
    & $script:Screens[$Name].Fn
}

function Show-All {
    for ($i = 0; $i -lt $script:Order.Count; $i++) { Invoke-Screen -Name $script:Order[$i] -Index ($i + 1) -Total $script:Order.Count }
}

function Show-MainMenu {
    param([int]$Sel = -1)
    Blank
    Out-Line ('  ' + (T Accent 'Kibborg') + ' ' + (T Muted '— UI demo (экраны из UI.md)'))
    Out-Line ('  ' + (T Subtle ('─' * ((Get-InnerWidth) - 4))))
    $i = 1
    foreach ($k in $script:Order) {
        $on = (($i - 1) -eq $Sel)
        $pointer = if ($on) { T Accent '▸' } else { ' ' }
        $num = (T Accent ([string]$i).PadLeft(2))
        $title = PadR ($script:Screens[$k].Title) 46
        $ph = $script:Screens[$k].Phase
        $color = if ($on) { 'Accent' } else { 'Text' }
        Out-Line ("  $pointer $num  " + (T $color $title) + (T Muted $ph))
        $i++
    }
    Out-Line ('  ' + (T Subtle ('─' * ((Get-InnerWidth) - 4))))
    Out-Line ('   ' + (T Accent ' l') + '  ' + (T Text 'live-кадр: интерактивная сессия с вводом'))
    Out-Line ('   ' + (T Accent ' a') + '  ' + (T Text 'все слайды подряд'))
    Out-Line ('   ' + (T Accent ' q') + '  ' + (T Text 'выход'))
    Out-Line ('   ' + (T Muted 'ширина: ') + (T Text "$($script:W) cols") + (T Muted ' · inner ') + (T Text "$(Get-InnerWidth)") + (T Muted ' · плотность ') + (T Accent $script:Density))
    Blank
}

function Pause-Back {
    [Console]::Out.Write('  ' + (Kc Muted) + ' любая клавиша — вернуться в меню' + $script:Z)
}

# --- golden: замороженный вывод ---------------------------------------------
# Демо заморожено: `golden` записывает вывод всех слайдов в demo/golden,
# `check` сверяет его и возвращает 1 при расхождении (гейт для CI).
function Get-GoldenPath {
    $dir = $env:KDEMO_DIR
    if (-not $dir) { $dir = (Join-Path (Get-Location) 'demo') }
    $dir = $dir.TrimEnd('\', '/')
    return (Join-Path $dir 'golden\all-plain.txt')
}

function Get-AllPlainText {
    $savedW = $script:W
    $savedInner = $script:Inner
    $savedDensity = $script:Density
    $script:W = 88
    $script:Inner = 84
    $script:Density = 'balanced'
    $script:CaptureMode = $true
    $script:Capture = @()
    Show-All
    $script:CaptureMode = $false
    $script:W = $savedW
    $script:Inner = $savedInner
    $script:Density = $savedDensity
    return @($script:Capture | ForEach-Object { $_.TrimEnd() })
}

function Save-Golden {
    $path = Get-GoldenPath
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { $null = New-Item -ItemType Directory -Path $dir }
    $lines = Get-AllPlainText
    $text = ($lines -join [string][char]10) + [string][char]10
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
    [Console]::Out.WriteLine("golden записан: $path ($($lines.Count) строк)")
}

function Test-Golden {
    $path = Get-GoldenPath
    if (-not (Test-Path $path)) {
        [Console]::Out.WriteLine("golden отсутствует: $path")
        [Console]::Out.WriteLine('создать: kibborg-demo.bat golden')
        return 1
    }
    $raw = [System.IO.File]::ReadAllText($path, (New-Object System.Text.UTF8Encoding($false)))
    $expected = @($raw -split [string][char]10 | ForEach-Object { $_.TrimEnd() })
    if ($expected.Count -gt 0 -and $raw.EndsWith([string][char]10)) {
        if ($expected.Count -eq 1) { $expected = @() }
        else { $expected = @($expected[0..($expected.Count - 2)]) }
    }
    $actual = Get-AllPlainText
    if ($expected.Count -ne $actual.Count) {
        [Console]::Out.WriteLine("golden mismatch: строк ожидалось $($expected.Count), получено $($actual.Count)")
        return 1
    }
    for ($i = 0; $i -lt $actual.Count; $i++) {
        if ($expected[$i] -ne $actual[$i]) {
            [Console]::Out.WriteLine("golden mismatch на строке $($i + 1)")
            [Console]::Out.WriteLine("  ожидалось: $($expected[$i])")
            [Console]::Out.WriteLine("  получено:  $($actual[$i])")
            return 1
        }
    }
    [Console]::Out.WriteLine("golden ok: $($actual.Count) строк совпадают ($path)")
    return 0
}

# --- точка входа ------------------------------------------------------------
$mode = 'menu'
$wanted = @()
$menuOnly = $false
$glSave = $false
$glCheck = $false
foreach ($a in $script:RawArgs) {
    if ($a -match '^--') { continue }
    if ($a -in @('menu', 'list')) { $menuOnly = $true; continue }
    if ($a -eq 'golden') { $glSave = $true; continue }
    if ($a -eq 'check') { $glCheck = $true; continue }
    if ($a -in @('all', 'a')) { $mode = 'all'; continue }
    if ($script:Screens.Contains($a)) { $mode = 'one'; $wanted += $a; continue }
    if ($a -match '^\d+$') {
        $idx = [int]$a
        if ($idx -ge 1 -and $idx -le $script:Order.Count) { $mode = 'one'; $wanted += $script:Order[$idx - 1] }
    }
}

if ($glSave) { Save-Golden; exit 0 }
if ($glCheck) { exit (Test-Golden) }
if ($menuOnly) { Show-MainMenu; exit 0 }
if ($mode -eq 'all') { Show-All; exit 0 }
if ($mode -eq 'one') {
    foreach ($w in $wanted) { Invoke-Screen -Name $w }
    exit 0
}

# Интерактивное меню; при недоступном вводе — показываем все слайды и выходим.
$interactive = $true
try { $null = [Console]::KeyAvailable } catch { $interactive = $false }
if ([Console]::IsInputRedirected) { $interactive = $false }
if (-not $interactive) { Show-All; exit 0 }

$n = $script:Order.Count
$sel = 0
while ($true) {
    if ($script:Plain) { } else { try { Clear-Host } catch { } }
    Show-MainMenu -Sel $sel
    [Console]::Out.Write('  ' + (Kc Muted) + ' ↑↓/jk · enter открыть · l live · a все · q выход' + $script:Z + '   ' + (Kc Accent) + '› ' + $script:Z)
    $key = $null
    try { $key = [Console]::ReadKey($true) } catch { break }
    if ($null -eq $key) { break }
    $ch = [string]$key.KeyChar
    $kk = [string]$key.Key
    if ($ch -eq 'q' -or $kk -eq 'Escape') { break }
    if ($kk -eq 'UpArrow' -or $ch -eq 'k') { $sel = ($sel - 1 + $n) % $n; continue }
    if ($kk -eq 'DownArrow' -or $ch -eq 'j') { $sel = ($sel + 1) % $n; continue }
    if ($kk -eq 'Home' -or $ch -eq 'g') { $sel = 0; continue }
    if ($kk -eq 'End' -or $ch -eq 'G') { $sel = $n - 1; continue }
    if ($ch -eq 'l') {
        Blank
        Show-Live
        Pause-Back
        try { $null = [Console]::ReadKey($true) } catch { break }
        continue
    }
    if ($ch -eq 'a') {
        Blank
        Show-All
        Pause-Back
        try { $null = [Console]::ReadKey($true) } catch { break }
        continue
    }
    $target = -1
    if ($kk -eq 'Enter' -or $ch -eq ' ') { $target = $sel }
    elseif ($ch -match '^[1-9]$') { $v = [int]$ch; if ($v -le $n) { $target = $v - 1 } }
    if ($target -ge 0) {
        Blank
        Invoke-Screen -Name $script:Order[$target] -Index ($target + 1) -Total $n
        Pause-Back
        try { $null = [Console]::ReadKey($true) } catch { break }
    }
}
exit 0

# �������� � ����� �������:
Write-Host \ ������������ ���������. ������� ����� ������� ��� ������...\
try { [Console]::ReadKey($true) } catch { }
exit 0

# �������� � ����� �������:
Write-Host \ ������������ ���������. ������� ����� ������� ��� ������...\
try { [Console]::ReadKey($true) } catch { }
exit 0

# �������� � ����� �������:
Write-Host \ ������������ ���������. ������� ����� ������� ��� ������...\
try { [Console]::ReadKey($true) } catch { }
exit 0

