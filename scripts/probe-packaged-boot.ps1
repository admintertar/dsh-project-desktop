<#
.SYNOPSIS
  Measure how long a packaged build takes to open a project.

.DESCRIPTION
  The shell reports the official HostRpc reject "DSH Host call cancelled or
  timed out" at the 'host-boot' stage, and that message cannot distinguish a
  slow start from a cancelled one. This probe starts the packaged application
  with a temporary .agent-project and watches the native window titles, which
  is the one signal that separates the two outcomes a user sees:

    project window title   -> the project opened
    Recovery Assistant     -> startup failed (the reported symptom)

  It also records when the per-project state directory appears, whether a
  pending-recovery journal exists, and the Host log sizes, then writes a JSON
  report next to the given work root.

.PARAMETER UserDataDirectory
  When set, exported as DSH_PROJECT_DESKTOP_USER_DATA so the run uses an
  isolated user-data root instead of %APPDATA%\dsh-project-desktop. Running the
  probe both ways is what tells a roaming-profile problem apart from a general
  startup problem.
#>
param(
  [Parameter(Mandatory = $true)][string]$AppDirectory,
  [Parameter(Mandatory = $true)][string]$WorkRoot,
  [string]$Label = 'packaged',
  [string]$UserDataDirectory = '',
  [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = 'Stop'
$WorkRoot = [System.IO.Path]::GetFullPath($WorkRoot)
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null

$exe = Get-ChildItem -Path $AppDirectory -Recurse -Filter '*.exe' |
  Where-Object { $_.Name -like 'DSH*' } | Select-Object -First 1
if (-not $exe) { throw "No DSH executable found under $AppDirectory" }

$projectName = "probe-$Label"
$projectRoot = Join-Path $WorkRoot $projectName
New-Item -ItemType Directory -Force -Path $projectRoot | Out-Null
$manifest = Join-Path $projectRoot "$projectName.agent-project"
Set-Content -Path $manifest -Encoding utf8 -Value @(
  'schemaVersion: 1'
  "id: $projectName"
  "name: $projectName"
  'resources: []'
)

if ($UserDataDirectory) {
  $env:DSH_PROJECT_DESKTOP_USER_DATA = [System.IO.Path]::GetFullPath($UserDataDirectory)
}
$userDataPath = if ($env:DSH_PROJECT_DESKTOP_USER_DATA) {
  $env:DSH_PROJECT_DESKTOP_USER_DATA
} else {
  Join-Path $env:APPDATA 'dsh-project-desktop'
}

$started = Get-Date
$process = Start-Process -FilePath $exe.FullName -ArgumentList $manifest `
  -WorkingDirectory $exe.DirectoryName -PassThru

$title = @()
$verdict = 'timeout'
$elapsed = 0
while (((Get-Date) - $started).TotalSeconds -lt $TimeoutSeconds) {
  Start-Sleep -Seconds 1
  $elapsed = [int]((Get-Date) - $started).TotalSeconds
  $title = @(Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle })
  if ($title -match 'Recovery Assistant|恢复助手') { $verdict = 'recovery-assistant'; break }
  if ($title -contains $projectName) { $verdict = 'project-window'; break }
  if ($process.HasExited) { $verdict = "exited-$($process.ExitCode)"; break }
  if ($elapsed % 30 -eq 0) { Write-Host "t+${elapsed}s titles: $($title -join ' | ')" }
}

# Capture the state the verdict depends on before the application is stopped.
$projectStates = @()
$stateRoot = Join-Path $userDataPath 'projects'
if (Test-Path $stateRoot) {
  foreach ($directory in Get-ChildItem -Path $stateRoot -Directory -ErrorAction SilentlyContinue) {
    $logs = @()
    $logDirectory = Join-Path $directory.FullName 'logs'
    if (Test-Path $logDirectory) {
      $logs = @(Get-ChildItem -Path $logDirectory -File -ErrorAction SilentlyContinue |
        ForEach-Object { [ordered]@{ name = $_.Name; bytes = $_.Length } })
    }
    $projectStates += [ordered]@{
      id = $directory.Name
      hasLockfile = Test-Path (Join-Path $directory.FullName 'dsh/profiles/desktop/pnpm-lock.yaml')
      pendingRecovery = @(Get-ChildItem -Path $directory.FullName -Filter 'project-recovery-pending*.json' -ErrorAction SilentlyContinue).Count
      logs = $logs
    }
  }
}

try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch { }
taskkill /PID $process.Id /T /F 2>&1 | Out-Null

$report = [ordered]@{
  label = $Label
  verdict = $verdict
  elapsedSeconds = $elapsed
  timeoutSeconds = $TimeoutSeconds
  executable = $exe.FullName
  manifest = $manifest
  userData = $userDataPath
  isolatedUserData = [bool]$UserDataDirectory
  windowTitles = $title
  projectStates = $projectStates
  finishedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$reportPath = Join-Path $WorkRoot "packaged-probe-$Label.json"
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $reportPath -Encoding utf8
Write-Host "verdict=$verdict elapsed=${elapsed}s report=$reportPath"
Write-Host ($report | ConvertTo-Json -Depth 6)
