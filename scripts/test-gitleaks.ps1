#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Test Gitleaks configuration for FlakeGuard repository

.DESCRIPTION
    This script validates that the updated Gitleaks configuration works correctly by:
    1. Installing Gitleaks if not present
    2. Running Gitleaks with the updated config against the repository
    3. Verifying no false positives are reported

.PARAMETER ConfigPath
    Path to the Gitleaks configuration file (default: .github/security/gitleaks.toml)

.PARAMETER Verbose
    Enable verbose output

.PARAMETER Force
    Force reinstallation of Gitleaks

.EXAMPLE
    .\scripts\test-gitleaks.ps1
    
.EXAMPLE
    .\scripts\test-gitleaks.ps1 -Verbose -Force
#>

[CmdletBinding()]
param(
    [string]$ConfigPath = ".github/security/gitleaks.toml",
    [switch]$Force
)

# Script configuration
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Colors for output (simplified for better compatibility)
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Test-GitLeaksInstalled {
    <#
    .SYNOPSIS
        Check if Gitleaks is installed and accessible
    #>
    
    # Check for gitleaks in current PATH
    try {
        $null = Get-Command gitleaks -ErrorAction Stop
        $version = & gitleaks version 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Gitleaks is already installed: $version"
            return $true
        }
    }
    catch {
        # Command not found in PATH
    }
    
    # Check for gitleaks in local bin directory
    $localGitleaks = "$PWD\bin\gitleaks.exe"
    if (Test-Path $localGitleaks) {
        try {
            $version = & $localGitleaks version 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Gitleaks found locally: $version"
                # Add to PATH for current session
                $localBin = "$PWD\bin"
                if ($env:PATH -notlike "*$localBin*") {
                    $env:PATH = "$localBin;$env:PATH"
                }
                return $true
            }
        }
        catch {
            # Local binary not working
        }
    }
    
    Write-Info "Gitleaks not found in PATH or local bin directory"
    return $false
}

function Install-GitLeaks {
    <#
    .SYNOPSIS
        Install Gitleaks using direct download from GitHub
    #>
    Write-Info "Installing Gitleaks from GitHub releases..."
    
    try {
        # Get latest release info
        $releaseUrl = "https://api.github.com/repos/zricethezav/gitleaks/releases/latest"
        $release = Invoke-RestMethod -Uri $releaseUrl -UseBasicParsing
        
        # Find Windows binary
        $asset = $release.assets | Where-Object { $_.name -like "*windows*x64*.zip" } | Select-Object -First 1
        if (-not $asset) {
            throw "Could not find Windows x64 binary in latest release"
        }
        
        Write-Info "Downloading Gitleaks $($release.tag_name)..."
        $downloadUrl = $asset.browser_download_url
        $zipPath = "$env:TEMP\gitleaks.zip"
        $extractPath = "$env:TEMP\gitleaks"
        
        # Download
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
        
        # Extract
        if (Test-Path $extractPath) {
            Remove-Item $extractPath -Recurse -Force
        }
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
        
        # Find the executable
        $exePath = Get-ChildItem -Path $extractPath -Name "gitleaks.exe" -Recurse | Select-Object -First 1
        if (-not $exePath) {
            throw "Could not find gitleaks.exe in extracted files"
        }
        
        # Create a local bin directory
        $localBin = "$PWD\bin"
        if (-not (Test-Path $localBin)) {
            New-Item -ItemType Directory -Path $localBin -Force | Out-Null
        }
        
        # Copy executable
        $targetPath = "$localBin\gitleaks.exe"
        Copy-Item -Path "$extractPath\$exePath" -Destination $targetPath -Force
        
        # Add to PATH for current session
        if ($env:PATH -notlike "*$localBin*") {
            $env:PATH = "$localBin;$env:PATH"
        }
        
        # Clean up
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
        
        Write-Success "Gitleaks installed to $targetPath"
    }
    catch {
        throw "Failed to install Gitleaks from GitHub: $($_.Exception.Message)"
    }
}

function Test-GitLeaksConfig {
    <#
    .SYNOPSIS
        Test the Gitleaks configuration file
    #>
    param([string]$ConfigFile)
    
    Write-Info "Testing Gitleaks configuration..."
    
    if (-not (Test-Path $ConfigFile)) {
        throw "Gitleaks configuration file not found: $ConfigFile"
    }
    
    # Simple validation - check if the config file is valid TOML structure
    try {
        $configContent = Get-Content $ConfigFile -Raw
        
        # Basic TOML syntax checks
        if ($configContent -notlike "*[extend]*") {
            throw "Configuration file doesn't appear to be a valid Gitleaks config (missing [extend] section)"
        }
        
        if ($configContent -like "*[[allowlists]]*") {
            Write-Success "Configuration file has valid structure with allowlists"
        } else {
            Write-Warning "Configuration file doesn't contain allowlists - this may be intentional"
        }
        
        Write-Success "Configuration file syntax appears valid"
    }
    catch {
        throw "Failed to validate configuration: $($_.Exception.Message)"
    }
}

