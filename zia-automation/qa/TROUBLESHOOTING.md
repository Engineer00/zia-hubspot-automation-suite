# QA Suite Troubleshooting Guide

Complete guide to resolving common issues with the QA test suite.

## API Tests Issues

### "HUBSPOT_API_KEY not set"

**Problem**: Tests fail because API key is not configured.

**Solution**:
```bash
# Linux/macOS
export HUBSPOT_API_KEY=your_private_app_key_here

# Windows (Command Prompt)
set HUBSPOT_API_KEY=your_private_app_key_here

# Windows (PowerShell)
$env:HUBSPOT_API_KEY = "your_private_app_key_here"

# Verify it's set
echo $HUBSPOT_API_KEY
```

**Prevention**: Add to shell profile or CI/CD secrets management.

---

### "Authentication failed - invalid or expired token"

**Problem**: API key is invalid or has expired.

**Solution**:
1. Go to HubSpot portal → Settings → Integrations → Private apps
2. Verify the private app still exists and is active
3. Copy the current access token
4. Update `HUBSPOT_API_KEY` environment variable
5. Re-run tests

**Prevention**:
- Store API key in secure vault (GitHub Secrets, AWS Secrets Manager)
- Rotate keys regularly
- Use scoped permissions (only needed endpoints)

---

### "Rate limiting detected"

**Problem**: API responses are slow or tests timeout due to rate limits.

**Causes**:
- Too many concurrent requests
- Running multiple QA instances
- Other processes hitting HubSpot API
- API quota exceeded

**Solutions**:
```bash
# Reduce concurrent requests - edit qa-config.json
{
  "performance": {
    "concurrentRequests": 3
  }
}

# Add delays between requests
# Increase timeouts
{
  "qa": {
    "timeouts": {
      "api": 60000
    }
  }
}

# Run tests sequentially instead of parallel
node qa-suite.js --suite api
node qa-suite.js --suite data
# (don't run concurrently)
```

**Prevention**:
- Check HubSpot API rate limits
- Use API key with appropriate rate limit tier
- Schedule QA tests during off-peak hours
- Implement exponential backoff

---

### "Invalid API response structure"

**Problem**: API response doesn't match expected format.

**Possible causes**:
- API schema changed
- Custom fields were deleted
- Object type no longer exists

**Debugging**:
```bash
# Test a single API call manually
node -e "
const {api} = require('./lib/hubspot');
api('GET', '/crm/v3/objects/contacts?limit=1')
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => console.error(e.message))
"
```

**Fix**:
- Update test to handle new response format
- Restore deleted custom properties
- Update qa-config.json with correct object types

---

## Rules Tests Issues

### "No rules found"

**Problem**: Automation rules can't be loaded.

**Debugging**:
```bash
ls -la zia-automation/rules/
# Should see 01-lead-routing.js through 15-stripe-reconciliation.js
```

**Solutions**:
- Verify rules directory exists: `zia-automation/rules/`
- Check files are properly named: `NN-name.js`
- Ensure rule files are executable
- Check Node.js can read the directory

---

### "Rule did not return a result object"

**Problem**: Rule execution doesn't return expected format.

**Debugging**:
```bash
# Run the specific rule directly
node -e "
const rule = require('./rules/01-lead-routing.js');
rule.run({dryRun: true})
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => console.error(e.message))
"
```

**Fix**:
- Check rule implementation returns an object
- Ensure rule doesn't throw errors
- Verify rule has `run` function

---

### "Idempotency check failed"

**Problem**: Rule produces different results on second run.

**Causes**:
- Rule logic is not idempotent
- External state changed between runs
- Rule modifies data incorrectly

**Debugging**:
```bash
# Run rule twice manually
node engine.js --only WF-03 --dry-run
node engine.js --only WF-03 --dry-run
# Check that output is identical
```

**Fix**:
- Review rule logic for side effects
- Ensure rule checks for existing state before modifying
- Fix rule to reconcile state rather than react to events

---

### "Execution timeout"

**Problem**: Rule takes too long to complete.

**Causes**:
- Large dataset being processed
- API is slow/rate-limited
- Database query is inefficient
- Network latency

**Solution**:
```bash
# Increase timeout in qa-config.json
{
  "qa": {
    "timeouts": {
      "rules": 900000
    }
  }
}

# Or run specific rule to see where it's slow
time node engine.js --only WF-03
```

**Optimization**:
- Batch API calls
- Optimize database queries
- Run during off-peak hours
- Split large operations

---

## Data Integrity Issues

### "Data volume below minimum"

**Problem**: Not enough data in CRM for testing.

