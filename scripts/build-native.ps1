[CmdletBinding()]
param(
    # Omit to build and stage the executable in host/. Supply an existing
    # Hermes profile directory to also install it under plugins/reliquary/host.
    [string] $HermesHome,
    # Replacing an installed executable always requires this explicit switch.
    [switch] $Replace
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifest = Join-Path $repoRoot 'host\Cargo.toml'
$targetDir = Join-Path $repoRoot 'host\target'
$builtBinary = Join-Path $targetDir 'release\reliquary-hermes-host.exe'
$stagedBinary = Join-Path $repoRoot 'host\reliquary-hermes-host.exe'
$installBinary = $null

if ($HermesHome) {
    if (![System.IO.Path]::IsPathRooted($HermesHome)) {
        throw 'HermesHome must be an absolute path to an existing Hermes profile directory.'
    }
    if (!(Test-Path -LiteralPath $HermesHome -PathType Container)) {
        throw 'HermesHome must be an existing Hermes profile directory.'
    }
    $installBinary = Join-Path $HermesHome 'plugins\reliquary\host\reliquary-hermes-host.exe'
    if ((Test-Path -LiteralPath $installBinary) -and !$Replace) {
        throw 'The profile already has a Reliquary host. Pass -Replace to replace it.'
    }
}

# Keep Cargo downloads, compiler output and temporary files inside this checkout.
$env:CARGO_HOME = Join-Path $repoRoot '.cargo-home'
$env:CARGO_TARGET_DIR = $targetDir
$scratch = Join-Path $repoRoot 'host\.test-tmp\build-native'
New-Item -ItemType Directory -Force -Path $env:CARGO_HOME, $scratch | Out-Null
$env:TEMP = $scratch
$env:TMP = $scratch
$env:TMPDIR = $scratch

& cargo build --release --locked --manifest-path $manifest -j 1
if ($LASTEXITCODE -ne 0) {
    throw "Cargo build failed with exit code $LASTEXITCODE."
}
if (!(Test-Path -LiteralPath $builtBinary -PathType Leaf)) {
    throw 'Cargo completed without producing the expected Windows host executable.'
}

Copy-Item -LiteralPath $builtBinary -Destination $stagedBinary -Force
$stagedHash = (Get-FileHash -LiteralPath $stagedBinary -Algorithm SHA256).Hash
Write-Output "Staged host: $stagedBinary"
Write-Output "SHA-256: $stagedHash"

if ($installBinary) {
    $installDirectory = Split-Path -Parent $installBinary
    New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
    Copy-Item -LiteralPath $stagedBinary -Destination $installBinary -Force
    $installedHash = (Get-FileHash -LiteralPath $installBinary -Algorithm SHA256).Hash
    if ($installedHash -ne $stagedHash) {
        throw 'Installed host hash does not match the staged build.'
    }
    Write-Output "Installed host: $installBinary"
    Write-Output "SHA-256: $installedHash"
}
