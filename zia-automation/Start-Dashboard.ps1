<#
    ZIA Command Deck — launcher

    Starts the local dashboard server and opens it in your browser.
    The server holds the HubSpot token; the browser only ever talks to localhost.

    Usage
        Right-click this file -> "Run with PowerShell"
        or double-click Start-Dashboard.cmd (which calls this)

        .\Start-Dashboard.ps1                 port 4000, refresh every 30 min
        .\Start-Dashboard.ps1 -Port 8080
        .\Start-Dashboard.ps1 -EveryMinutes 15
        .\Start-Dashboard.ps1 -NoAuto         manual refresh only

    Close the window, or press Ctrl+C, to stop the server.
#>
[CmdletBinding()]
param(
    [int]    $Port         = 4000,
    [int]    $EveryMinutes = 30,
    [switch] $NoAuto
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host ''
Write-Host '  ZIA Command Deck' -ForegroundColor Cyan
Write-Host '  ----------------' -ForegroundColor Cyan

# --- prerequisites -------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Host '  Node.js is not installed or not on PATH.' -ForegroundColor Red
    Write-Host '  Install it from https://nodejs.org and run this again.'
    Read-Host '  Press Enter to close'
    exit 1
}

$keyFile = Join-Path (Split-Path -Parent $here) 'hubspot_service_key.txt'
if (-not (Test-Path $keyFile)) {
    Write-Host "  Missing credential file: $keyFile" -ForegroundColor Red
    Write-Host '  The dashboard cannot reach HubSpot without it.'
    Read-Host '  Press Enter to close'
    exit 1
}

# --- is the port already in use? -----------------------------------------
$inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($inUse) {
    Write-Host "  Port $Port is already in use — the dashboard may already be running." -ForegroundColor Yellow
    Write-Host "  Opening http://localhost:$Port anyway."
    Start-Process "http://localhost:$Port"
    Read-Host '  Press Enter to close'
    exit 0
}

# --- build the argument list ---------------------------------------------
$serverArgs = @('server.js', '--port', $Port)
if ($NoAuto) { $serverArgs += '--no-auto' }
else         { $serverArgs += @('--every', $EveryMinutes) }

Write-Host "  Starting on http://localhost:$Port"
if ($NoAuto) { Write-Host '  Auto-refresh: off (use the Refresh button on the page)' }
else         { Write-Host "  Auto-refresh: every $EveryMinutes minutes" }
Write-Host '  Press Ctrl+C to stop.'
Write-Host ''

# Open the browser once the server is actually listening, rather than after a
# blind sleep — a cold snapshot pull can take a couple of minutes.
$opener = Start-Job -ScriptBlock {
    param($p)
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        $ok = Test-NetConnection -ComputerName '127.0.0.1' -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue
        if ($ok) { Start-Process "http://localhost:$p"; return }
    }
} -ArgumentList $Port

try {
    # Runs in the foreground so this window shows the server log and Ctrl+C stops it.
    & node $serverArgs
}
finally {
    Remove-Job $opener -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host '  Dashboard stopped.' -ForegroundColor Cyan
}
