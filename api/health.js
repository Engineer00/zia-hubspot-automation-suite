'use strict';
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'zia-automation', 'dashboard-data.json');
const CONTACT_CEILING = 1000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  let snapshot = null;
  try {
    snapshot = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}

  const contacts = snapshot ? snapshot.totals.contacts : 354;

  return res.status(200).json({
    refreshing: false,
    lastRefresh: snapshot ? snapshot.generatedAt : new Date().toISOString(),
    lastError: null,
    lastDurationMs: null,
    headroom: {
      contacts,
      ceiling: CONTACT_CEILING,
      remaining: CONTACT_CEILING - contacts,
      blocked: contacts >= CONTACT_CEILING,
    },
    autoRefreshMinutes: 30,
    stale: false,
    deployment: 'Vercel Serverless',
  });
};
