#!/usr/bin/env node
'use strict';
/**
 * ZIA QA Test Suite
 * 
 * Comprehensive quality assurance testing for HubSpot demo system.
 * Tests automation rules, API connectivity, data integrity, validation,
 * and dashboard functionality.
 * 
 * USAGE:
 *   node qa-suite.js                  run all tests
 *   node qa-suite.js --suite rules    run only rules tests
 *   node qa-suite.js --suite api      run only API tests
 *   node qa-suite.js --suite data     run only data integrity tests
 *   node qa-suite.js --suite validation  run only validation tests
 *   node qa-suite.js --suite server   run only server tests
 *   node qa-suite.js --dry-run        do not modify any data
 *   node qa-suite.js --verbose        detailed output
 *   node qa-suite.js --json           JSON report output
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Load test modules
const apiTests = require('./qa/test-api');
const rulesTests = require('./qa/test-rules');
const dataTests = require('./qa/test-data');
const validationTests = require('./qa/test-validation');
const serverTests = require('./qa/test-server');
const performanceTests = require('./qa/test-performance');

const TEST_SUITES = {
  api: apiTests,
  rules: rulesTests,
  data: dataTests,
  validation: validationTests,
  server: serverTests,
  performance: performanceTests,
};

class QARunner {
  constructor(options = {}) {
    this.options = {
      dryRun: false,
      verbose: false,
      jsonOutput: false,
      suites: Object.keys(TEST_SUITES),
      ...options,
    };
    
    this.results = {
      startedAt: new Date().toISOString(),
      suites: {},
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
      },
    };
  }

  log(msg, level = 'info') {
    if (this.options.verbose || level !== 'debug') {
      const timestamp = new Date().toISOString();
      const prefix = {
        info: '  ℹ',
        warn: '  ⚠',
        error: '  ✗',
        pass: '  ✓',
        debug: '  •',
      }[level] || '  •';
      console.log(`${prefix} ${msg}`);
    }
  }

  async runSuite(name, suite) {
    this.log(`Running ${name} suite...`, 'info');
    const suiteStart = Date.now();
    
    const suiteResults = {
      name,
      tests: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
    };

    const context = {
      dryRun: this.options.dryRun,
      verbose: this.options.verbose,
    };

    try {
      const tests = await suite.run(context);
      
      for (const test of tests) {
        suiteResults.tests.push(test);
        this.results.summary.total++;
        
        if (test.skipped) {
          suiteResults.skipped++;
          this.results.summary.skipped++;
          this.log(`  SKIP  ${test.name}`, 'debug');
        } else if (test.passed) {
          suiteResults.passed++;
          this.results.summary.passed++;
          this.log(`  PASS  ${test.name}`, 'pass');
        } else {
          suiteResults.failed++;
          this.results.summary.failed++;
          this.log(`  FAIL  ${test.name}`, 'error');
          if (test.error) {
            this.log(`        ${test.error}`, 'error');
          }
        }
      }
    } catch (e) {
      this.log(`Suite error: ${e.message}`, 'error');
      suiteResults.failed++;
      suiteResults.tests.push({
        name: 'suite-execution',
        passed: false,
        error: e.message,
      });
    }

    suiteResults.duration = Date.now() - suiteStart;
    this.results.suites[name] = suiteResults;
    
    const summary = `${name}: ${suiteResults.passed} passed, ${suiteResults.failed} failed, ${suiteResults.skipped} skipped (${suiteResults.duration}ms)`;
    const level = suiteResults.failed > 0 ? 'warn' : 'info';
    this.log(summary, level);
    
    return suiteResults;
  }

  async run() {
    const startTime = Date.now();
    console.log('='.repeat(70));
    console.log('ZIA QA TEST SUITE');
    console.log(`${this.results.startedAt}  ${this.options.suites.join(', ')}`);
    console.log(`${this.options.dryRun ? '[DRY RUN — no data modifications]' : '[LIVE]'}`);
    console.log('='.repeat(70) + '\n');

    for (const suiteName of this.options.suites) {
      if (!TEST_SUITES[suiteName]) {
        this.log(`Unknown suite: ${suiteName}`, 'warn');
        continue;
      }
      
      await this.runSuite(suiteName, TEST_SUITES[suiteName]);
      console.log('');
    }

    this.results.summary.duration = Date.now() - startTime;
    this.results.finishedAt = new Date().toISOString();

    this.printSummary();
    this.saveReport();

    return this.results;
  }

  printSummary() {
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    
    const s = this.results.summary;
    const allTests = Object.values(this.results.suites)
      .flatMap(suite => suite.tests);
    
    console.log(`Total: ${s.total} tests`);
    console.log(`  ✓ Passed:  ${s.passed}`);
    console.log(`  ✗ Failed:  ${s.failed}`);
    console.log(`  ⊘ Skipped: ${s.skipped}`);
    console.log(`\nDuration: ${(s.duration / 1000).toFixed(2)}s`);
    console.log(`Success Rate: ${((s.passed / (s.total - s.skipped)) * 100).toFixed(1)}%`);

    if (s.failed > 0) {
      console.log('\nFailed Tests:');
      allTests
        .filter(t => !t.passed && !t.skipped)
        .forEach(t => {
          console.log(`  • ${t.name}`);
          if (t.error) console.log(`    ${t.error}`);
        });
    }

    console.log('');
    process.exitCode = s.failed > 0 ? 1 : 0;
  }

  saveReport() {
    const reportPath = path.join(__dirname, 'qa-report.json');
    const report = this.options.jsonOutput ? this.results : JSON.stringify(this.results, null, 2);
    
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
    this.log(`Report saved to ${path.basename(reportPath)}`);
  }
}

// Parse command-line arguments
function parseArgs(argv) {
  const args = {
    dryRun: false,
    verbose: false,
    jsonOutput: false,
    suites: Object.keys(TEST_SUITES),
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--verbose') args.verbose = true;
    else if (arg === '--json') args.jsonOutput = true;
    else if (arg === '--suite' && i + 1 < argv.length) {
      args.suites = [argv[++i]];
    }
  }

  return args;
}

// Main
(async () => {
  const args = parseArgs(process.argv);
  const runner = new QARunner(args);
  
  try {
    await runner.run();
  } catch (e) {
    console.error('Fatal error:', e.message);
    process.exitCode = 2;
  }
})();
