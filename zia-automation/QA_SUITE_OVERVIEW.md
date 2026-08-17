# ZIA QA Test Suite - Complete Documentation

A comprehensive, production-grade quality assurance testing system for the HubSpot demo automation platform.

## Overview

The QA suite tests:
- **API Connectivity**: HubSpot API health, authentication, and data access
- **Automation Rules**: All 15 automation rules (WF-01 to WF-15) for functionality and idempotency
- **Data Integrity**: Data consistency, relationships, and field validation
- **Validation**: Claims verification, drift detection, and page accuracy
- **Dashboard Server**: Server functionality, templates, and performance
- **Performance**: Load times, memory usage, concurrency, and throughput

## Files Created

### Main Test Runner
- **qa-suite.js** (250 lines)
  - Main test orchestration engine
  - Runs all test suites sequentially
  - Generates JSON reports
  - Provides console output and logging

### Test Modules (6 suites, ~450 lines each)
1. **qa/test-api.js** — HubSpot API connectivity tests
   - API health check
   - Authentication validation
   - Required objects accessible
   - Custom properties existence
   - Rate limit detection
   - Object associations

2. **qa/test-rules.js** — Automation rules tests
   - Rule structure validation
   - Dry-run execution
   - Idempotency verification
   - Error handling
   - Execution time performance
   - Engine integration

3. **qa/test-data.js** — Data integrity tests
   - Data volume validation
   - Deals integrity checks
   - Contacts integrity checks
   - Custom property consistency
   - Date field validation
   - Association integrity
   - Referential integrity

4. **qa/test-validation.js** — Validation logic tests
   - Snapshot generation
   - Claims validation
   - Snapshot consistency
   - Dashboard data file checks
   - HTML pages availability
   - Metrics accuracy

5. **qa/test-server.js** — Dashboard server tests
   - Server accessibility
   - Health endpoints
   - Content type validation
   - Response time checks
   - API endpoints availability
   - Configuration validation
   - Template integrity
   - Data synchronization

6. **qa/test-performance.js** — Performance tests
   - Snapshot pull performance
   - Compute performance
   - Data fetch performance
   - Memory usage monitoring
   - Concurrent request handling
   - Pagination efficiency
   - File I/O performance
   - Rate limit handling

### Utilities & Configuration
- **qa/utils.js** (300+ lines)
  - TestResult class for consistent test output
  - retry() — exponential backoff retry logic
  - withTimeout() — timeout wrapper
  - measureTime() — timing utilities
  - Validation helpers (ranges, required fields, tolerance)
  - Date and email validation
  - Config management functions

- **qa/qa-config.json** (200+ lines)
  - Test timeouts and thresholds
  - Data volume requirements
  - Custom property definitions
  - API rate limits
  - Performance benchmarks
  - Tolerance levels

### Documentation
- **qa/README.md** (400+ lines)
  - Complete test suite reference
  - All test descriptions
  - Test duration estimates
  - Integration examples
  - CI/CD setup
  - Extension guide

- **qa/QUICKSTART.md** (300+ lines)
  - Quick reference guide
  - Basic usage examples
  - Report format
  - Configuration tips
  - Common scenarios
  - Troubleshooting quick links

- **qa/CICD.md** (400+ lines)
  - GitHub Actions workflows
  - Jenkins pipeline examples
  - GitLab CI configuration
  - Azure Pipelines setup
  - Pre-deployment gates
  - Slack notifications
  - Test report parsing

- **qa/TROUBLESHOOTING.md** (500+ lines)
  - Detailed problem solutions
  - Debug procedures
  - Common causes and fixes
  - Environment setup
  - Performance optimization
  - Prevention checklist

### Quick Start Scripts
- **qa/qa.cmd** — Windows batch runner
- **qa/qa.ps1** — Windows PowerShell runner

## Usage Examples

### Quick Start
```bash
cd zia-automation

# Run all tests
node qa-suite.js

# Run specific suite
node qa-suite.js --suite api
node qa-suite.js --suite rules
node qa-suite.js --suite data
node qa-suite.js --suite validation
node qa-suite.js --suite server
node qa-suite.js --suite performance

# Dry-run (no modifications)
node qa-suite.js --dry-run

# Verbose output
node qa-suite.js --verbose

# JSON output
node qa-suite.js --json

# Windows runners
qa.cmd
qa.cmd --suite api
./qa.ps1 --suite data
```

### Complete Testing Workflow
```bash
# 1. Verify API connectivity
node qa-suite.js --suite api --verbose

# 2. Check data integrity
node qa-suite.js --suite data

# 3. Test all automation rules
node qa-suite.js --suite rules --dry-run

# 4. Validate system state
node qa-suite.js --suite validation

# 5. Check performance
node qa-suite.js --suite performance

# 6. Full regression test
node qa-suite.js
```

