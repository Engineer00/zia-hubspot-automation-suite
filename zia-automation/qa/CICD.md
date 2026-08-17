# CI/CD Integration Guide

Integrate the QA suite into your continuous integration and deployment pipelines.

## GitHub Actions

### Basic Workflow

Create `.github/workflows/qa-tests.yml`:

```yaml
name: QA Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'zia-automation/**'
      - '.github/workflows/qa-tests.yml'
  pull_request:
    branches: [main]

jobs:
  qa:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: 'zia-automation/package-lock.json'
      
      - name: Install dependencies
        run: npm ci
        working-directory: zia-automation
      
      - name: Run QA Suite
        env:
          HUBSPOT_API_KEY: ${{ secrets.HUBSPOT_API_KEY }}
        run: node qa-suite.js --json
        working-directory: zia-automation
      
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: qa-report-${{ github.run_id }}
          path: zia-automation/qa-report.json
          retention-days: 30
      
      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const report = JSON.parse(fs.readFileSync('zia-automation/qa-report.json', 'utf8'));
            const summary = report.summary;
            const failedTests = Object.values(report.suites)
              .flatMap(s => s.tests)
              .filter(t => !t.passed && !t.skipped);
            
            let comment = `## QA Test Results\n\n`;
            comment += `- **Total**: ${summary.total} tests\n`;
            comment += `- **Passed**: ${summary.passed} ✓\n`;
            comment += `- **Failed**: ${summary.failed} ✗\n`;
            comment += `- **Skipped**: ${summary.skipped} ⊘\n`;
            comment += `- **Duration**: ${(summary.duration / 1000).toFixed(2)}s\n`;
            comment += `- **Success Rate**: ${((summary.passed / (summary.total - summary.skipped)) * 100).toFixed(1)}%\n\n`;
            
            if (failedTests.length > 0) {
              comment += `### Failed Tests\n`;
              failedTests.forEach(t => {
                comment += `- ${t.name}${t.error ? `: ${t.error}` : ''}\n`;
              });
            }
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

### Suite-Specific Workflows

```yaml
name: API Tests

on:
  push:
    paths:
      - 'zia-automation/lib/**'
      - 'zia-automation/qa/test-api.js'

jobs:
  api-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
        working-directory: zia-automation
      
      - name: Run API Tests
        env:
          HUBSPOT_API_KEY: ${{ secrets.HUBSPOT_API_KEY }}
        run: node qa-suite.js --suite api
        working-directory: zia-automation
```

### Scheduled Tests

```yaml
name: Scheduled QA Tests

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC

jobs:
  scheduled-qa:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
        working-directory: zia-automation
      
      - name: Run full QA suite
        env:
          HUBSPOT_API_KEY: ${{ secrets.HUBSPOT_API_KEY }}
        run: node qa-suite.js --json
        working-directory: zia-automation
      
      - name: Archive results
        if: always()
        run: |
          mkdir -p qa-reports
          cp zia-automation/qa-report.json qa-reports/$(date +%s).json
      
      - name: Push results
        if: always()
        run: |
          git config user.name "QA Bot"
          git config user.email "qa@example.com"
          git add qa-reports/
          git diff --quiet && git diff --staged --quiet || git commit -m "QA report $(date)"
          git push
```

## GitHub Secrets Setup

Add required secrets to your GitHub repository:

1. Go to Settings → Secrets and variables → Actions
2. Add `HUBSPOT_API_KEY` with your HubSpot private app key

## Jenkins Pipeline

```groovy
pipeline {
    agent any
    
    environment {
        HUBSPOT_API_KEY = credentials('hubspot-api-key')
    }
    
    stages {
        stage('Setup') {
            steps {
                sh '''
                    cd zia-automation
                    npm ci
                '''
            }
        }
        
        stage('QA Tests') {
            parallel {
                stage('API Tests') {
                    steps {
                        sh 'cd zia-automation && node qa-suite.js --suite api'
                    }
                }
                stage('Data Tests') {
                    steps {
                        sh 'cd zia-automation && node qa-suite.js --suite data'
                    }
                }
                stage('Validation') {
                    steps {
                        sh 'cd zia-automation && node qa-suite.js --suite validation'
                    }
                }
            }
        }
        
        stage('Performance Tests') {
            steps {
                sh 'cd zia-automation && node qa-suite.js --suite performance'
            }
        }
    }
    
    post {
        always {
            archiveArtifacts artifacts: 'zia-automation/qa-report.json'
            junit 'zia-automation/qa-report.json'
        }
        
        failure {
            emailext(
                subject: 'QA Tests Failed',
                body: 'QA test suite failed. Check build logs.',
                to: '${DEFAULT_RECIPIENTS}'
            )
        }
    }
}
```

## GitLab CI

