# Registers the "polozov-presence" scheduled task: runs run.mjs every
# 5 minutes for the current user, only while logged on (LogonType
# Interactive), with no console window (conhost --headless).
# The task runs a pinned copy: run.mjs + collect.mjs are copied to
# %LOCALAPPDATA%\polozov-presence\bin and node's path is fixed here, so
# edits to this checkout (or a Node upgrade/move) reach the task only when
# this script is re-run. Re-running refreshes the copy and replaces the task.
# Undo with uninstall.ps1. Clone: ...\polozov-presence\repo, log: ...\run.log
$ErrorActionPreference = "Stop"

$node = (Get-Command node).Source
$bin = Join-Path $env:LOCALAPPDATA "polozov-presence\bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item -Force -Destination $bin -Path `
  (Join-Path $PSScriptRoot "run.mjs"), (Join-Path $PSScriptRoot "collect.mjs")
$script = Join-Path $bin "run.mjs"

$action = New-ScheduledTaskAction `
  -Execute "conhost.exe" `
  -Argument "--headless `"$node`" `"$script`"" `
  -WorkingDirectory $bin
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName "polozov-presence" `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Force | Out-Null

Write-Output "Registered polozov-presence (every 5 min), running $script. Log: $env:LOCALAPPDATA\polozov-presence\run.log"
