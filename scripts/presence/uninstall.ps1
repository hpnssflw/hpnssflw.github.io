# Removes the "polozov-presence" scheduled task registered by install.ps1 -
# only the task: the clone (repo), the log (run.log) and the pinned script
# copy (bin) under %LOCALAPPDATA%\polozov-presence are kept.
$ErrorActionPreference = "Stop"
Unregister-ScheduledTask -TaskName "polozov-presence" -Confirm:$false
Write-Output "Removed polozov-presence."