**Solution**:
```bash
# Seed data into HubSpot
node zia_hubspot_demo/generate-seed.js
node zia_hubspot_demo/import_seed_batches.js

# Verify data was imported
node qa-suite.js --suite data
```

**Check minimum volumes** in `qa-config.json`:
```json
{
  "qa": {
    "thresholds": {
      "dataVolume": {
        "deals": 50,
        "contacts": 100,
        "companies": 20
      }
    }
  }
}
```

---

### "Found X issues: deals: invalid amount"

**Problem**: Data has invalid values.

**Debugging**:
```bash
# Query problematic records
node -e "
const {listAll} = require('./lib/hubspot');
listAll('deals', ['dealname', 'amount'])
  .then(deals => {
    deals.filter(d => isNaN(d.properties.amount))
    .forEach(d => console.log(d.id, d.properties.dealname, d.properties.amount))
  })
"
```

**Fix**:
1. Export data: `node qa-suite.js --suite data > issues.txt`
2. Review HubSpot UI for invalid values
3. Correct via API or manual cleanup
4. Re-run data tests to verify

---

### "Health score out of range"

**Problem**: Custom property values are outside acceptable range.

**Solution**:
```bash
# Bulk update via API
const {api} = require('./lib/hubspot');

// Fix scores > 100
const deals = /* get deals with bad scores */;
for (const deal of deals) {
  const score = Math.min(100, parseInt(deal.properties.zia_health_score || 0));
  await api('PATCH', `/crm/v3/objects/deals/${deal.id}`, {
    properties: { zia_health_score: score }
  });
}
```

---

## Validation Issues

### "Validation script not found"

**Problem**: validate.js is missing or corrupted.

**Solution**:
```bash
# Check file exists
ls -la zia-automation/validate.js

# If missing, restore from git
git checkout zia-automation/validate.js

# If corrupted, verify structure
grep -c "function" zia-automation/validate.js
```

---

### "Dashboard data is stale"

**Problem**: dashboard-data.json is more than 24 hours old.

**Solution**:
```bash
# Regenerate snapshot
node snapshot.js

# Verify it was created
ls -la dashboard-data.json
date

# Build updated dashboard
node build-dashboard.js
```

**Prevention**:
- Run snapshot regularly: `node server.js --every 60`
- Or schedule snapshot: `0 * * * * node snapshot.js`

---

### "All date fields are consistent" - but tests fail

**Problem**: Date parsing succeeds but data logic is wrong.

**Debugging**:
```bash
# Export deals with date issues
node -e "
const {listAll} = require('./lib/hubspot');
listAll('deals', ['zia_embed_start_date', 'zia_embed_end_date'])
  .then(deals => {
    deals.filter(d => {
      const start = new Date(d.properties.zia_embed_start_date);
      const end = new Date(d.properties.zia_embed_end_date);
      return end < start;
    }).forEach(d => console.log(d.id, d.properties.zia_embed_start_date, d.properties.zia_embed_end_date))
  })
"
```

---

## Server Tests Issues

### "Dashboard server is not accessible"

**Problem**: Server tests fail because server isn't running.

**This is normal** — the server is optional. Start it with:
```bash
node server.js
node server.js --port 8000
node server.js --every 30  # Refresh every 30 minutes
```

---

### "Dashboard template is invalid"

**Problem**: HTML template is missing or corrupted.

**Solution**:
```bash
# Verify file exists and has content
wc -l zia-command-deck.html
grep -c "<html" zia-command-deck.html
grep -c "<script" zia-command-deck.html

# Rebuild if needed
node build-dashboard.js
```

---

### "Response time exceeded"

**Problem**: Server responses are slow (>1 second).

**Causes**:
- Server is refreshing data in background
- Large dataset being processed
- Slow network
- Low system memory

**Solution**:
- First refresh takes longer (pulls from HubSpot)
- Subsequent requests use cache
- Wait for first refresh to complete
- Check available system memory: `free -h` or Task Manager

---

## Performance Issues

### "Snapshot pull took X seconds (threshold: 5m)"

**Problem**: Data retrieval is slow.

**Causes**:
- Large dataset (>1000 records)
- Network latency
- API rate limiting
- API is overloaded

**Solutions**:
```bash
# Optimize snapshot pull
# In snapshot.js, reduce property list to only needed fields

// Increase timeout in qa-config.json
{
  "qa": {
    "thresholds": {
      "snapshotPullTime": 600000
    }
  }
}

# Run during off-peak hours
crontab -e
# Schedule: 0 2 * * * node qa-suite.js  # 2 AM daily
```

---

