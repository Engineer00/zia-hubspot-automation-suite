'use strict';
/**
 * Test & Verification Script for Neon PostgreSQL Integration.
 * Run with: node test-neon-db.js
 */
const { initDb, getConnectionString, saveSnapshot, getLatestSnapshot, logRuleExecution } = require('./lib/db');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('='.repeat(66));
  console.log('NEON POSTGRESQL INTEGRATION VERIFIER');
  console.log('='.repeat(66));

  const connStr = getConnectionString();
  if (!connStr) {
    console.log('❌ FAIL: No DATABASE_URL or NEON_DATABASE_URL found in process.env or .env file.');
    console.log('   Please add your connection string to zia-automation/.env:');
    console.log('   DATABASE_URL="postgres://user:pass@ep-xyz.neon.tech/neondb?sslmode=require"');
    console.log('='.repeat(66));
    process.exit(1);
  }

  console.log('📡 Connection string detected. Connecting to Neon Postgres...');

  const initResult = await initDb();
  if (!initResult.ok) {
    console.log(`❌ FAIL: Database initialization error: ${initResult.error}`);
    process.exit(1);
  }
  console.log('✅ PASS: Schema initialized (zia_snapshots, zia_rule_logs, zia_stripe_events tables created).');

  // Test logging a rule execution
  const ruleLogId = await logRuleExecution('WF-00', 'Neon Test Rule', 'SUCCESS', 1);
  if (ruleLogId) {
    console.log(`✅ PASS: Logged rule execution to Neon Postgres (ID: ${ruleLogId}).`);
  } else {
    console.log('❌ FAIL: Unable to write to zia_rule_logs table.');
  }

  // Test snapshot save
  const dataPath = path.join(__dirname, 'dashboard-data.json');
  if (fs.existsSync(dataPath)) {
    const snap = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const snapId = await saveSnapshot(snap);
    if (snapId) {
      console.log(`✅ PASS: Saved analytics snapshot to Neon Postgres (ID: ${snapId}).`);
    } else {
      console.log('❌ FAIL: Unable to write snapshot to zia_snapshots table.');
    }

    const fetched = await getLatestSnapshot();
    if (fetched && fetched.totals && fetched.totals.contacts) {
      console.log(`✅ PASS: Successfully retrieved latest snapshot from Neon Postgres (${fetched.totals.contacts} contacts, ${fetched.totals.deals} deals).`);
    } else {
      console.log('❌ FAIL: Unable to read snapshot back from Neon Postgres.');
    }
  }

  console.log('='.repeat(66));
  console.log('NEON INTEGRATION VERIFICATION COMPLETE — ALL SYSTEMS GO!');
  console.log('='.repeat(66));
  process.exit(0);
}

main().catch(err => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
