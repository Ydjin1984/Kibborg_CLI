# kibborg installer (Windows): make the `kibborg` command available from any
# directory by adding this checkout's bin folder to the user PATH.
#
#   pwsh -File Kibborg_CLI\bin\install.ps1            # install
#   pwsh -File Kibborg_CLI\bin\install.ps1 -Remove    # uninstall
#
# The change is user-scoped, reversible, and prints exactly what it wrote.

[CmdletBinding()]
param(
    [switch]$Remove
)

$binDir = $PSScriptRoot
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $userPath) { $userPath = '' }
$entries = $userPath -split ';' | Where-Object { $_ -ne '' }
$present = $entries -contains $binDir

if ($Remove) {
    if (-not $present) {
        Write-Output "kibborg: $binDir is not in the user PATH; nothing to remove"
        exit 0
    }
    $kept = $entries | Where-Object { $_ -ne $binDir }
    [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
    Write-Output "kibborg: removed $binDir from the user PATH"
    exit 0
}

if ($present) {
    Write-Output "kibborg: $binDir is already in the user PATH"
} else {
    $updated = ($entries + $binDir) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
    Write-Output "kibborg: added $binDir to the user PATH"
}

Write-Output 'kibborg: open a new terminal (or restart VS Code), then run: kibborg version'
Write-Output ('kibborg: for the current session only, prepend to PATH: ' + $binDir)
