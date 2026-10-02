$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$runtimePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $runtimePath)) { throw 'Node.js 20 or newer is required.' }
$logDir = Join-Path $projectDir 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$instanceLock = [System.Threading.Mutex]::new($false, 'Local\KongmingDiscordSupervisor')
if (-not $instanceLock.WaitOne(0)) { exit 0 }
try {
    $PID | Set-Content -LiteralPath (Join-Path $logDir 'supervisor.pid')
    while ($true) {
        Add-Content -LiteralPath (Join-Path $logDir 'supervisor.log') -Value "$(Get-Date -Format o) Starting Kongming"
        $logStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $worker = Start-Process -FilePath $runtimePath -ArgumentList 'src/index.js' -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "$logStamp-output.log") -RedirectStandardError (Join-Path $logDir "$logStamp-error.log") -PassThru
        $worker.Id | Set-Content -LiteralPath (Join-Path $logDir 'worker.pid')
        $worker.WaitForExit()
        Add-Content -LiteralPath (Join-Path $logDir 'supervisor.log') -Value "$(Get-Date -Format o) Exited ($($worker.ExitCode)); retrying in 10 seconds"
        Start-Sleep -Seconds 10
    }
} finally {
    $instanceLock.ReleaseMutex()
    $instanceLock.Dispose()
}
