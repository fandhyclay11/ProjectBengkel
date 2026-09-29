$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$taskName = 'ProjectBengkel Weekly Database Backup'
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '02:00'
$taskAction = New-ScheduledTaskAction -Execute $nodePath -Argument 'node_modules/tsx/dist/cli.mjs scripts/backup-scheduled.ts' -WorkingDirectory $projectRoot
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $weeklyTrigger -Settings $taskSettings -Principal $taskPrincipal -Force | Out-Null
Write-Output "Weekly backup task registered: $taskName"
