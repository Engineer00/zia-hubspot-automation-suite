#!/usr/bin/env node
'use strict';
/**
 * QA Test Suite: Validation
 * 
 * Tests the validation logic for claims, drift detection, and page accuracy.
 * Mirrors the logic in validate.js.
 */

const fs = require('fs');
const path = require('path');
const { pull, compute } = require('../snapshot');
const { api, listAll } = require('../lib/hubspot');

async function testSnapshotGeneration() {
  const name = 'Snapshot Generation';

  try {
    const raw = await pull({ quiet: true });
    
    if (!raw || !raw.deals) {
      return {
        name,
        passed: false,
        error: 'Snapshot generation failed: no data',
      };
    }

    const snap = compute(raw);
    
    if (!snap || !snap.totals) {
      return {
        name,
        passed: false,
        error: 'Snapshot computation failed',
      };
    }

    return {
      name,
      passed: true,
      note: `Snapshot generated: ${snap.totals.contacts} contacts, ${snap.totals.deals} deals`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testClaimsValidation() {
  const name = 'Claims Validation';

  try {
    const raw = await pull({ quiet: true });
    const snap = compute(raw);

    // Key claims to validate
    const claims = [];

    // Claim 1: Companies exist
    if (!snap.totals.companies || snap.totals.companies < 20) {
      claims.push(`Companies: ${snap.totals.companies} (expected >= 20)`);
    } else {
      claims.push('Companies: OK');
    }

    // Claim 2: Contacts exist
    if (!snap.totals.contacts || snap.totals.contacts < 100) {
      claims.push(`Contacts: ${snap.totals.contacts} (expected >= 100)`);
    } else {
      claims.push('Contacts: OK');
    }

    // Claim 3: Deals exist
    if (!snap.totals.deals || snap.totals.deals < 50) {
      claims.push(`Deals: ${snap.totals.deals} (expected >= 50)`);
    } else {
      claims.push('Deals: OK');
    }

    // Claim 4: Revenue data exists
    if (!snap.totals.arr || snap.totals.arr <= 0) {
      claims.push(`ARR: ${snap.totals.arr} (expected > 0)`);
    } else {
      claims.push('ARR: OK');
    }

    // Claim 5: Placements exist
    if (!snap.totals.placements || snap.totals.placements < 10) {
      claims.push(`Placements: ${snap.totals.placements} (expected >= 10)`);
    } else {
      claims.push('Placements: OK');
    }

    const failedClaims = claims.filter(c => !c.includes('OK'));

    if (failedClaims.length === 0) {
      return {
        name,
        passed: true,
        note: 'All narrative claims validated',
      };
    }

    return {
      name,
      passed: false,
      error: `${failedClaims.length} claims failed: ${failedClaims.slice(0, 2).join('; ')}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testSnapshotConsistency() {
  const name = 'Snapshot Consistency';

  try {
    // Pull twice and compare
    const snap1 = compute(await pull({ quiet: true }));
    
    // Wait a moment
    await new Promise(r => setTimeout(r, 1000));
    
    const snap2 = compute(await pull({ quiet: true }));

    const tolerance = 0.05; // 5% tolerance for variance
    const compare = (v1, v2, field) => {
      if (!v1 || !v2) return true;
      const diff = Math.abs((v1 - v2) / v1);
      return diff <= tolerance;
    };

    const issues = [];

    if (!compare(snap1.totals.deals, snap2.totals.deals, 'deals')) {
      issues.push(`Deals: ${snap1.totals.deals} → ${snap2.totals.deals}`);
    }

    if (!compare(snap1.totals.contacts, snap2.totals.contacts, 'contacts')) {
      issues.push(`Contacts: ${snap1.totals.contacts} → ${snap2.totals.contacts}`);
    }

    if (issues.length === 0) {
      return {
        name,
        passed: true,
        note: 'Snapshots are consistent (within tolerance)',
      };
    }

    return {
      name,
      passed: false,
      error: `Inconsistency detected: ${issues.join('; ')}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testDashboardDataFile() {
  const name = 'Dashboard Data File';

  try {
    const dashDataPath = path.join(__dirname, '../dashboard-data.json');
    
    if (!fs.existsSync(dashDataPath)) {
      return {
        name,
        passed: false,
        error: 'dashboard-data.json not found',
      };
    }

    const content = fs.readFileSync(dashDataPath, 'utf8');
    const data = JSON.parse(content);

    if (!data.totals || !data.generatedAt) {
      return {
        name,
        passed: false,
        error: 'Invalid dashboard data structure',
      };
    }

    // Check if data is stale (older than 24 hours)
    const generatedTime = new Date(data.generatedAt);
    const age = Date.now() - generatedTime.getTime();
    const staleMs = 24 * 60 * 60 * 1000;

    const status = age > staleMs
      ? 'STALE (>24hrs)'
      : `fresh (${Math.round(age / 60000)}min old)`;

    return {
      name,
      passed: age <= staleMs,
      note: `Dashboard data is ${status}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testValidationScriptIntegrity() {
  const name = 'Validation Script';

  try {
    const validatePath = path.join(__dirname, '../validate.js');
    
    if (!fs.existsSync(validatePath)) {
      return {
        name,
        passed: false,
        error: 'validate.js not found',
      };
    }

    const content = fs.readFileSync(validatePath, 'utf8');

    // Check for key validation functions
    const required = ['claims', 'pullExtras', 'drift', 'pages'];
    const missing = required.filter(r => !content.includes(r));

    if (missing.length > 0) {
      return {
        name,
        passed: false,
        error: `Missing validation functions: ${missing.join(', ')}`,
      };
    }

    return {
      name,
      passed: true,
      note: 'Validation script structure is intact',
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testHTMLPagesExist() {
  const name = 'HTML Pages Availability';

  try {
    const requiredPages = [
      'zia-command-deck.html',
      'zia-one-lead.html',
      'zia-system-document.html',
      'zia-interview-pack.html',
    ];

    const baseDir = path.join(__dirname, '..');
    const missing = [];

    for (const page of requiredPages) {
      const pagePath = path.join(baseDir, page);
      if (!fs.existsSync(pagePath)) {
        missing.push(page);
      }
    }

    if (missing.length === 0) {
      return {
        name,
        passed: true,
        note: `All ${requiredPages.length} published pages exist`,
      };
    }

    return {
      name,
      passed: false,
      error: `Missing pages: ${missing.join(', ')}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testMetricsAccuracy() {
  const name = 'Metrics Accuracy';

  try {
    const snap = compute(await pull({ quiet: true }));

    const issues = [];

    // Total contacts should equal sum of tiers
    const tierTotal = Object.values(snap.byTier || {}).reduce((a, t) => a + (t.contacts || 0), 0);
    if (tierTotal > 0 && Math.abs(tierTotal - snap.totals.contacts) > 5) {
      issues.push(`Tier total mismatch: ${tierTotal} vs ${snap.totals.contacts}`);
    }

    // ARR should equal sum of won deals
    if (snap.totals.arr > 0) {
      const wonARR = (snap.byStage || {})[snap.STAGE?.WON] || { arr: 0 };
      if (Math.abs(wonARR.arr - snap.totals.arr) > 0.1 * snap.totals.arr) {
        issues.push(`ARR mismatch: ${wonARR.arr} vs ${snap.totals.arr}`);
      }
    }

    if (issues.length === 0) {
      return {
        name,
        passed: true,
        note: 'Metrics are accurate and consistent',
      };
    }

    return {
      name,
      passed: false,
      error: issues.join('; '),
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
  name: 'Validation Tests',
  run: async (context) => {
    const tests = [
      await testValidationScriptIntegrity(),
      await testHTMLPagesExist(),
      await testSnapshotGeneration(),
      await testClaimsValidation(),
      await testSnapshotConsistency(),
      await testDashboardDataFile(),
      await testMetricsAccuracy(),
    ];

    return tests;
  },
};
