#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const token = process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_SERVICE_KEY || '';
if (!token) {
  console.error('Missing HUBSPOT_TOKEN or HUBSPOT_SERVICE_KEY in environment.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..', 'zia_hubspot_demo', 'seed');
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 100);

const OBJECT_MAP = {
  companies: {
    file: 'companies.csv',
    endpoint: '/crm/v3/objects/companies/batch/create',
    transform: mapCompanyRow,
  },
  contacts: {
    file: 'contacts_clients.csv',
    endpoint: '/crm/v3/objects/contacts/batch/create',
    transform: mapContactRow,
  },
  talent: {
    file: 'contacts_talent.csv',
    endpoint: '/crm/v3/objects/contacts/batch/create',
    transform: mapTalentRow,
  },
  deals: {
    file: 'deals_acquisition.csv',
    endpoint: '/crm/v3/objects/deals/batch/create',
    transform: mapDealRow,
  },
};

async function hubspotFetch(endpoint, body) {
  const response = await fetch(`https://api.hubapi.com${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch (error) { json = { raw: text }; }

  if (!response.ok) {
    const err = new Error(`HubSpot API error for ${endpoint}: ${response.status} ${JSON.stringify(json)}`);
    err.status = response.status;
    err.body = json;
    throw err;
  }

  return json;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      if (row.some((cell) => String(cell).trim() !== '')) {
        rows.push(row);
      }
      row = [];
      value = '';
      continue;
    }

    value += ch;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => String(cell).trim() !== '')) {
      rows.push(row);
    }
  }

  if (rows.length < 2) return [];

  const [headers, ...dataRows] = rows;
  return dataRows.map((values) => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i].trim()] = values[i] ?? '';
    }
    return obj;
  });
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeContactType(value) {
  const map = {
    'Client Contact': 'client_contact',
    'Talent': 'talent',
    'Internal Team': 'internal_team',
    'Partner': 'partner',
    'Client': 'client_contact',
    'Prospect': 'client_contact',
  };
  return map[normalizeText(value)] || 'client_contact';
}

function normalizeDealType(value) {
  const map = {
    'Core': 'consulting_engagement',
    'Momentum': 'program',
    'Summit': 'retainer',
  };
  return map[normalizeText(value)] || 'consulting_engagement';
}

function mapCompanyRow(row) {
  const domain = normalizeText(row['Company Domain Name']) || normalizeText(row['Website']) || normalizeText(row['Domain']) || 'example.invalid';
  const companyName = normalizeText(row['Name']) || 'Unnamed Company';
  const website = domain.includes('://') ? domain : `https://${domain}`;

  return {
    properties: {
      name: companyName,
      domain: domain,
      website: website,
      phone: normalizeText(row['Phone Number']) || normalizeText(row['Phone']) || '',
      city: normalizeText(row['City']) || '',
      state: normalizeText(row['State']) || '',
      industry: normalizeText(row['Practice Type']) || normalizeText(row['Industry']) || '',
      zia_company_stage: 'prospect',
      zia_service_line: 'organizational_design',
      zia_client_health: 'healthy',
    },
  };
}

function mapContactRow(row) {
  const email = normalizeText(row['Email']);
  const firstName = normalizeText(row['First Name']);
  const lastName = normalizeText(row['Last Name']);
  const phone = normalizeText(row['Phone Number']) || normalizeText(row['Phone']) || '';
  return {
    properties: {
      email,
      firstname: firstName,
      lastname: lastName,
      phone: phone,
      jobtitle: normalizeText(row['Practice Role']) || '',
      lifecyclestage: 'lead',
      zia_contact_type: normalizeContactType(row['Contact Type']),
      zia_source: 'inbound',
      zia_role: normalizeText(row['Practice Role']) || '',
    },
  };
}

function mapTalentRow(row) {
  const email = normalizeText(row['Email']);
  const firstName = normalizeText(row['First Name']);
  const lastName = normalizeText(row['Last Name']);
  return {
    properties: {
      email,
      firstname: firstName,
      lastname: lastName,
      phone: normalizeText(row['Phone Number']) || '',
      jobtitle: normalizeText(row['Title']) || normalizeText(row['Role']) || '',
      lifecyclestage: 'lead',
      zia_contact_type: 'talent',
      zia_source: 'referral',
      zia_role: normalizeText(row['Tier']) || '',
    },
  };
}

function mapDealRow(row) {
  const dealName = normalizeText(row['Deal Name']) || 'Unnamed Deal';
  const amount = Number(normalizeText(row['Amount']).replace(/[$,]/g, '')) || 0;
  const closeDate = normalizeText(row['Close Date']) || new Date().toISOString().slice(0, 10);
  const tierRequested = normalizeText(row['Tier Requested']);

  return {
    properties: {
      dealname: dealName,
      amount: amount,
      closedate: closeDate,
      dealstage: 'appointmentscheduled',
      pipeline: 'default',
      zia_deal_type: normalizeDealType(tierRequested),
      zia_service_type: normalizeText(row['Function Needed']) || '',
      zia_expected_launch_date: normalizeText(row['Target Embed Date']) || '',
      zia_primary_challenge: normalizeText(row['Showcase Rejection Reason']) || '',
      zia_onboarding_status: 'not_started',
    },
  };
}

async function createBatchesForObject(key, config) {
  const filePath = path.join(ROOT, config.file);
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP ${key}: missing ${config.file}`);
    return;
  }

  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  if (!rows.length) {
    console.log(`SKIP ${key}: no rows parsed from ${config.file}`);
    return;
  }

  console.log(`\nIMPORT ${key}: ${rows.length} rows from ${config.file} in batches of ${BATCH_SIZE}`);

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((row) => config.transform(row));
    try {
      const response = await hubspotFetch(config.endpoint, { inputs: batch });
      const results = Array.isArray(response.results) ? response.results : [];
      created += results.length;
      console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}: created ${results.length} records`);
    } catch (error) {
      console.error(`  batch ${Math.floor(i / BATCH_SIZE) + 1} failed`);
      console.error(error.body || error.message);
      skipped += batch.length;
    }
  }

  console.log(`DONE ${key}: created ${created}, skipped ${skipped}`);
}

async function main() {
  for (const [key, config] of Object.entries(OBJECT_MAP)) {
    await createBatchesForObject(key, config);
  }
}

main().catch((error) => {
  console.error('Import sequence failed:');
  console.error(error.message);
  process.exit(1);
});
