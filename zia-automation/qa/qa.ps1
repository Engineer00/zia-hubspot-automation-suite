#!/usr/bin/env pwsh
# QA Test Suite Runner for PowerShell
# Quick way to run QA tests

param(
    [string[]]$Arguments
)

Push-Location $PSScriptRoot

if ($Arguments.Count -eq 0) {
    Write-Host "Running full QA suite..." -ForegroundColor Cyan
    & node qa-suite.js @Arguments
}
elseif ($Arguments[0] -eq "--help") {
    Write-Host ""
    Write-Host "QA Test Suite Runner" -ForegroundColor Green
    Write-Host ""
    Write-Host "Usage: ./qa.ps1 [options]" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Green
    Write-Host "  --suite [name]     Run specific suite (api, rules, data, validation, server, performance)"
    Write-Host "  --dry-run          Do not modify any data"
    Write-Host "  --verbose          Detailed output"
    Write-Host "  --json             JSON report output"
    Write-Host "  --help             Show this help"
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Green
    Write-Host "  ./qa.ps1                           Run all tests"
    Write-Host "  ./qa.ps1 --suite api               Run API tests only"
    Write-Host "  ./qa.ps1 --dry-run --verbose       Dry run with details"
    Write-Host "  ./qa.ps1 --suite rules --json      Run rules tests with JSON output"
    Write-Host ""
}
else {
    & node qa-suite.js @Arguments
}

Pop-Location
