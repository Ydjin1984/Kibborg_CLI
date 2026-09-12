<#
.SYNOPSIS
Установка CLI `kibborg` на Windows.

.DESCRIPTION
Создаёт в каталоге-префиксе два шима (`kibborg.cmd` для cmd/PowerShell и `kibborg.ps1` для PowerShell),
которые запускают собранный `apps\cli\lib\bin.js` этого репозитория, и при необходимости добавляет
префикс в ПОЛЬЗОВАТЕЛЬСКИЙ PATH. Администратор не нужен, системный PATH и реестр не затрагиваются.

.PARAMETER Prefix
Каталог для шимов; по умолчанию `%LOCALAPPDATA%\Kibborg\bin`.
.PARAMETER SkipBuild
Не запускать `pnpm run build`, даже если сборки нет.
.PARAMETER NoPath
Не изменять PATH.
.PARAMETER DryRun
Только показать, что будет сделано.

.EXAMPLE
powershell -NoProfile -File Kibborg_CLI\install.ps1

.EXAMPLE
powershell -NoProfile -File Kibborg_CLI\install.ps1 -Prefix "$env:TEMP\kibborg-bin" -SkipBuild -NoPath
#>
param(
  [string]$Prefix = (Join-Path $env:LOCALAPPDATA 'Kibborg\bin'),
  [switch]$SkipBuild,
  [switch]$NoPath,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$bin = Join-Path $root 'apps\cli\lib\bin.js'

Write-Host "Установка kibborg в $Prefix" -ForegroundColor Green

$nodeVersion = (& node --version 2>$null)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)') {
  Write-Error 'Node.js не найден. Нужен Node.js 22.19 или новее.'
  exit 1
}
$major = [int]$Matches[1]
$minor = [int]$Matches[2]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 19)) {
  Write-Error "Нужен Node.js 22.19 или новее, установлен $nodeVersion."
  exit 1
}
Write-Host "Node.js: $nodeVersion" -ForegroundColor Cyan

if (-not (Test-Path $bin)) {
  if ($SkipBuild) {
    Write-Error "Сборка не найдена: $bin. Уберите -SkipBuild или соберите проект (pnpm run build в $root)."
    exit 1
  }
  if ($DryRun) {
    Write-Host "Сборка была бы запущена: pnpm run build (в $root)" -ForegroundColor Gray
  } else {
    Write-Host 'Сборка не найдена, запускаю pnpm run build…' -ForegroundColor Yellow
    Push-Location $root
    try {
      & pnpm run build
      if ($LASTEXITCODE -ne 0) {
        Write-Error "Сборка завершилась с кодом $LASTEXITCODE."
        exit 1
      }
    } finally {
      Pop-Location
    }
  }
}
if (-not (Test-Path $bin)) {
  Write-Error "После сборки файл всё ещё отсутствует: $bin"
  exit 1
}
$binFull = (Resolve-Path $bin).Path

if (-not (Test-Path $Prefix)) {
  if ($DryRun) {
    Write-Host "Каталог был бы создан: $Prefix" -ForegroundColor Gray
  } else {
    New-Item -ItemType Directory -Path $Prefix -Force | Out-Null
    Write-Host "Создан каталог $Prefix" -ForegroundColor Green
  }
}

# Шимы вызывают ровно собранный bin.js: путь абсолютный, поэтому команда работает
# из любого каталога и не зависит от того, где лежит сам шим.
$cmdPath = Join-Path $Prefix 'kibborg.cmd'
$cmdContent = "@echo off`r`nnode `"$binFull`" %*`r`n"
$ps1Path = Join-Path $Prefix 'kibborg.ps1'
$ps1Content = @"
# kibborg — запуск собранного CLI из $root.
param()
if (`$MyInvocation.ExpectingInput) {
  `$input | & node "$binFull" @args
} else {
  & node "$binFull" @args
}
exit `$LASTEXITCODE
"@

foreach ($file in @(@{ Path = $cmdPath; Content = $cmdContent; Bom = $false }, @{ Path = $ps1Path; Content = $ps1Content; Bom = $true })) {
  if ($DryRun) {
    Write-Host "Был бы создан файл: $($file.Path)" -ForegroundColor Gray
  } else {
    # cmd.exe не понимает BOM: с ним первая строка читается как `п»ї@echo`, и
    # каждый запуск печатает ошибку. Кириллица есть только в .ps1, поэтому BOM
    # ставится лишь там, где Windows PowerShell 5.1 без него испортит текст.
    $encoding = New-Object System.Text.UTF8Encoding($file.Bom)
    [System.IO.File]::WriteAllText($file.Path, $file.Content, $encoding)
    Write-Host "Создан $($file.Path)" -ForegroundColor Green
  }
}

if ($NoPath) {
  Write-Host 'PATH не изменялся (-NoPath)' -ForegroundColor Cyan
} else {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @()
  if (-not [string]::IsNullOrWhiteSpace($userPath)) { $entries = $userPath -split ';' }
  if ($entries -contains $Prefix) {
    Write-Host "PATH уже содержит $Prefix" -ForegroundColor Cyan
  } elseif ($DryRun) {
    Write-Host "PATH получил бы запись: $Prefix" -ForegroundColor Gray
  } else {
    $next = if ([string]::IsNullOrWhiteSpace($userPath)) { $Prefix } else { "$userPath;$Prefix" }
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    Write-Host "Добавлено в пользовательский PATH: $Prefix" -ForegroundColor Green
    Write-Host 'Перезапустите терминал, чтобы PATH применился.' -ForegroundColor Yellow
  }
}

Write-Host 'Установка завершена. Проверка: kibborg version' -ForegroundColor Green
exit 0
