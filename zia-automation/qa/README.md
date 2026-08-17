# ZIA QA Test Suite

Comprehensive quality assurance testing for the HubSpot demo system.

## Quick Start

```bash
# Run all tests
node qa-suite.js

# Run a specific test suite
node qa-suite.js --suite api
node qa-suite.js --suite rules
node qa-suite.js --suite data
node qa-suite.js --suite validation
node qa-suite.js --suite server
node qa-suite.js --suite performance

# Dry-run (no data modifications)
node qa-suite.js --dry-run

# Verbose output
node qa-suite.js --verbose

# JSON report output
node qa-suite.js --json
```

## Test Suites

### API Tests (`--suite api`)
Tests HubSpot API connectivity, authentication, and data access.

**Tests:**
- API Health Check — validates API endpoint responds correctly
- Authentication Token Validation — checks HUBSPOT_API_KEY is valid
- Required Object Types Accessible — verifies all needed CRM objects are accessible
- Custom Properties Exist — ensures all zia_* custom properties are present
- Rate Limiting Check — detects API rate limiting
- Object Associations Working — validates relationship data is queryable

**Duration:** ~30 seconds

### Automation Rules Tests (`--suite rules`)
Tests all 15 automation rules (WF-01 through WF-15).

**Tests (per rule):**
- Rule Structure — validates rule has required properties
- Dry Run — executes rule in read-only mode
- Execution Time — ensures rule completes within timeout
- Compliance — checks output format matches expectations
- Idempotency Check — verifies rule produces no writes on second run (when not in dry-run)

**Duration:** ~5-10 minutes (depends on data volume)

### Data Integrity Tests (`--suite data`)
Validates data consistency, relationships, and field compliance.

**Tests:**
- Data Volume Requirements — checks minimum data thresholds
- Deals Data Integrity — validates all deal records
- Contacts Data Integrity — validates all contact records
- Custom Property Consistency — checks zia_* properties have valid values
- Date Field Consistency — validates all date fields are properly formatted
- Association Integrity — checks object relationships are valid
- Referential Integrity — ensures referenced objects exist

**Duration:** ~2-3 minutes

### Validation Tests (`--suite validation`)
Tests validation logic for claims, drift detection, and page accuracy.

**Tests:**
- Validation Script Integrity — ensures validate.js is complete
- HTML Pages Availability — checks all published pages exist
- Snapshot Generation — validates snapshot pull and compute
- Claims Validation — re-derives narrative claims from live data
- Snapshot Consistency — checks multiple snapshots match
- Dashboard Data File — validates dashboard-data.json exists and is fresh
- Metrics Accuracy — checks aggregated metrics match derived values

**Duration:** ~3-5 minutes

### Server Tests (`--suite server`)
Tests dashboard server functionality and configuration.

**Tests:**
- Server Configuration — validates server.js setup
- Dashboard Template — checks zia-command-deck.html structure
- Data File Synchronization — ensures dashboard-data.json is current
- Server Accessibility — checks server is running on port 4000
- Server Health Endpoint — tests /health endpoint
- Content Type — validates HTML content type
- Response Time — checks response times are acceptable
- API Endpoints — verifies /api/* endpoints are available

**Duration:** ~5 seconds (or skipped if server not running)

### Performance Tests (`--suite performance`)
Tests performance metrics and resource usage.

**Tests:**
- Snapshot Pull Performance — measures data retrieval speed
- Snapshot Compute Performance — measures aggregation speed
- Data Fetch Performance — measures individual object fetch times
- File I/O Performance — checks file read and parse speed
- Pagination Performance — measures API pagination efficiency
- Memory Usage — checks heap memory consumption
- Concurrent Request Handling — tests parallel API calls
- Rate Limit Handling — detects and reports rate limiting

**Duration:** ~5-10 minutes

## Test Report

After running, a report is saved to `qa-report.json` containing:

```json
{
  "startedAt": "2024-01-15T10:30:00.000Z",
  "finishedAt": "2024-01-15T10:35:00.000Z",
  "suites": {
    "api": {
      "name": "API Tests",
      "tests": [
        {
          "name": "API Health Check",
          "passed": true,
          "note": "API responding (145ms)"
        }
      ],
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

## Integration with CI/CD

### GitHub Actions

```yaml
name: QA Tests

on: [push, pull_request]

jobs:
  qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: cd zia-automation && npm install
      
      - name: Run QA Suite
        env:
          HUBSPOT_API_KEY: ${{ secrets.HUBSPOT_API_KEY }}
        run: cd zia-automation && node qa-suite.js --json
      
      - name: Upload report
        uses: actions/upload-artifact@v2
        if: always()
        with:
          name: qa-report
          path: zia-automation/qa-report.json
```

## Troubleshooting

### API Tests Fail
- Check `HUBSPOT_API_KEY` environment variable is set
- Verify API key is not expired
- Check HubSpot API rate limits

### Rules Tests Fail
- Run individual rule: `node engine.js --only WF-01`
- Check rule dependencies are satisfied
- Review rule implementation for errors

### Data Tests Fail
- Verify seed data has been imported
- Run: `node zia_hubspot_demo/generate-seed.js`
- Check for data corruption with: `node validate.js --claims`

### Server Tests Fail
- Start server: `node server.js`
- Verify port 4000 is not in use
- Check dashboard-data.json exists and is current

### Performance Tests Slow
- Check network connectivity
- Verify HubSpot API not rate-limited
- Check available memory on system

## Continuous Testing

For scheduled testing:

```bash
# Every day at 2 AM
0 2 * * * cd /path/to/HubSpot Demo/zia-automation && node qa-suite.js > qa-$(date +%s).log 2>&1
```

## Extending the QA Suite

To add new tests:

1. Create a new test module in `qa/test-*.js`
2. Export an object with `name` and `run` function:

```javascript
module.exports = {
  name: 'My Custom Tests',
  run: async (context) => {
    const tests = [];
    
    tests.push({
      name: 'My test',
      passed: true,
      note: 'Test passed',
    });
    
    return tests;
  },
};
```

3. Register in `qa-suite.js`:

```javascript
const customTests = require('./qa/test-custom');
const TEST_SUITES = {
  // ... existing suites
  custom: customTests,
};
```

## Reference

- [ZIA Automation Architecture](./zia-architecture.html)
- [System Document](./zia-system-document.html)
- [Validation Logic](./validate.js)
- [Engine Implementation](./engine.js)
- [Snapshot Logic](./snapshot.js)