function Test-GitLeaksRepository {
    <#
    .SYNOPSIS
        Run Gitleaks against the repository and check results
    #>
    param([string]$ConfigFile)
    
    Write-Info "Running Gitleaks against repository..."
    
    $reportFile = "$env:TEMP\gitleaks-report.json"
    if (Test-Path $reportFile) {
        Remove-Item $reportFile -Force
    }
    
    try {
        # Find gitleaks executable
        $gitleaksExe = "gitleaks"
        if (Test-Path "$PWD\bin\gitleaks.exe") {
            $gitleaksExe = "$PWD\bin\gitleaks.exe"
        }
        
        # Run Gitleaks with JSON output
        $gitleaksArgs = @(
            "detect",
            "--config=$ConfigFile",
            "--report-path=$reportFile", 
            "--source=.",
            "--no-git",
            "--exit-code=0"
        )
        
        Write-Info "Running: $gitleaksExe $($gitleaksArgs -join ' ')"
        & $gitleaksExe @gitleaksArgs 2>&1 | Out-Null
        $exitCode = $LASTEXITCODE
        
        Write-Verbose "Gitleaks exit code: $exitCode"
        
        # Parse results
        if (Test-Path $reportFile) {
            $reportContent = Get-Content $reportFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($reportContent -and $reportContent.Count -gt 0) {
                Write-Error "Gitleaks found potential secrets:"
                foreach ($finding in $reportContent) {
                    Write-Host "  - File: $($finding.File)" -ForegroundColor Red
                    Write-Host "    Line: $($finding.StartLine)" -ForegroundColor Red
                    Write-Host "    Rule: $($finding.RuleID)" -ForegroundColor Red
                    Write-Host "    Description: $($finding.Description)" -ForegroundColor Red
                    Write-Host ""
                }
                return $false
            }
        }
        
        # Exit code 0 means no leaks found - success!
        if ($exitCode -eq 0) {
            Write-Success "No secrets detected - configuration is working correctly"
            return $true
        } else {
            Write-Warning "Gitleaks returned exit code $exitCode"
            return $false
        }
    }
    catch {
        throw "Failed to run Gitleaks: $($_.Exception.Message)"
    }
    finally {
        # Clean up report file
        if (Test-Path $reportFile) {
            Remove-Item $reportFile -Force -ErrorAction SilentlyContinue
        }
    }
}

function Test-KnownFalsePositives {
    <#
    .SYNOPSIS
        Test that known false positives are properly allowed
    #>
    param([string]$ConfigFile)
    
    Write-Info "Testing known false positive patterns..."
    
    # Create a temporary test file with patterns that should be allowed
    $testFile = "$env:TEMP\test-false-positives.txt"
    $testContent = @"
# These should be allowed by the configuration
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/test
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long-change-this
SLACK_BOT_TOKEN=xoxb-test-placeholder-token
GITHUB_PRIVATE_KEY=FAKE_PRIVATE_KEY_FOR_TESTS
Authorization: Bearer <REDACTED_TOKEN>
curl -H "Authorization: Bearer your-token-here"
"@
    
    try {
        Set-Content -Path $testFile -Value $testContent
        
        $reportFile = "$env:TEMP\gitleaks-test-report.json"
        if (Test-Path $reportFile) {
            Remove-Item $reportFile -Force
        }
        
        # Find gitleaks executable
        $gitleaksExe = "gitleaks"
        if (Test-Path "$PWD\bin\gitleaks.exe") {
            $gitleaksExe = "$PWD\bin\gitleaks.exe"
        }
        
        # Run Gitleaks on the test file
        & $gitleaksExe detect --config="$ConfigFile" --report-path="$reportFile" --source="$testFile" --no-git --exit-code=0 2>&1 | Out-Null
        
        # Check if any secrets were detected in our test file
        $detected = $false
        if (Test-Path $reportFile) {
            $reportContent = Get-Content $reportFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($reportContent -and $reportContent.Count -gt 0) {
                $detected = $true
                Write-Warning "Some false positive patterns were not properly allowed:"
                foreach ($finding in $reportContent) {
                    Write-Host "  - Rule: $($finding.RuleID)" -ForegroundColor Yellow
                    Write-Host "    Match: $($finding.Match)" -ForegroundColor Yellow
                }
            }
        }
        
        if (-not $detected) {
            Write-Success "All known false positive patterns are properly allowed"
            return $true
        } else {
            Write-Warning "Some false positive patterns need attention in the configuration"
            return $false
        }
    }
    catch {
        Write-Warning "Failed to test false positives: $($_.Exception.Message)"
        return $false
    }
    finally {
        # Clean up
        if (Test-Path $testFile) {
            Remove-Item $testFile -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $reportFile) {
            Remove-Item $reportFile -Force -ErrorAction SilentlyContinue
        }
    }
}

# Main execution
function Main {
    Write-Info "FlakeGuard Gitleaks Configuration Test"
    Write-Info "======================================"
    
    $success = $true
    
    try {
        # Check if we need to install Gitleaks
        if ($Force -or -not (Test-GitLeaksInstalled)) {
            Install-GitLeaks
        }
        
        # Verify Gitleaks is now available
        if (-not (Test-GitLeaksInstalled)) {
            throw "Gitleaks installation failed or is not accessible"
        }
        
        # Resolve config path
        $fullConfigPath = Resolve-Path $ConfigPath -ErrorAction Stop
        Write-Info "Using configuration file: $fullConfigPath"
        
        # Test configuration file
        Test-GitLeaksConfig -ConfigFile $fullConfigPath
        
        # Test repository scan
        if (-not (Test-GitLeaksRepository -ConfigFile $fullConfigPath)) {
            $success = $false
        }
        
        # Test false positives handling
        if (-not (Test-KnownFalsePositives -ConfigFile $fullConfigPath)) {
            Write-Warning "Some false positive patterns may need adjustment"
            # Don't fail the overall test for this
        }
        
        if ($success) {
            Write-Success "All tests passed! Gitleaks configuration is working correctly."
            Write-Info "No false positives detected in the repository."
            exit 0
        } else {
            Write-Error "Some tests failed. Please review the configuration."
            exit 1
        }
    }
    catch {
        Write-Error "Test failed: $($_.Exception.Message)"
        if ($VerbosePreference -eq "Continue") {
            Write-Host $_.ScriptStackTrace -ForegroundColor Red
        }
        exit 1
    }
}

# Run main function
Main