```yaml
stages:
  - test
  - deploy

variables:
  NODE_VERSION: "18"

qa_tests:
  stage: test
  image: node:18
  
  before_script:
    - cd zia-automation
    - npm ci
  
  script:
    - node qa-suite.js --json
  
  artifacts:
    reports:
      junit: qa-report.json
    paths:
      - zia-automation/qa-report.json
    expire_in: 30 days
  
  only:
    - merge_requests
    - main
    - develop

qa_nightly:
  stage: test
  image: node:18
  
  before_script:
    - cd zia-automation
    - npm ci
  
  script:
    - node qa-suite.js --suite performance
    - node qa-suite.js --suite rules
  
  only:
    - schedules
```

## Azure Pipelines

```yaml
trigger:
  - main
  - develop

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '18.x'
    displayName: 'Install Node.js'
  
  - script: npm ci
    workingDirectory: zia-automation
    displayName: 'Install dependencies'
  
  - script: node qa-suite.js --json
    workingDirectory: zia-automation
    env:
      HUBSPOT_API_KEY: $(HUBSPOT_API_KEY)
    displayName: 'Run QA Tests'
  
  - task: PublishBuildArtifacts@1
    inputs:
      pathToPublish: 'zia-automation/qa-report.json'
      artifactName: 'qa-report'
    displayName: 'Publish QA Report'
    condition: always()
```

## Pre-deployment Gate

```yaml
# GitHub Actions deployment protection
name: Pre-Deployment QA Gate

on:
  workflow_run:
    workflows: ["Build"]
    types: [completed]

jobs:
  qa-gate:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
        working-directory: zia-automation
      
      - name: Run QA Gate
        env:
          HUBSPOT_API_KEY: ${{ secrets.HUBSPOT_API_KEY }}
        run: |
          node qa-suite.js --suite api
          node qa-suite.js --suite validation
          exit $?
        working-directory: zia-automation
      
      - name: Block deployment if QA fails
        if: failure()
        run: |
          echo "❌ QA tests failed - deployment blocked"
          exit 1
```

## Slack Notifications

```yaml
# GitHub Actions with Slack
- name: Send Slack notification
  if: always()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "QA Test Results",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*QA Test Results*\n*Status*: ${{ job.status }}\n*Tests*: ${{ env.TOTAL }} (✓ ${{ env.PASSED }}, ✗ ${{ env.FAILED }})"
            }
          }
        ]
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
    SLACK_WEBHOOK_TYPE: INCOMING_WEBHOOK
```

## Test Report Parsing

### Extract Results for Display

```bash
#!/bin/bash

# Extract summary from report
report=$(cat qa-report.json)

total=$(echo "$report" | jq '.summary.total')
passed=$(echo "$report" | jq '.summary.passed')
failed=$(echo "$report" | jq '.summary.failed')
duration=$(echo "$report" | jq '.summary.duration')

echo "QA Test Results"
echo "==============="
echo "Total:    $total"
echo "Passed:   $passed ✓"
echo "Failed:   $failed ✗"
echo "Duration: $((duration / 1000))s"

exit $failed
```

### Trending Over Time

```python
#!/usr/bin/env python3
import json
import glob
from datetime import datetime

reports = []
for file in sorted(glob.glob("qa-reports/*.json")):
    with open(file) as f:
        data = json.load(f)
        reports.append({
            "date": data["finishedAt"],
            "passed": data["summary"]["passed"],
            "failed": data["summary"]["failed"],
            "total": data["summary"]["total"]
        })

print("Date,Passed,Failed,Total,SuccessRate")
for r in reports:
    rate = (r["passed"] / (r["total"] - 0)) * 100 if r["total"] > 0 else 0
    print(f"{r['date']},{r['passed']},{r['failed']},{r['total']},{rate:.1f}")
```

## Customizing CI/CD

### Environment-specific Configuration

```yaml
env:
  QA_SUITE: ${{ github.ref == 'refs/heads/main' && 'api,rules,data,validation,server,performance' || 'api,rules,data,validation' }}
  QA_TIMEOUTS: ${{ github.ref == 'refs/heads/main' && '600000' || '300000' }}
```

### Failure Handling

```bash
#!/bin/bash
set -e

echo "Running QA tests..."
node qa-suite.js --json || {
    exitcode=$?
    echo "QA tests failed with code $exitcode"
    
    # Post to monitoring
    curl -X POST https://monitoring.example.com/qa-failure \
        -d @qa-report.json
    
    exit $exitcode
}
```

## Troubleshooting CI/CD

### Common Issues

**API Key Not Found**
```yaml
- name: Verify secrets
  run: test ! -z "$HUBSPOT_API_KEY" || exit 1
  env:
    HUBSPOT_API_KEY: ${{ secrets.HUBSPOT_API_KEY }}
```

**Timeout Issues**
- Increase job timeout in CI/CD settings
- Run smaller test suites in parallel
- Optimize test configuration in `qa-config.json`

**Rate Limiting**
- Add delays between test runs
- Use separate API keys for CI/CD
- Implement exponential backoff in test utilities

## Monitoring and Alerting

Create dashboards to monitor QA trends:
- Success rate over time
- Average test duration
- Most frequently failing tests
- API performance trends

Tools:
- Grafana (with JSON data source)
- Datadog (with GitHub integration)
- Splunk (with artifact ingestion)
- ELK Stack (Elasticsearch, Logstash, Kibana)
