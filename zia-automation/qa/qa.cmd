#!/usr/bin/env node
@echo off
REM QA Test Suite Runner for Windows
REM Quick way to run QA tests

cd /d "%~dp0"

if "%1"=="" (
    echo Running full QA suite...
    node qa-suite.js %*
) else if "%1"=="--help" (
    echo.
    echo QA Test Suite Runner
    echo.
    echo Usage: qa.cmd [options]
    echo.
    echo Options:
    echo   --suite [name]     Run specific suite (api, rules, data, validation, server, performance)
    echo   --dry-run          Do not modify any data
    echo   --verbose          Detailed output
    echo   --json             JSON report output
    echo   --help             Show this help
    echo.
    echo Examples:
    echo   qa.cmd                           Run all tests
    echo   qa.cmd --suite api               Run API tests only
    echo   qa.cmd --dry-run --verbose       Dry run with details
    echo   qa.cmd --suite rules --json      Run rules tests with JSON output
    echo.
) else (
    node qa-suite.js %*
)
