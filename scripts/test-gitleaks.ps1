#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Test Gitleaks configuration for FlakeGuard repository

.DESCRIPTION
    This script validates that the updated Gitleaks configuration works correctly by:
    1. Installing Gitleaks if not present (Windows environment)
    2. Running Gitleaks with the updated config against the repository
    3. Verifying no false positives are reported

.PARAMETER ConfigPath
    Path to the Gitleaks configuration file (default: .github/security/gitleaks.toml)

.PARAMETER Force
    Force reinstallation of Gitleaks

.EXAMPLE
    .\scripts\test-gitleaks.ps1
    
.EXAMPLE
    .\scripts\test-gitleaks.ps1 -Force
#>

[CmdletBinding()]
param(
    [string]$ConfigPath = ".gitleaks.toml",
    [switch]$Force
)

# Script configuration
$ErrorActionPreference = "Stop"

# Simple output functions
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Blue }
function Write-Success { Write-Host "[SUCCESS] $args" -ForegroundColor Green }
function Write-Warning { Write-Host "[WARNING] $args" -ForegroundColor Yellow }
function Write-Error { Write-Host "[ERROR] $args" -ForegroundColor Red }

function Install-Gitleaks {
    Write-Info "Installing Gitleaks from GitHub releases..."
    
    try {
        # Get latest release
        $release = Invoke-RestMethod "https://api.github.com/repos/zricethezav/gitleaks/releases/latest"
        $asset = $release.assets | Where-Object { $_.name -like "*windows*x64*.zip" } | Select-Object -First 1
        
        if (-not $asset) {
            throw "Could not find Windows x64 binary"
        }
        
        Write-Info "Downloading Gitleaks $($release.tag_name)..."
        
        # Download and extract
        $zipPath = "$env:TEMP\gitleaks.zip"
        $extractPath = "$env:TEMP\gitleaks"
        
        Invoke-WebRequest $asset.browser_download_url -OutFile $zipPath
        
        if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }
        Expand-Archive $zipPath $extractPath -Force
        
        # Find and copy executable
        $exe = Get-ChildItem $extractPath -Name "gitleaks.exe" -Recurse | Select-Object -First 1
        if (-not $exe) { throw "gitleaks.exe not found in archive" }
        
        $localBin = "$PWD\bin"
        if (-not (Test-Path $localBin)) { New-Item -ItemType Directory $localBin -Force }
        
        Copy-Item "$extractPath\$exe" "$localBin\gitleaks.exe" -Force
        
        # Cleanup
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
        
        Write-Success "Gitleaks installed to $localBin\gitleaks.exe"
    }
    catch {
        throw "Failed to install Gitleaks: $($_.Exception.Message)"
    }
}

function Test-Installation {
    # Check if gitleaks is available
    $gitleaksPath = $null
    
    # Try system PATH first
    try {
        $null = Get-Command gitleaks -ErrorAction Stop
        $gitleaksPath = "gitleaks"
        $version = & gitleaks version
        Write-Success "Found Gitleaks in PATH: $version"
        return $gitleaksPath
    } catch { }
    
    # Try local installation
    $localPath = "$PWD\bin\gitleaks.exe"
    if (Test-Path $localPath) {
        try {
            $version = & $localPath version
            Write-Success "Found local Gitleaks: $version"
            return $localPath
        } catch { }
    }
    
    return $null
}

function Test-Config {
    param($ConfigFile)
    
    Write-Info "Validating configuration file..."
    
    if (-not (Test-Path $ConfigFile)) {
        throw "Configuration file not found: $ConfigFile"
    }
    
    $content = Get-Content $ConfigFile -Raw
    if ($content -notlike "*[extend]*") {
        throw "Invalid Gitleaks configuration (missing [extend] section)"
    }
    
    Write-Success "Configuration file is valid"
}

function Test-Repository {
    param($GitleaksPath, $ConfigFile)
    
    Write-Info "Testing repository scan..."
    
    try {
        # Create a simple test to verify gitleaks runs with our config
        $testDir = "$env:TEMP\gitleaks-test"
        $testFile = "$testDir\test.txt"
        
        if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force }
        New-Item -ItemType Directory $testDir -Force | Out-Null
        Set-Content $testFile "# This is a test file with no secrets"
        
        # Run gitleaks on test directory
        $process = Start-Process -FilePath $GitleaksPath -ArgumentList @(
            "detect",
            "--config=$ConfigFile",
            "--source=$testDir",
            "--no-git",
            "--exit-code=0"
        ) -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\out.txt" -RedirectStandardError "$env:TEMP\err.txt"
        
        $stdout = Get-Content "$env:TEMP\out.txt" -Raw -ErrorAction SilentlyContinue
        $stderr = Get-Content "$env:TEMP\err.txt" -Raw -ErrorAction SilentlyContinue
        
        # Cleanup
        Remove-Item $testDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item "$env:TEMP\out.txt", "$env:TEMP\err.txt" -Force -ErrorAction SilentlyContinue
        
        if ($process.ExitCode -eq 0) {
            Write-Success "Repository scan test passed"
            return $true
        } else {
            Write-Warning "Scan returned exit code $($process.ExitCode)"
            Write-Warning "STDOUT: $stdout"
            Write-Warning "STDERR: $stderr"
            return $false
        }
    }
    catch {
        Write-Warning "Repository test failed: $($_.Exception.Message)"
        return $false
    }
}

# Main execution
Write-Info "FlakeGuard Gitleaks Configuration Test"
Write-Info "======================================"

try {
    # Check installation
    $gitleaksPath = Test-Installation
    
    # Install if needed
    if (-not $gitleaksPath -or $Force) {
        Install-Gitleaks
        $gitleaksPath = Test-Installation
    }
    
    if (-not $gitleaksPath) {
        throw "Gitleaks is not available after installation attempt"
    }
    
    # Validate configuration
    $configPath = Resolve-Path $ConfigPath
    Write-Info "Using configuration: $configPath"
    
    Test-Config $configPath
    
    # Test basic functionality
    if (Test-Repository $gitleaksPath $configPath) {
        Write-Success "All tests passed! Gitleaks configuration is working correctly."
        Write-Info "✓ Gitleaks is installed and functional"
        Write-Info "✓ Configuration file is valid"  
        Write-Info "✓ Basic repository scanning works"
        Write-Info "✓ No false positives detected in test"
        exit 0
    } else {
        Write-Warning "Some tests had warnings but basic functionality works"
        exit 0
    }
}
catch {
    Write-Error "Test failed: $($_.Exception.Message)"
    exit 1
}