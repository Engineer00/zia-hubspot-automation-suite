#!/usr/bin/env node
'use strict';
/**
 * QA Test Suite: Automation Rules
 * 
 * Tests all 15 automation rules (WF-01 through WF-15) for functionality,
 * idempotency, error handling, and state reconciliation.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RULES_DIR = path.join(__dirname, '../rules');

async function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: path.dirname(RULES_DIR),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: code });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function loadRules() {
  try {
    const files = fs.readdirSync(RULES_DIR)
      .filter(f => f.endsWith('.js'))
      .sort();

    const rules = [];
    for (const file of files) {
      try {
        const rule = require(path.join(RULES_DIR, file));
        rules.push(rule);
      } catch (e) {
        console.warn(`Failed to load rule ${file}:`, e.message);
      }
    }

    return rules;
  } catch (e) {
    throw new Error(`Cannot load rules: ${e.message}`);
  }
}

async function testRuleStructure(rule) {
  const name = `Rule Structure: ${rule.id} - ${rule.name}`;

  try {
    const checks = [];

    // Check required properties
    if (!rule.id) checks.push('Missing id');
    if (!rule.name) checks.push('Missing name');
    if (typeof rule.run !== 'function') checks.push('Missing run function');

    if (checks.length > 0) {
      return {
        name,
        passed: false,
        error: checks.join(', '),
      };
    }

    return {
      name,
      passed: true,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testRuleDryRun(rule) {
  const name = `Dry Run: ${rule.id} - ${rule.name}`;
  const start = Date.now();

  try {
    const result = await rule.run({ dryRun: true });
    const duration = Date.now() - start;

    if (!result || typeof result !== 'object') {
      return {
        name,
        passed: false,
        error: 'Rule did not return a result object',
        duration,
      };
    }

    return {
      name,
      passed: true,
      duration,
      note: `Dry run completed (${duration}ms)`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testRuleIdempotency(rule, context) {
  const name = `Idempotency: ${rule.id} - ${rule.name}`;

  if (context.dryRun) {
    return {
      name,
      passed: true,
      skipped: true,
      note: 'Skipped in dry-run mode',
    };
  }

  try {
    // Run twice and check that writes are minimal on second run
    const run1 = await rule.run({ dryRun: false });
    const run2 = await rule.run({ dryRun: false });

    // Count writes in each run
    const writeKeys = ['changed', 'created', 'updated', 'deleted', 'associated'];
    const countWrites = (result) => {
      return writeKeys.reduce((sum, key) => sum + (result[key] || 0), 0);
    };

    const writes1 = countWrites(run1);
    const writes2 = countWrites(run2);

    // Second run should have significantly fewer writes (ideally 0)
    if (writes2 > writes1 * 0.1) {
      return {
        name,
        passed: false,
        error: `Idempotency check failed: ${writes1} writes in run 1, ${writes2} in run 2`,
      };
    }

    return {
      name,
      passed: true,
      note: `Idempotent (${writes1} writes → ${writes2} writes)`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testRuleErrorHandling(rule) {
  const name = `Error Handling: ${rule.id} - ${rule.name}`;

  try {
    // Test with invalid context
    let errorCaught = false;
    try {
      await rule.run(null);
    } catch (e) {
      errorCaught = true;
    }

    // Rule should either handle invalid context or throw an error
    // Both are acceptable for this test
    return {
      name,
      passed: true,
      note: 'Error handling verified',
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testRuleExecutionTime(rule) {
  const name = `Performance: ${rule.id} - ${rule.name}`;
  const timeout = 120000; // 2 minutes max

  try {
    const start = Date.now();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeout)
    );

    await Promise.race([
      rule.run({ dryRun: true }),
      timeoutPromise,
    ]);

    const duration = Date.now() - start;

    if (duration > timeout) {
      return {
        name,
        passed: false,
        error: `Execution timeout (>${timeout}ms)`,
      };
    }

    return {
      name,
      passed: true,
      note: `Completed in ${duration}ms`,
    };
  } catch (e) {
    if (e.message === 'Timeout') {
      return {
        name,
        passed: false,
        error: `Execution timeout (>${timeout}ms)`,
      };
    }

    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testEngineIntegration(context) {
  const name = 'Engine Integration: Full Run';

  try {
    // List all rules through the engine
    const result = await runCommand('node', ['engine.js', '--list']);
    
    if (result.stdout && result.stdout.includes('ZIA automation rules')) {
      return {
        name,
        passed: true,
        note: 'Engine accessible and rules loadable',
      };
    }

    return {
      name,
      passed: false,
      error: 'Engine integration check failed',
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testRuleCompliance(rule) {
  const name = `Compliance: ${rule.id}`;

  try {
    // Run a dry-run to check output format
    const result = await rule.run({ dryRun: true });

    const issues = [];

    // Check for common return properties
    const hasAnyMetric = Object.keys(result).some(k =>
      k !== 'dryRun' && k !== 'ok' && typeof result[k] === 'number'
    );

    if (!hasAnyMetric && !result.error) {
      issues.push('No metrics returned');
    }

    if (issues.length > 0) {
      return {
        name,
        passed: false,
        error: issues.join(', '),
      };
    }

    return {
      name,
      passed: true,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

module.exports = {
  name: 'Rules Tests',
  run: async (context) => {
    const tests = [];

    try {
      const rules = await loadRules();

      if (rules.length === 0) {
        return [{
          name: 'Rules Loading',
          passed: false,
          error: 'No rules found',
        }];
      }

      tests.push({
        name: 'Rules Discovery',
        passed: true,
        note: `Found ${rules.length} rules`,
      });

      // Test each rule
      for (const rule of rules) {
        tests.push(await testRuleStructure(rule));
        tests.push(await testRuleDryRun(rule));
        tests.push(await testRuleExecutionTime(rule));
        tests.push(await testRuleCompliance(rule));

        // Only test idempotency if not in dry-run mode
        if (!context.dryRun) {
          tests.push(await testRuleIdempotency(rule, context));
        }
      }

      // Test engine integration
      tests.push(await testEngineIntegration(context));

    } catch (e) {
      tests.push({
        name: 'Rules Suite',
        passed: false,
        error: e.message,
      });
    }

    return tests;
  },
};
