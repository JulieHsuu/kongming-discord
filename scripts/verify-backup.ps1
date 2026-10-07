param([string]$Archive)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backupRoot = Join-Path $projectRoot 'backups'
if (-not $Archive) { $Archive = (Get-ChildItem -LiteralPath $backupRoot -Filter 'kongming-*.zip' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName }
if (-not $Archive) { throw 'No backup found.' }
$preview = Join-Path $backupRoot ('restore-check-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
[IO.Compression.ZipFile]::ExtractToDirectory($Archive, $preview)
$manifest = Get-Content -LiteralPath (Join-Path $preview 'manifest.json') -Raw | ConvertFrom-Json
foreach ($item in $manifest.files) {
    $target = [IO.Path]::GetFullPath((Join-Path $preview $item.path))
    if (-not $target.StartsWith([IO.Path]::GetFullPath($preview) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid backup path.' }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $item.sha256) { throw "Invalid restored file: $($item.path)" }
    if ([IO.Path]::GetExtension($target) -eq '.json') { Get-Content -LiteralPath $target -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null }
}
Write-Output "Restore verified: $($manifest.files.Count) files. Preview: $preview"
