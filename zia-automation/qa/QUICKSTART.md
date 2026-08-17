# QA Suite Quick Start Guide

## Installation

The QA suite is included in the `qa/` directory. No additional installation is needed beyond the existing dependencies.

```bash
cd zia-automation
# Dependencies are already in package.json
npm install
```

## Basic Usage

### Run All Tests
```bash
node qa-suite.js
```

### Run Specific Test Suite
```bash
# API tests
node qa-suite.js --suite api

# Automation rules
node qa-suite.js --suite rules

# Data integrity
node qa-suite.js --suite data

# Validation
node qa-suite.js --suite validation

# Server
node qa-suite.js --suite server

# Performance
node qa-suite.js --suite performance
```

### Run with Options
```bash
# Dry-run (no data modifications)
node qa-suite.js --dry-run

# Verbose output with debug info
node qa-suite.js --verbose

# JSON output for parsing
node qa-suite.js --json

# Combine options
node qa-suite.js --suite rules --dry-run --verbose
```

### Quick Commands (Windows)
```batch
# Using batch file
qa.cmd
qa.cmd --suite api
qa.cmd --dry-run --verbose

# Using PowerShell
./qa.ps1
./qa.ps1 --suite data
./qa.ps1 --suite server
```

## Understanding Test Results

### Success Output
```
✓ API Health Check
✓ Authentication Token Validation
✓ Required Object Types Accessible
```

### Failure Output
```
✗ Claims Validation
  Found 2 claims failed: deals: 23/50; Companies: 5/20
```

### Summary Report
```
SUMMARY
=======
Total: 42 tests
  ✓ Passed:  40
  ✗ Failed:  2
  ⊘ Skipped: 0

Duration: 485.92s
Success Rate: 95.2%
```

## Report Files

Each test run generates a report:
- **qa-report.json** — Full results in JSON format
- Last report is always overwritten

### Report Structure
```json
{
  "startedAt": "2024-01-15T10:30:00.000Z",
  "finishedAt": "2024-01-15T10:35:00.000Z",
  "suites": {
    "api": {
      "name": "API Tests",
      "tests": [],
      "passed": 6,
      "failed": 0,
      "skipped": 0,
      "duration": 2847
    }
  },
  "summary": {
    "total": 42,
    "passed": 40,
    "failed": 2,
    "skipped": 0,
    "duration": 485923
  }
}
```

## Common Scenarios

### First Run
```bash
# Test API connectivity
node qa-suite.js --suite api --verbose
```

### After Seeding Data
```bash
# Validate data was imported correctly
node qa-suite.js --suite data
```

### Before Dashboard Rebuild
```bash
# Ensure system is in good state
node qa-suite.js --suite validation
```

### During Development
```bash
# Test specific rule
node qa-suite.js --suite rules --dry-run

# Monitor performance
node qa-suite.js --suite performance
```

### Scheduled Checks
```bash
# Full test run with JSON output for logging
node qa-suite.js --json > qa-$(date +%s).log 2>&1
```

## Configuration

Edit `qa/qa-config.json` to customize:

- **Timeouts** — how long tests wait before failing
- **Thresholds** — performance and volume requirements
- **Data volumes** — minimum data requirements
- **API endpoints** — required object types
- **Custom properties** — required zia_* fields

Example: Increase rule timeout
```json
{
  "qa": {
    "timeouts": {
      "rules": 900000
    }
  }
}
```

## Integration Examples

### With npm scripts
```json
{
  "scripts": {
    "test:qa": "node qa-suite.js",
    "test:qa:api": "node qa-suite.js --suite api",
    "test:qa:dry": "node qa-suite.js --dry-run",
    "test:qa:json": "node qa-suite.js --json"
  }
}
```

Use:
```bash
npm run test:qa
npm run test:qa:api
npm run test:qa:dry
```

### Scheduled Testing
```bash
# Add to crontab for Unix/Linux
0 2 * * * cd /path/to/HubSpot\ Demo/zia-automation && node qa-suite.js > qa-$(date +\%s).log 2>&1

# Add to Task Scheduler for Windows
# Run: schtasks /create /tn "QA-Test-Daily" /tr "c:\path\qa.cmd" /sc daily /st 02:00
```

### Pre-deployment Check
```bash
#!/bin/bash
set -e

echo "Running QA suite before deployment..."
node qa-suite.js --suite api
node qa-suite.js --suite validation
node qa-suite.js --suite rules

if [ $? -eq 0 ]; then
    echo "✓ All QA checks passed - safe to deploy"
    exit 0
else
    echo "✗ QA checks failed - deployment blocked"
    exit 1
fi
```

## Troubleshooting

### "API key not set" Error
```bash
# Set your HubSpot API key
export HUBSPOT_API_KEY=your_key_here

# On Windows (Command Prompt)
set HUBSPOT_API_KEY=your_key_here

# On Windows (PowerShell)
$env:HUBSPOT_API_KEY = "your_key_here"
```

### "Server not accessible" Warning
This is normal if the dashboard server isn't running. Start it with:
```bash
node server.js
```

### "No rules found" Error
Check that rules are in `rules/` directory:
```bash
ls -la rules/
# Should see: 01-lead-routing.js, 02-opportunity-lifecycle.js, etc.
```

### Slow Performance Tests
```bash
# Run without performance suite
node qa-suite.js --suite api,rules,data,validation,server

# Or increase timeout
# Edit qa-config.json and increase timeouts
```

## Next Steps

1. **Review the detailed README**: `qa/README.md`
2. **Check test configuration**: `qa/qa-config.json`
3. **Explore test modules**: `qa/test-*.js`
4. **Set up CI/CD**: See `CICD.md`
5. **Extend the suite**: Add custom tests to `qa/test-custom.js`

## Support

For issues:
1. Run with `--verbose` flag for detailed output
2. Check `qa-report.json` for full results
3. Review test source in `qa/test-*.js`
4. Check validation with `node validate.js`
