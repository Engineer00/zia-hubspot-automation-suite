#!/usr/bin/env node
'use strict';

const https = require('https');

const token = process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_SERVICE_KEY || '';
if (!token) {
  console.error('Missing HUBSPOT_TOKEN or HUBSPOT_SERVICE_KEY');
  process.exit(1);
}

const groupNameByObject = {
  contacts: 'contactinformation',
  companies: 'companyinformation',
  deals: 'dealinformation',
  tickets: 'ticketinformation'
};

const properties = [
  { objectType: 'contacts', name: 'zia_contact_type', label: 'Contact Type', type: 'enumeration', fieldType: 'select', groupName: 'contactinformation', options: [
    { label: 'Client Contact', value: 'client_contact' },
    { label: 'Talent', value: 'talent' },
    { label: 'Internal Team', value: 'internal_team' },
    { label: 'Partner', value: 'partner' }
  ]},
  { objectType: 'contacts', name: 'zia_role', label: 'Role', type: 'string', fieldType: 'text', groupName: 'contactinformation' },
  { objectType: 'contacts', name: 'zia_source', label: 'Source', type: 'enumeration', fieldType: 'select', groupName: 'contactinformation', options: [
    { label: 'Referral', value: 'referral' },
    { label: 'Organic', value: 'organic' },
    { label: 'Conference', value: 'conference' },
    { label: 'Inbound', value: 'inbound' },
    { label: 'Partner', value: 'partner' }
  ]},
  { objectType: 'contacts', name: 'zia_lifecycle_stage', label: 'Lifecycle Stage', type: 'enumeration', fieldType: 'select', groupName: 'contactinformation', options: [
    { label: 'MQL', value: 'mql' },
    { label: 'SQL', value: 'sql' },
    { label: 'Customer', value: 'customer' }
  ]},
  { objectType: 'companies', name: 'zia_company_stage', label: 'Company Stage', type: 'enumeration', fieldType: 'select', groupName: 'companyinformation', options: [
    { label: 'Prospect', value: 'prospect' },
    { label: 'Active Client', value: 'active_client' },
    { label: 'At Risk', value: 'at_risk' },
    { label: 'Former Client', value: 'former_client' }
  ]},
  { objectType: 'companies', name: 'zia_service_line', label: 'Service Line', type: 'enumeration', fieldType: 'select', groupName: 'companyinformation', options: [
    { label: 'Leadership Development', value: 'leadership_development' },
    { label: 'Organizational Design', value: 'organizational_design' },
    { label: 'Training & Coaching', value: 'training_coaching' },
    { label: 'Change Management', value: 'change_management' },
    { label: 'Performance Consulting', value: 'performance_consulting' }
  ]},
  { objectType: 'companies', name: 'zia_org_size', label: 'Organization Size', type: 'string', fieldType: 'text', groupName: 'companyinformation' },
  { objectType: 'companies', name: 'zia_industry', label: 'Industry', type: 'string', fieldType: 'text', groupName: 'companyinformation' },
  { objectType: 'companies', name: 'zia_client_health', label: 'Client Health', type: 'enumeration', fieldType: 'select', groupName: 'companyinformation', options: [
    { label: 'Healthy', value: 'healthy' },
    { label: 'Watchlist', value: 'watchlist' },
    { label: 'At Risk', value: 'at_risk' },
    { label: 'Critical', value: 'critical' }
  ]},
  { objectType: 'deals', name: 'zia_deal_type', label: 'Deal Type', type: 'enumeration', fieldType: 'select', groupName: 'dealinformation', options: [
    { label: 'Consulting Engagement', value: 'consulting_engagement' },
    { label: 'Program', value: 'program' },
    { label: 'Retainer', value: 'retainer' }
  ]},
  { objectType: 'deals', name: 'zia_service_type', label: 'Service Type', type: 'string', fieldType: 'text', groupName: 'dealinformation' },
  { objectType: 'deals', name: 'zia_decision_maker', label: 'Decision Maker', type: 'string', fieldType: 'text', groupName: 'dealinformation' },
  { objectType: 'deals', name: 'zia_expected_launch_date', label: 'Expected Launch Date', type: 'date', fieldType: 'date', groupName: 'dealinformation' },
  { objectType: 'deals', name: 'zia_onboarding_status', label: 'Onboarding Status', type: 'enumeration', fieldType: 'select', groupName: 'dealinformation', options: [
    { label: 'Not Started', value: 'not_started' },
    { label: 'In Progress', value: 'in_progress' },
    { label: 'Completed', value: 'completed' },
    { label: 'Delayed', value: 'delayed' }
  ]},
  { objectType: 'deals', name: 'zia_primary_challenge', label: 'Primary Challenge', type: 'string', fieldType: 'text', groupName: 'dealinformation' },
  { objectType: 'tickets', name: 'zia_ticket_type', label: 'Ticket Type', type: 'enumeration', fieldType: 'select', groupName: 'ticketinformation', options: [
    { label: 'Onboarding Issue', value: 'onboarding_issue' },
    { label: 'Client Feedback', value: 'client_feedback' },
    { label: 'Program Support', value: 'program_support' }
  ]},
  { objectType: 'tickets', name: 'zia_sla_status', label: 'SLA Status', type: 'enumeration', fieldType: 'select', groupName: 'ticketinformation', options: [
    { label: 'On Track', value: 'on_track' },
    { label: 'At Risk', value: 'at_risk' },
    { label: 'Breached', value: 'breached' }
  ]}
];

function apiRequest(path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = https.request(`https://api.hubapi.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  for (const prop of properties) {
    const objectType = prop.objectType;
    const body = {
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      groupName: prop.groupName || groupNameByObject[objectType],
      ...(prop.options ? { options: prop.options } : {})
    };

    try {
      const res = await apiRequest(`/crm/v3/properties/${objectType}`, 'POST', body);
      console.log(`PROPERTY ${objectType}.${prop.name}: ${res.status}`);
      if (res.status >= 400) {
        console.log(JSON.stringify(res.body, null, 2));
      }
    } catch (error) {
      console.error(`Failed to create ${objectType}.${prop.name}: ${error.message}`);
    }
  }
}

main();
