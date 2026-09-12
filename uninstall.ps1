<#
.SYNOPSIS
Удаление шимов `kibborg`, созданных install.ps1.

.DESCRIPTION
Удаляет `kibborg.cmd` и `kibborg.ps1` из указанного префикса и (если не задан -NoPath) убирает префикс
из пользовательского PATH. Ничего вне префикса не удаляется; сам репозиторий и сессии не затрагиваются.

.PARAMETER Prefix
Каталог с шимами; по умолчанию `%LOCALAPPDATA%\Kibborg\bin`.
.PARAMETER NoPath
Не изменять PATH.

.EXAMPLE
powershell -NoProfile -File Kibborg_CLI\uninstall.ps1 -NoPath
#>
param(
  [string]$Prefix = (Join-Path $env:LOCALAPPDATA 'Kibborg\bin'),
  [switch]$NoPath
)

$ErrorActionPreference = 'Stop'
Write-Host "Удаление kibborg из $Prefix" -ForegroundColor Yellow

$removed = @()
foreach ($name in @('kibborg.cmd', 'kibborg.ps1')) {
  $path = Join-Path $Prefix $name
  if (Test-Path $path) {
    Remove-Item -Path $path -Force
    $removed += $name
    Write-Host "Удалён $path" -ForegroundColor Green
  }
}
if ($removed.Count -eq 0) {
  Write-Host 'Шимов не найдено — удалять нечего.' -ForegroundColor Cyan
}

if ($NoPath) {
  Write-Host 'PATH не изменялся (-NoPath)' -ForegroundColor Cyan
} else {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ([string]::IsNullOrWhiteSpace($userPath)) {
    Write-Host 'PATH не содержит записи об этом префиксе.' -ForegroundColor Cyan
  } else {
    $kept = @($userPath -split ';' | Where-Object { $_ -ne '' -and $_ -ne $Prefix })
    if ($kept.Count -eq ($userPath -split ';' | Where-Object { $_ -ne '' }).Count) {
      Write-Host 'PATH не содержит записи об этом префиксе.' -ForegroundColor Cyan
    } else {
      [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
      Write-Host "Префикс удалён из пользовательского PATH: $Prefix" -ForegroundColor Green
      Write-Host 'Перезапустите терминал, чтобы изменение применилось.' -ForegroundColor Yellow
    }
  }
}

Write-Host 'Удаление завершено.' -ForegroundColor Green
exit 0
