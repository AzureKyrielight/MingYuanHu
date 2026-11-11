# Creates Desktop and Start Menu shortcuts that start MingYuanHu without a console window.
# Delegates to launch-mingyuanhu.vbs (wscript, hidden) so no black terminal flashes up.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'launch-mingyuanhu.vbs'
if (-not (Test-Path -LiteralPath $launcher)) { throw "Launcher not found: $launcher" }

$icon = Join-Path $root 'assets\MingYuanHu.ico'
$displayName = -join @([char]0x660E, [char]0x8FDC, [char]0x6E56, [char]0x5149)

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)

foreach ($dir in $targets) {
  $path = Join-Path $dir ($displayName + '.lnk')
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $shortcut.Arguments = '"' + $launcher + '"'
  $shortcut.WorkingDirectory = $root
  $shortcut.Description = 'Start MingYuanHu'
  if (Test-Path $icon) { $shortcut.IconLocation = $icon }
  $shortcut.Save()
  Write-Host "Shortcut created: $path"
}
