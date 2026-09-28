# Registers the "polozov-presence" scheduled task: runs run.mjs every
# 5 minutes for the current user, only while logged on, with no console
# window (conhost --headless). Re-running replaces the task.
# Undo with uninstall.ps1. Log: %LOCALAPPDATA%\polozov-presence\run.log
$ErrorActionPreference = "Stop"

$node = (Get-Command node).Source
$script = Join-Path $PSScriptRoot "run.mjs"

$action = New-ScheduledTaskAction `
  -Execute "conhost.exe" `
  -Argument "--headless `"$node`" `"$script`"" `
  -WorkingDirectory $PSScriptRoot
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

Write-Output "Registered polozov-presence (every 5 min). Log: $env:LOCALAPPDATA\polozov-presence\run.log"
