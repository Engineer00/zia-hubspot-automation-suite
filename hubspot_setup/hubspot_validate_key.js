#!/usr/bin/env node
'use strict';

const https = require('https');

const token = process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_SERVICE_KEY || '';

if (!token) {
  console.error('Missing HUBSPOT_TOKEN or HUBSPOT_SERVICE_KEY. Set it in your environment first.');
  process.exit(1);
}

function request(path) {
  return new Promise((resolve, reject) => {
    const url = `https://api.hubapi.com${path}`;
    const req = https.request(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed, raw: data });
        } catch (err) {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

(async () => {
  try {
    const me = await request('/integrations/v1/me');
    console.log('HubSpot key validation result:');
    console.log(JSON.stringify({
      status: me.status,
      appId: me.body?.appId || null,
      hubId: me.body?.hubId || null,
      userId: me.body?.userId || null,
      scopes: me.body?.scopes || null
    }, null, 2));

    const contacts = await request('/crm/v3/objects/contacts?limit=1');
    console.log('\nContacts API check:');
    console.log(JSON.stringify({
      status: contacts.status,
      total: contacts.body?.total || null,
      results: Array.isArray(contacts.body?.results) ? contacts.body.results.length : null
    }, null, 2));
  } catch (error) {
    console.error('Validation failed:');
    console.error(error.message);
    process.exit(1);
  }
})();
