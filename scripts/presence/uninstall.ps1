# Removes the "polozov-presence" scheduled task registered by install.ps1.
# The local clone and log under %LOCALAPPDATA%\polozov-presence are kept.
$ErrorActionPreference = "Stop"
Unregister-ScheduledTask -TaskName "polozov-presence" -Confirm:$false
Write-Output "Removed polozov-presence."
