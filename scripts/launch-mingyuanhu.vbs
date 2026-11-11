' MingYuanHu hidden launcher (ASCII only: Windows Script Host reads ANSI by default).
' Starts the dev runtime without a console window and waits for it to exit,
' so closing the app also ends this script instead of leaving an orphan process.
Option Explicit
Dim shell, fso, root, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
' scripts\launch-mingyuanhu.vbs -> project root is two levels up.
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
command = "cmd /c corepack pnpm dev"
' 0 = hidden window, True = wait for exit.
shell.Run command, 0, True
