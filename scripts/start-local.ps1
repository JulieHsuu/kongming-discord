$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'local-runtime.json') -Raw | ConvertFrom-Json
$mutex = [Threading.Mutex]::new($false, 'Local\KongmingDiscordStart')
if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); exit 0 }
try {
    $entry = Join-Path $projectRoot 'src\index.js'
    $existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($entry) }
    if ($existing) { Write-Output "Already running: $($existing.ProcessId -join ',')"; exit 0 }
    $statePath = Join-Path $projectRoot 'state'
    New-Item -ItemType Directory -Path $statePath -Force | Out-Null
    $env:Path = $runtime.ffmpegDirectory + ';' + $env:Path
    $bot = Start-Process -FilePath $runtime.node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $statePath 'bot.stdout.log') -RedirectStandardError (Join-Path $statePath 'bot.stderr.log') -PassThru
    [IO.File]::WriteAllText((Join-Path $statePath 'bot.pid'), [string]$bot.Id)
    Write-Output "Started: $($bot.Id)"
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
