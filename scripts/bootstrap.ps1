<#
.SYNOPSIS
Разворачивает Kibborg CLI внутри монорепозитория harness и собирает его.

.DESCRIPTION
Kibborg CLI использует пакеты `@deepseek-ai/dsh-*` из монорепозитория harness через `workspace:^`,
поэтому для работы ему нужна такая раскладка:

```
<Kiborg>/
├── packages/            ← harness
├── vendor/              ← harness
└── Kibborg_CLI/         ← этот репозиторий
```

Скрипт клонирует (или обновляет) harness в целевой каталог, копирует туда текущий репозиторий
Kibborg CLI, ставит зависимости, собирает обе части и, если не указан `-NoInstall`, создаёт команду
`kibborg` через `install.ps1`.

.PARAMETER Target
Каталог развёртывания; по умолчанию `$HOME\Kibborg`.
.PARAMETER Repo
URL монорепозитория harness.
.PARAMETER Ref
Ветка или тег harness.
.PARAMETER SkipBuild
Только разложить файлы, без `pnpm install` и сборки.
.PARAMETER NoInstall
Не создавать команду `kibborg` в PATH.
.PARAMETER Force
Перезаписать существующий каталог `Kibborg_CLI` в цели.

.EXAMPLE
pwsh -File scripts/bootstrap.ps1
pwsh -File scripts/bootstrap.ps1 -Target D:\tools\kibborg -Ref master
#>
param(
  [string]$Target = (Join-Path $HOME 'Kibborg'),
  [string]$Repo = 'https://github.com/Ydjin1984/DeepSeek_Kibborg_Harness.git',
  [string]$Ref = 'master',
  [switch]$SkipBuild,
  [switch]$NoInstall,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cli = Join-Path $Target 'Kibborg_CLI'

function Need([string]$command) {
  if ($null -eq (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Не найден $command. Установите его и повторите."
  }
}

Write-Host "Kibborg CLI → $Target" -ForegroundColor Green
foreach ($tool in @('git', 'node', 'pnpm')) { Need $tool }

$nodeVersion = (& node --version)
if ($nodeVersion -notmatch '^v(\d+)\.(\d+)') { throw "Не удалось определить версию Node.js" }
$major = [int]$Matches[1]
$minor = [int]$Matches[2]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 19)) {
  throw "Нужен Node.js 22.19 или новее, установлен $nodeVersion"
}
Write-Host "Node.js $nodeVersion, pnpm $(& pnpm --version)" -ForegroundColor Cyan

if (Test-Path (Join-Path $Target '.git')) {
  Write-Host 'Обновляю harness…' -ForegroundColor Yellow
  git -C $Target fetch --depth 1 origin $Ref
  git -C $Target checkout $Ref
  git -C $Target pull --ff-only origin $Ref
} else {
  Write-Host 'Клонирую harness…' -ForegroundColor Yellow
  New-Item -ItemType Directory -Path $Target -Force | Out-Null
  git clone --depth 1 --branch $Ref $Repo $Target
}

if ((Test-Path $cli) -and -not $Force) {
  Write-Host "Каталог $cli уже существует — обновляю файлы CLI." -ForegroundColor Yellow
} elseif ((Test-Path $cli) -and $Force) {
  Remove-Item -Recurse -Force $cli
}

# The CLI's packages depend on the harness packages through `workspace:^`, so the
# CLI has to be a workspace member; the upstream harness does not know about it.
$workspaceFile = Join-Path $Target 'pnpm-workspace.yaml'
if (Test-Path $workspaceFile) {
  $workspace = [System.IO.File]::ReadAllText($workspaceFile)
  if ($workspace -notmatch 'Kibborg_CLI/packages') {
    $lines = @(
      '  # Kibborg CLI: the terminal surface (own app bin, own bundle).',
      '  - Kibborg_CLI/apps/*',
      '  - Kibborg_CLI/packages/*'
    )
    $workspace = [regex]::Replace($workspace, '(?m)^(\s*-\s*packages/\*/\*)\s*$', "`$1`n$($lines -join "`n")", 1)
    [System.IO.File]::WriteAllText($workspaceFile, $workspace, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host 'Kibborg CLI добавлен в pnpm-workspace.yaml harness.' -ForegroundColor Green
  } else {
    Write-Host 'Kibborg CLI уже входит в рабочие пространства harness.' -ForegroundColor Cyan
  }
} else {
  Write-Warning "Не найден $workspaceFile: сборка Kibborg CLI может не найти зависимости harness."
}

Write-Host 'Копирую Kibborg CLI в раскладку…' -ForegroundColor Yellow
New-Item -ItemType Directory -Path $cli -Force | Out-Null
$excludes = @('node_modules', 'lib', '.git', '.dsh', 'coverage')
Get-ChildItem -Path $source -Force | Where-Object { $excludes -notcontains $_.Name } | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $cli -Recurse -Force
}

if ($SkipBuild) {
  Write-Host 'Файлы разложены, сборка пропущена (-SkipBuild).' -ForegroundColor Cyan
  exit 0
}

Write-Host 'Ставлю зависимости монорепо (это может занять несколько минут)…' -ForegroundColor Yellow
Push-Location $Target
try {
  & pnpm install
  if ($LASTEXITCODE -ne 0) { throw "pnpm install завершился с кодом $LASTEXITCODE" }

  Write-Host 'Собираю harness…' -ForegroundColor Yellow
  & pnpm run build
  if ($LASTEXITCODE -ne 0) { throw "Сборка harness завершилась с кодом $LASTEXITCODE" }

  Write-Host 'Собираю Kibborg CLI…' -ForegroundColor Yellow
  Push-Location $cli
  try {
    & pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "Сборка Kibborg CLI завершилась с кодом $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}

if (-not $NoInstall) {
  Write-Host 'Создаю команду kibborg…' -ForegroundColor Yellow
  & powershell -NoProfile -File (Join-Path $cli 'install.ps1')
  if ($LASTEXITCODE -ne 0) { throw "install.ps1 завершился с кодом $LASTEXITCODE" }
}

Write-Host ''
Write-Host 'Готово.' -ForegroundColor Green
Write-Host "Раскладка:      $Target"
Write-Host "Точка входа:    $cli\apps\cli\lib\bin.js"
if (-not $NoInstall) { Write-Host 'Проверка:       kibborg version   (после перезапуска терминала)' }
Write-Host 'Первый запуск:  kibborg "объясни, что делает этот репозиторий"'
Write-Host 'Нужен ключ:     $env:DEEPSEEK_API_KEY либо $env:DSH_HOME\.credentials.yaml'
Write-Host 'Сервер:         kibborg serve --port 7317 --token <секрет>  →  kibborg attach http://127.0.0.1:7317 --token <секрет>'