### "Memory usage: X MB (threshold: 500MB)"

**Problem**: Process uses too much memory.

**Causes**:
- Large datasets loaded into memory
- Memory leak in code
- Node.js heap size too large

**Solution**:
```bash
# Increase Node.js heap size
NODE_OPTIONS="--max-old-space-size=2048" node qa-suite.js

# Or adjust threshold in qa-config.json
{
  "qa": {
    "thresholds": {
      "memoryUsage": 1000
    }
  }
}
```

---

### "5 concurrent requests failed"

**Problem**: Parallel requests fail.

**Solution**:
```bash
# Reduce concurrency in qa-config.json
{
  "performance": {
    "concurrentRequests": 3
  }
}

# Or run tests sequentially
node qa-suite.js --suite api
# Wait for completion
node qa-suite.js --suite data
```

---

## Configuration Issues

### "Missing properties in qa-config.json"

**Problem**: Tests fail with config errors.

**Solution**:
1. Restore default config: `git checkout qa/qa-config.json`
2. Or create new one from template
3. Verify JSON syntax: `node -e "require('./qa/qa-config.json')"`

---

### "Unrecognized configuration option"

**Problem**: Tests don't use custom config.

**Check**:
- Ensure you're editing the right file: `qa/qa-config.json`
- Verify JSON syntax is valid
- Restart Node process after editing

---

## Environment Issues

### "ENOENT: no such file or directory"

**Problem**: Tests can't find required files.

**Debugging**:
```bash
# Verify file exists
ls -la lib/hubspot.js
ls -la snapshot.js
ls -la rules/
ls -la qa/test-*.js
```

**Solutions**:
- Check working directory: `pwd`
- Navigate to correct folder: `cd zia-automation`
- Restore missing files from git

---

### "Cannot find module 'dotenv'"

**Problem**: Dependencies not installed.

**Solution**:
```bash
cd zia-automation
npm install
npm list dotenv  # Verify it's installed
```

---

### "EACCES: permission denied"

**Problem**: No permission to read/write files.

**Solution**:
```bash
# Check permissions
ls -l qa/qa.cmd qa/qa.ps1

# Fix permissions (Unix/Linux/macOS)
chmod +x qa/qa.ps1
chmod +x *.js

# Or run with sudo (not recommended)
# sudo node qa-suite.js
```

---

## Report Issues

### "qa-report.json is empty"

**Problem**: Report file exists but has no content.

**Causes**:
- Tests didn't run properly
- Report wasn't written
- Disk full

**Solution**:
```bash
# Check if tests actually ran
node qa-suite.js --verbose

# Check disk space
df -h  # Unix/Linux/macOS
diskpart  # Windows

# Verify write permissions
touch qa-report.json  # Can you create files?
```

---

### "Cannot parse qa-report.json"

**Problem**: Report is corrupted.

**Solution**:
```bash
# Validate JSON
node -e "JSON.parse(require('fs').readFileSync('qa-report.json'))"

# If invalid, re-run tests
node qa-suite.js --json > qa-report.json

# Or check permissions
ls -l qa-report.json
```

---

## Getting Help

### Debug Information to Collect

When reporting issues, include:

1. **Output with verbose flag**:
   ```bash
   node qa-suite.js --verbose 2>&1 | tee debug.log
   ```

2. **Environment info**:
   ```bash
   node --version
   npm --version
   echo $HUBSPOT_API_KEY | wc -c  # Key length (should be >30)
   ```

3. **Configuration**:
   ```bash
   cat qa/qa-config.json
   ```

4. **Report file**:
   ```bash
   cat qa-report.json
   ```

5. **System info**:
   ```bash
   uname -a  # Unix/Linux/macOS
   systeminfo  # Windows
   ```

---

## Prevention Checklist

- [ ] API key is set and current
- [ ] Minimum data volume is seeded
- [ ] Node.js is updated (v18+)
- [ ] Dependencies installed: `npm ci`
- [ ] Sufficient disk space
- [ ] Network connectivity verified
- [ ] HubSpot API accessible
- [ ] Custom properties exist in CRM
- [ ] Automation rules are in place
- [ ] Dashboard data is fresh
- [ ] Configuration is valid JSON

---

## Still Stuck?

1. Review test source: `qa/test-*.js`
2. Check validation logic: `validate.js`
3. Run engine directly: `node engine.js --list`
4. Test API manually: `node -e "require('./lib/hubspot').api('GET', '/crm/v3/objects/contacts?limit=1')"`
5. Check HubSpot documentation for API changes
6. Review GitHub issues for similar problems
7. Contact HubSpot support for API issues
