$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$statePath = Join-Path $projectRoot 'state'
$backupRoot = Join-Path $projectRoot 'backups'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$backupRoot = [IO.Path]::GetFullPath($backupRoot)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$stage = Join-Path $backupRoot ('stage-' + $stamp)
$archive = Join-Path $backupRoot ('kongming-' + $stamp + '.zip')
$partialArchive = $archive + '.partial'
New-Item -ItemType Directory -Path (Join-Path $stage 'state') -Force | Out-Null
try {
    $manifest = @()
    foreach ($source in Get-ChildItem -LiteralPath $statePath -File -Recurse) {
        if ($source.Name -match '\.(log|tmp|pid)$' -or $source.Name -eq 'stt-check.wav') { continue }
        $relative = $source.FullName.Substring($statePath.Length + 1)
        $target = Join-Path (Join-Path $stage 'state') $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        $copied = $false
        for ($attempt = 0; $attempt -lt 3; $attempt++) {
            try {
                $bytes = [IO.File]::ReadAllBytes($source.FullName)
                if ($source.Extension -eq '.json') { [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json | Out-Null }
                [IO.File]::WriteAllBytes($target, $bytes)
                $copied = $true; break
            } catch { if (-not (Test-Path -LiteralPath $source.FullName)) { break }; if ($attempt -eq 2) { throw } }
        }
        if ($copied) { $manifest += @{ path = 'state/' + $relative.Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash; bytes = (Get-Item -LiteralPath $target).Length } }
    }
    if (-not $manifest.Count) { throw 'No state files available to back up.' }
    @{ createdAt = (Get-Date).ToString('o'); files = $manifest; note = 'Live file snapshot. Environment secrets and runtime logs are excluded.' } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding UTF8
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $partialArchive)
    $zip = [IO.Compression.ZipFile]::OpenRead($partialArchive)
    try {
        foreach ($item in $manifest) {
            $entry = $zip.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq $item.path } | Select-Object -First 1
            if (-not $entry) { throw "Missing archive entry: $($item.path)" }
            $stream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', ''); if ($hash -ne $item.sha256) { throw "Checksum mismatch: $($item.path)" } } finally { $stream.Dispose(); $sha.Dispose() }
        }
    } finally { $zip.Dispose() }
    Move-Item -LiteralPath $partialArchive -Destination $archive
    Write-Output "Verified backup: $archive ($($manifest.Count) files)"
    foreach ($old in Get-ChildItem -LiteralPath $backupRoot -Filter 'kongming-*.zip' -File | Where-Object LastWriteTime -lt (Get-Date).AddDays(-14)) {
        $resolved = [IO.Path]::GetFullPath($old.FullName)
        if (-not $resolved.StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup retention path is outside backup directory.' }
        Remove-Item -LiteralPath $resolved -Force
    }
} finally {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if ($resolvedStage.StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}
