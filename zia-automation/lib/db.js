'use strict';
/**
 * Neon PostgreSQL Client Adapter for ZIA Automation Suite.
 * Connects via standard pg driver or Neon connection string.
 */
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// Try loading .env file if available
const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) {
  require('dotenv').config({ path: ENV_FILE });
}

function getConnectionString() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || null;
}

let pool = null;

function getPool() {
  const connStr = getConnectionString();
  if (!connStr) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

/** Initialize Neon Postgres Database Schema */
async function initDb() {
  const p = getPool();
  if (!p) return { ok: false, error: 'No DATABASE_URL or NEON_DATABASE_URL defined' };

  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // 1. Snapshots Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS zia_snapshots (
        id SERIAL PRIMARY KEY,
        generated_at TIMESTAMP WITH TIME ZONE NOT NULL,
        snapshot_data JSONB NOT NULL,
        total_contacts INT,
        total_deals INT,
        total_won NUMERIC(14,2),
        open_pipeline NUMERIC(14,2),
        avg_health NUMERIC(5,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Rule Execution Logs Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS zia_rule_logs (
        id SERIAL PRIMARY KEY,
        rule_id VARCHAR(20) NOT NULL,
        rule_name VARCHAR(150),
        status VARCHAR(30) NOT NULL,
        records_updated INT DEFAULT 0,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Stripe Webhook Payment Events Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS zia_stripe_events (
        id SERIAL PRIMARY KEY,
        event_id VARCHAR(100) UNIQUE NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        invoice_id VARCHAR(100),
        amount NUMERIC(12,2),
        status VARCHAR(30),
        received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query('COMMIT');
    return { ok: true, message: 'Neon Postgres database initialized successfully' };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: err.message };
  } finally {
    client.release();
  }
}

/** Save snapshot to Neon Postgres */
async function saveSnapshot(snap) {
  const p = getPool();
  if (!p) return null;

  try {
    const res = await p.query(
      `INSERT INTO zia_snapshots (generated_at, snapshot_data, total_contacts, total_deals, total_won, open_pipeline, avg_health)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        snap.generatedAt || new Date().toISOString(),
        snap,
        snap.totals ? snap.totals.contacts : 0,
        snap.totals ? snap.totals.deals : 0,
        snap.revenue ? snap.revenue.wonTotal : 0,
        snap.revenue ? snap.revenue.openPipeline : 0,
        snap.placements ? snap.placements.avgHealth : 0,
      ]
    );
    return res.rows[0].id;
  } catch (err) {
    console.error(`[Neon DB] saveSnapshot error: ${err.message}`);
    return null;
  }
}

/** Fetch latest snapshot from Neon Postgres */
async function getLatestSnapshot() {
  const p = getPool();
  if (!p) return null;

  try {
    const res = await p.query(`SELECT snapshot_data FROM zia_snapshots ORDER BY id DESC LIMIT 1`);
    return res.rows.length ? res.rows[0].snapshot_data : null;
  } catch (err) {
    console.error(`[Neon DB] getLatestSnapshot error: ${err.message}`);
    return null;
  }
}

/** Log Rule Execution */
async function logRuleExecution(ruleId, ruleName, status, recordsUpdated = 0) {
  const p = getPool();
  if (!p) return null;

  try {
    const res = await p.query(
      `INSERT INTO zia_rule_logs (rule_id, rule_name, status, records_updated) VALUES ($1, $2, $3, $4) RETURNING id`,
      [ruleId, ruleName, status, recordsUpdated]
    );
    return res.rows[0].id;
  } catch (err) {
    console.error(`[Neon DB] logRuleExecution error: ${err.message}`);
    return null;
  }
}

/** Log Stripe Payment Event */
async function logStripeEvent(eventId, eventType, invoiceId, amount, status) {
  const p = getPool();
  if (!p) return null;

  try {
    const res = await p.query(
      `INSERT INTO zia_stripe_events (event_id, event_type, invoice_id, amount, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO UPDATE SET status = EXCLUDED.status
       RETURNING id`,
      [eventId, eventType, invoiceId, amount, status]
    );
    return res.rows[0].id;
  } catch (err) {
    console.error(`[Neon DB] logStripeEvent error: ${err.message}`);
    return null;
  }
}

module.exports = {
  getConnectionString,
  getPool,
  initDb,
  saveSnapshot,
  getLatestSnapshot,
  logRuleExecution,
  logStripeEvent,
};
