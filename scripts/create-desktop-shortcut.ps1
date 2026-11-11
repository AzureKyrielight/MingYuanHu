# Creates a desktop shortcut that starts MingYuanHu without a console window.
# ASCII only: Windows PowerShell 5.1 mis-decodes UTF-8 scripts without BOM.
# The visible shortcut name is built from code points so this file stays ASCII.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'launch-mingyuanhu.vbs'
if (-not (Test-Path -LiteralPath $launcher)) { throw "Launcher not found: $launcher" }

$displayName = -join @(
  [char]0x660E,
  [char]0x8FDC,
  [char]0x6E56,
  [char]0x5149
)

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop ($displayName + '.lnk')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'MingYuanHu campus workbench'
$appIcon = Join-Path $root 'assets\MingYuanHu.ico'
if (Test-Path -LiteralPath $appIcon) { $shortcut.IconLocation = "$appIcon,0" }
$shortcut.Save()
Write-Output "Shortcut created: $shortcutPath"
