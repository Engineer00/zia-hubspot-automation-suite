'use strict';
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'zia-automation', 'dashboard-data.json');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return res.status(200).send(raw);
  } catch (e) {
    return res.status(500).json({ error: 'Snapshot file unavailable: ' + e.message });
  }
};