## Test Statistics

| Suite | Tests | Avg Duration | Coverage |
|-------|-------|--------------|----------|
| API | 6 | ~30s | Connectivity, auth, objects, properties, rate limits |
| Rules | 35 | ~5-10m | 15 rules × structure, dry-run, timing, compliance |
| Data | 7 | ~2-3m | Deals, contacts, properties, dates, associations |
| Validation | 7 | ~3-5m | Snapshots, claims, consistency, pages |
| Server | 8 | ~5s | Config, template, files, endpoints, performance |
| Performance | 8 | ~5-10m | Pull, compute, fetch, I/O, concurrency, limits |
| **Total** | **71** | **~25-35m** | **Complete system coverage** |

## Test Report Format

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
          "duration": 145,
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
    "total": 71,
    "passed": 69,
    "failed": 2,
    "skipped": 0,
    "duration": 485923
  }
}
```

## Key Features

✅ **Comprehensive Coverage**
- 71 individual tests across 6 suites
- API, automation, data, validation, server, and performance testing
- Full system regression testing

✅ **Production Ready**
- Robust error handling and timeouts
- Detailed reporting and diagnostics
- CI/CD integration examples
- Extensive documentation

✅ **Flexible Execution**
- Run all tests or specific suites
- Dry-run mode (no data modifications)
- Parallel or sequential execution
- Verbose or quiet output

✅ **Easy Integration**
- GitHub Actions, Jenkins, GitLab CI, Azure Pipelines
- Slack notifications
- Pre-deployment gates
- Scheduled testing support

✅ **Well Documented**
- 2000+ lines of documentation
- Quick start guide
- Troubleshooting reference
- CI/CD setup examples
- API reference

✅ **Extensible Design**
- Easy to add new test modules
- Utility functions for common patterns
- Configurable thresholds and timeouts
- Template-based test creation

## Configuration

All thresholds and settings in `qa/qa-config.json`:

```json
{
  "qa": {
    "timeouts": {
      "api": 30000,
      "rules": 600000,
      "data": 300000,
      "validation": 300000,
      "server": 5000,
      "performance": 600000
    },
    "thresholds": {
      "apiResponseTime": 1000,
      "dataVolume": {
        "deals": 50,
        "contacts": 100,
        "companies": 20
      }
    }
  }
}
```

## Environment Setup

```bash
# 1. Install dependencies
cd zia-automation
npm install

# 2. Set API key
export HUBSPOT_API_KEY=your_private_app_key

# 3. Run tests
node qa-suite.js
```

## CI/CD Integration

### GitHub Actions
```yaml
- name: Run QA Tests
  env:
    HUBSPOT_API_KEY: ${{ secrets.HUBSPOT_API_KEY }}
  run: node qa-suite.js --json
```

### Jenkins
```groovy
stage('QA Tests') {
  steps {
    sh 'node qa-suite.js'
  }
}
```

### GitLab CI
```yaml
qa_tests:
  script:
    - node qa-suite.js --json
```

## Monitoring & Alerting

Reports saved to `qa-report.json` for:
- Trend analysis
- Dashboards (Grafana, Datadog)
- Alerting (Slack, email)
- Archival and audit

## Support & Troubleshooting

- **Quick Issues**: See QUICKSTART.md
- **Detailed Help**: See TROUBLESHOOTING.md
- **Debug Output**: Run with `--verbose` flag
- **Configuration**: Edit `qa-config.json`
- **API Issues**: Check `validate.js` and `snapshot.js`

## Next Steps

1. **Install**: `npm install` in zia-automation
2. **Configure**: Set `HUBSPOT_API_KEY` environment variable
3. **Run**: `node qa-suite.js`
4. **Review**: Check `qa-report.json`
5. **Integrate**: Follow CICD.md for automation setup
6. **Extend**: Add custom tests using template in README.md

## File Manifest

```
zia-automation/qa/
├── README.md                    # Complete reference guide
├── QUICKSTART.md               # Quick start guide
├── CICD.md                     # CI/CD integration guide
├── TROUBLESHOOTING.md          # Troubleshooting guide
├── qa-config.json              # Test configuration
├── utils.js                    # Test utilities
├── qa.cmd                      # Windows batch runner
├── qa.ps1                      # Windows PowerShell runner
├── test-api.js                 # API tests
├── test-rules.js               # Automation rules tests
├── test-data.js                # Data integrity tests
├── test-validation.js          # Validation tests
├── test-server.js              # Server tests
└── test-performance.js         # Performance tests

zia-automation/
└── qa-suite.js                 # Main test runner
```

## License & Attribution

This QA suite is part of the ZIA (HubSpot automation demo) project.
Fully documented and production-ready.

---

**For detailed information, start with QUICKSTART.md or README.md**
