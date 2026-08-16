#!/usr/bin/env node
'use strict';

const token = process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_SERVICE_KEY || '';
if (!token) {
  console.error('Missing HUBSPOT_TOKEN or HUBSPOT_SERVICE_KEY in environment.');
  process.exit(1);
}

const HUBSPOT = 'https://api.hubapi.com';

const PROPERTY_DEFS = {
  contacts: [
const PROPERTY_DEFS = {
  contacts: [
    { name: 'zia_contact_type', label: 'Contact Type', type: 'enumeration', fieldType: 'select', groupName: 'contactinformation', options: [
      { label: 'Client Contact', value: 'client_contact' },
      { label: 'Talent', value: 'talent' },
      { label: 'Internal Team', value: 'internal_team' },
      { label: 'Partner', value: 'partner' }
    ] },
    { name: 'zia_role', label: 'Role', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
    { name: 'zia_source', label: 'Source', type: 'enumeration', fieldType: 'select', groupName: 'contactinformation', options: [
      { label: 'Referral', value: 'referral' },
      { label: 'Organic', value: 'organic' },
      { label: 'Conference', value: 'conference' },
      { label: 'Inbound', value: 'inbound' },
      { label: 'Partner', value: 'partner' }
    ] },
    { name: 'zia_lifecycle_stage', label: 'Lifecycle Stage', type: 'enumeration', fieldType: 'select', groupName: 'contactinformation', options: [
      { label: 'MQL', value: 'mql' },
      { label: 'SQL', value: 'sql' },
      { label: 'Customer', value: 'customer' }
    ] }
  ],
  companies: [
    { name: 'zia_company_stage', label: 'Company Stage', type: 'enumeration', fieldType: 'select', groupName: 'companyinformation', options: [
      { label: 'Prospect', value: 'prospect' },
      { label: 'Growth', value: 'growth' },
      { label: 'Stable', value: 'stable' },
      { label: 'At Risk', value: 'at_risk' }
    ] },
    { name: 'zia_service_line', label: 'Service Line', type: 'enumeration', fieldType: 'select', groupName: 'companyinformation', options: [
      { label: 'Leadership Development', value: 'leadership_development' },
      { label: 'Organizational Design', value: 'organizational_design' },
      { label: 'Training & Coaching', value: 'training_coaching' },
      { label: 'Change Management', value: 'change_management' },
      { label: 'Performance Consulting', value: 'performance_consulting' }
    ] },
    { name: 'zia_org_size', label: 'Organization Size', type: 'string', fieldType: 'text', groupName: 'companyinformation' },
    { name: 'zia_industry', label: 'Industry', type: 'string', fieldType: 'text', groupName: 'companyinformation' },
    { name: 'zia_client_health', label: 'Client Health', type: 'enumeration', fieldType: 'select', groupName: 'companyinformation', options: [
      { label: 'Healthy', value: 'healthy' },
      { label: 'Watchlist', value: 'watchlist' },
      { label: 'At Risk', value: 'at_risk' },
      { label: 'Critical', value: 'critical' }
    ] }
  ],
  deals: [
    { name: 'zia_deal_type', label: 'Deal Type', type: 'enumeration', fieldType: 'select', groupName: 'dealinformation', options: [
      { label: 'Consulting Engagement', value: 'consulting_engagement' },
      { label: 'Program', value: 'program' },
      { label: 'Retainer', value: 'retainer' }
    ] },
    { name: 'zia_service_type', label: 'Service Type', type: 'string', fieldType: 'text', groupName: 'dealinformation' },
    { name: 'zia_decision_maker', label: 'Decision Maker', type: 'string', fieldType: 'text', groupName: 'dealinformation' },
    { name: 'zia_expected_launch_date', label: 'Expected Launch Date', type: 'date', fieldType: 'date', groupName: 'dealinformation' },
    { name: 'zia_onboarding_status', label: 'Onboarding Status', type: 'enumeration', fieldType: 'select', groupName: 'dealinformation', options: [
      { label: 'Not Started', value: 'not_started' },
      { label: 'In Progress', value: 'in_progress' },
      { label: 'Completed', value: 'completed' },
      { label: 'Delayed', value: 'delayed' }
    ] },
    { name: 'zia_primary_challenge', label: 'Primary Challenge', type: 'string', fieldType: 'text', groupName: 'dealinformation' }
  ],
  tickets: [
    { name: 'zia_ticket_type', label: 'Ticket Type', type: 'enumeration', fieldType: 'select', groupName: 'ticketinformation', options: [
      { label: 'Onboarding Issue', value: 'onboarding_issue' },
      { label: 'Client Feedback', value: 'client_feedback' },
      { label: 'Program Support', value: 'program_support' }
    ] },
    { name: 'zia_sla_status', label: 'SLA Status', type: 'enumeration', fieldType: 'select', groupName: 'ticketinformation', options: [
      { label: 'On Track', value: 'on_track' },
      { label: 'At Risk', value: 'at_risk' },
      { label: 'Breached', value: 'breached' }
    ] }
  ]
};

const PIPELINES = {
  deals: [
    {
      name: 'ZIA — New Business',
      stages: [
        { label: 'Discovery Call Scheduled', probability: 0.15 },
        { label: 'Needs Analysis', probability: 0.35 },
        { label: 'Proposal Delivered', probability: 0.55 },
        { label: 'Contract Negotiation', probability: 0.75 },
        { label: 'Closed Won', probability: 1.0, closed: true },
        { label: 'Closed Lost', probability: 0.0, closed: true }
      ]
    },
    {
      name: 'ZIA — Onboarding',
      stages: [
        { label: 'Kickoff Scheduled', probability: 0.2 },
        { label: 'Needs Assessment', probability: 0.35 },
        { label: 'Strategy Mapped', probability: 0.55 },
        { label: 'Delivery Handoff', probability: 0.8 },
        { label: 'Live', probability: 1.0, closed: true }
      ]
    }
  ],
  tickets: [
    {
      name: 'ZIA — Client Success',
      stages: [
        { label: 'New', probability: 0.1 },
        { label: 'In Progress', probability: 0.35 },
        { label: 'Waiting on Client', probability: 0.6 },
        { label: 'Resolved', probability: 1.0, closed: true }
      ]
    }
  ]
};

async function hubspotFetch(path, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const response = await fetch(`${HUBSPOT}${path}`, {
    method,
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!response.ok) {
    const errorInfo = {
      path,
      method,
      status: response.status,
      body: json
    };
    throw new Error(JSON.stringify(errorInfo, null, 2));
  }

  return json;
}

async function getExistingProperties(objectType) {
  try {
    const data = await hubspotFetch(`/crm/v3/properties/${objectType}`);
    return new Set((data.results || []).map((p) => p.name));
  } catch (error) {
    return new Set();
  }
}

async function createPropertiesForObject(objectType, props) {
  const existing = await getExistingProperties(objectType);
  const created = [];

  for (const prop of props) {
    if (existing.has(prop.name)) {
      console.log(`SKIP ${objectType}.${prop.name} already exists`);
      continue;
    }

    const payload = {
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      groupName: prop.groupName || {
        contacts: 'contactinformation',
        companies: 'companyinformation',
        deals: 'dealinformation',
        tickets: 'ticketinformation'
      }[objectType],
      ...(prop.options ? { options: prop.options } : {})
    };

    try {
      const res = await hubspotFetch(`/crm/v3/properties/${objectType}`, { method: 'POST', body: payload });
      created.push(prop.name);
      console.log(`CREATE ${objectType}.${prop.name} -> ${res.name || prop.name}`);
    } catch (error) {
      console.error(`FAILED ${objectType}.${prop.name}`);
      console.error(error.message);
    }
  }

  return created;
}

async function listPipelines(objectType) {
  try {
    const data = await hubspotFetch(`/crm/v3/pipelines/${objectType}`);
    return data.results || [];
  } catch (error) {
    return [];
  }
}

async function createPipeline(objectType, config) {
  const existing = await listPipelines(objectType);
  const matches = existing.find((p) => p.label === config.name || p.name === config.name);
  if (matches) {
    console.log(`SKIP pipeline ${objectType}.${config.name} already exists`);
    return;
  }

  if (existing.length >= 1) {
    console.log(`SKIP pipeline ${objectType}.${config.name} because the account already has one pipeline for this object type. Using the default pipeline for the demo.`);
    return;
  }

  const payload = {
    label: config.name,
    displayOrder: 0,
    stages: config.stages.map((stage, index) => ({
      label: stage.label,
      displayOrder: index,
      metadata: {
        probability: String(stage.probability),
        isClosed: String(Boolean(stage.closed))
      }
    }))
  };

  const res = await hubspotFetch(`/crm/v3/pipelines/${objectType}`, { method: 'POST', body: payload });
  console.log(`CREATE pipeline ${objectType}.${config.name} -> ${res.label || config.name}`);
}

async function validateToken() {
  const me = await hubspotFetch('/integrations/v1/me');
  console.log('HubSpot token valid');
  console.log(JSON.stringify({
    appId: me.appId || null,
    hubId: me.hubId || null,
    userId: me.userId || null,
    scopes: me.scopes || []
  }, null, 2));
}

async function main() {
  console.log('Starting HubSpot ZIA demo setup...');
  await validateToken();

  for (const [objectType, defs] of Object.entries(PROPERTY_DEFS)) {
    console.log(`\nCreating properties for ${objectType}...`);
    const propertySet = defs.map((prop) => ({
      ...prop,
      groupName: {
        contacts: 'contactinformation',
        companies: 'companyinformation',
        deals: 'dealinformation',
        tickets: 'ticketinformation'
      }[objectType]
    }));
    await createPropertiesForObject(objectType, propertySet);
  }

  console.log('\nCreating pipelines...');
  for (const [objectType, configs] of Object.entries(PIPELINES)) {
    for (const config of configs) {
      await createPipeline(objectType, config);
    }
  }

  console.log('\nSetup complete.');
}

main().catch((error) => {
  console.error('HubSpot setup failed:');
  console.error(error.message);
  process.exit(1);
});
