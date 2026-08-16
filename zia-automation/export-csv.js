#!/usr/bin/env node
'use strict';
/**
 * Export the live portal to CSV.
 *
 * WHY
 * The files in `zia_hubspot_demo/seed/` are the ORIGINAL pre-reskin seed: dental
 * practices, `.example` domains, `talent0@lumentalent.com`, $12/hour rates. They
 * describe a business that no longer exists, and `companies.csv` is the very
 * 10,000-row file whose double import created the 20,551-company mess. Anyone
 * importing them today would recreate it.
 *
 * A CSV that disagrees with the CRM is worse than no CSV, because it looks
 * authoritative. So these are generated FROM the portal — the portal is the source
 * of truth, and the export is a view of it.
 *
 * Headers use HubSpot IMPORT labels, not internal names: the import UI matches on
 * label, the API matches on internal name, and mixing them up is the single most
 * common reason a HubSpot import silently maps nothing.
 *
 *   node export-csv.js                    writes to ./export/
 *   node export-csv.js --dir ../somewhere
 */
const fs = require('fs');
const path = require('path');
const { api, listAll, readAssociations, STAGE } = require('./lib/hubspot');

const dIdx = process.argv.indexOf('--dir');
const OUT = dIdx > -1 ? process.argv[dIdx + 1] : path.join(__dirname, 'export');

const STAGE_LABEL = {
  [STAGE.LEAD]: 'Lead', [STAGE.QUALIFIED]: 'Qualified Lead', [STAGE.PROPOSAL]: 'Proposal Sent',
  [STAGE.NEGOTIATION]: 'Negotiation', [STAGE.WON]: 'Closed Won', [STAGE.LOST]: 'Closed Lost',
};
/**
 * Enumeration values are exported with the LABEL HubSpot shows in its own UI, fetched
 * from the property schema — not a title-cased guess at the internal name. Guessing
 * turned `retail_consumer` into "Retail Consumer" when the portal calls it
 * "Retail & Consumer", so the CSV disagreed with the dashboard beside it.
 */
const LABELS = new Map();                       // "object.property.value" -> label
async function loadLabels(objects) {
  for (const o of objects) {
    const r = await api('GET', `/crm/v3/properties/${o}`);
    for (const p of r.results) {
      for (const opt of p.options || []) LABELS.set(`${o}.${p.name}.${opt.value}`, opt.label);
    }
  }
}
const TITLE = s => (s || '').split('_').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
const LBL = (object, prop, value) =>
  value ? (LABELS.get(`${object}.${prop}.${value}`) || TITLE(value)) : '';
/** HubSpot import wants a plain date, not an ISO timestamp. */
const DATE = v => (v || '').slice(0, 10);

/** RFC-4180: quote anything containing a comma, quote or newline; double inner quotes. */
const cell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers, rows) =>
  [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\r\n') + '\r\n';

const write = (name, headers, rows) => {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, toCsv(headers, rows), 'utf8');
  console.log(`  ${name.padEnd(28)} ${String(rows.length).padStart(5)} rows`);
  return rows.length;
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('pulling the live portal...');
  await loadLabels(['companies', 'contacts', 'deals', 'tickets']);

  const [companies, contacts, deals, tickets] = await Promise.all([
    listAll('companies', ['name', 'domain', 'city', 'state', 'numberofemployees',
      'zia_industry', 'zia_company_stage', 'zia_org_size', 'zia_service_line',
      'zia_client_health', 'zia_client_since', 'zia_nps_avg']),
    listAll('contacts', ['firstname', 'lastname', 'email', 'phone', 'zia_contact_type',
      'zia_role', 'zia_source', 'zia_tier', 'zia_coverage_band', 'zia_hours_per_week',
      'zia_cost_rate', 'zia_bench_status', 'zia_compliance_status', 'zia_assessment_profile',
      'zia_lead_score', 'zia_lead_grade', 'zia_territory', 'zia_assigned_pod',
      'zia_nps_score', 'zia_nps_category', 'lifecyclestage', 'hs_lead_status']),
    listAll('deals', ['dealname', 'amount', 'closedate', 'dealstage', 'zia_deal_type',
      'zia_placement_status', 'zia_service_type', 'zia_seats_committed', 'zia_hours_per_week',
      'zia_hourly_rate', 'zia_embed_start_date', 'zia_embed_end_date', 'zia_health_score',
      'zia_health_basis', 'zia_talent_email', 'zia_primary_challenge', 'zia_first_touch_source',
      'zia_invoice_number', 'zia_invoice_status', 'zia_days_outstanding', 'zia_payment_terms']),
    listAll('tickets', ['subject', 'zia_ticket_type', 'hs_pipeline_stage', 'hs_ticket_priority',
      'zia_sla_breached', 'zia_health_score', 'zia_talent_email']),
  ]);

  // HubSpot seeds every portal with its own sample records. They carry no zia_ data
  // and exporting them puts a blank row named 'HubSpot' at the top of the file.
  const isSample = c => /^HubSpot$/i.test((c.properties.name || '').trim());
  const seeded = deals.filter(d => d.properties.zia_deal_type);
  const dealCompany = await readAssociations('deals', 'companies', seeded.map(d => d.id));
  const domainOf = new Map(companies.map(c => [String(c.id), c.properties.domain || '']));

  console.log(`\nwriting to ${OUT}\n`);

  // ---- companies -------------------------------------------------------
  write('companies.csv',
    ['Name', 'Company Domain Name', 'City', 'State/Region', 'Number of Employees',
      'Client Sector', 'Company Stage', 'Organization Size (Staff)', 'Service Line',
      'Client Health', 'Client Since', 'Account NPS'],
    companies.filter(c => !isSample(c)).map(c => {
      const p = c.properties;
      return {
        'Name': p.name, 'Company Domain Name': p.domain, 'City': p.city,
        'State/Region': p.state, 'Number of Employees': p.numberofemployees,
        'Client Sector': LBL('companies','zia_industry',p.zia_industry), 'Company Stage': LBL('companies','zia_company_stage',p.zia_company_stage),
        'Organization Size (Staff)': p.zia_org_size, 'Service Line': LBL('companies','zia_service_line',p.zia_service_line),
        'Client Health': LBL('companies','zia_client_health',p.zia_client_health), 'Client Since': DATE(p.zia_client_since),
        'Account NPS': p.zia_nps_avg,
      };
    }));

  // ---- contacts, split by side of the business -------------------------
  const clients = contacts.filter(c => c.properties.zia_contact_type === 'client_contact');
  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');

  write('contacts_clients.csv',
    ['First Name', 'Last Name', 'Email', 'Phone Number', 'Contact Type', 'Buyer Role',
      'First Touch Source', 'Lead Score', 'Lead Grade', 'Territory', 'Assigned Pod',
      'NPS Score', 'NPS Category', 'Lifecycle Stage', 'Lead Status'],
    clients.map(c => {
      const p = c.properties;
      return {
        'First Name': p.firstname, 'Last Name': p.lastname, 'Email': p.email,
        'Phone Number': p.phone, 'Contact Type': 'Client Contact', 'Buyer Role': LBL('contacts','zia_role',p.zia_role),
        'First Touch Source': LBL('contacts','zia_source',p.zia_source), 'Lead Score': p.zia_lead_score,
        'Lead Grade': p.zia_lead_grade, 'Territory': p.zia_territory,
        'Assigned Pod': p.zia_assigned_pod, 'NPS Score': p.zia_nps_score,
        'NPS Category': LBL('contacts','zia_nps_category',p.zia_nps_category), 'Lifecycle Stage': p.lifecyclestage,
        'Lead Status': p.hs_lead_status,
      };
    }));

  write('contacts_consultants.csv',
    ['First Name', 'Last Name', 'Email', 'Phone Number', 'Contact Type', 'Talent Tier',
      'Coverage Band', 'Hours per Week', 'Cost Rate', 'Bench Status', 'Compliance Status',
      'Assessment Profile'],
    talent.map(c => {
      const p = c.properties;
      return {
        'First Name': p.firstname, 'Last Name': p.lastname, 'Email': p.email,
        'Phone Number': p.phone, 'Contact Type': 'Talent', 'Talent Tier': LBL('contacts','zia_tier',p.zia_tier),
        'Coverage Band': p.zia_coverage_band, 'Hours per Week': p.zia_hours_per_week,
        'Cost Rate': p.zia_cost_rate, 'Bench Status': LBL('contacts','zia_bench_status',p.zia_bench_status),
        'Compliance Status': LBL('contacts','zia_compliance_status',p.zia_compliance_status),
        'Assessment Profile': p.zia_assessment_profile,
      };
    }));

  // ---- deals -----------------------------------------------------------
  // Pipeline and Deal Stage are mandatory columns: HubSpot rejects a deal import
  // without them regardless of how the rest is mapped. The original seed omitted
  // both, which is why the planned import could never have worked.
  const dealRow = d => {
    const p = d.properties;
    const co = (dealCompany.get(String(d.id)) || [])[0];
    return {
      'Deal Name': p.dealname, 'Amount': p.amount, 'Close Date': DATE(p.closedate),
      'Pipeline': 'Sales Pipeline', 'Deal Stage': STAGE_LABEL[p.dealstage] || p.dealstage,
      'Associated Company': co ? domainOf.get(String(co)) : '',
      'Engagement Type': LBL('deals','zia_deal_type',p.zia_deal_type),
      'Service Type': p.zia_service_type,
      'First Touch Source': LBL('deals','zia_first_touch_source',p.zia_first_touch_source),
    };
  };

  const acquisition = seeded.filter(d => !d.properties.zia_placement_status);
  const delivery = seeded.filter(d => d.properties.zia_placement_status);

  write('deals_new_business.csv',
    ['Deal Name', 'Amount', 'Close Date', 'Pipeline', 'Deal Stage', 'Associated Company',
      'Engagement Type', 'Service Type', 'First Touch Source', 'Seats Committed',
      'Primary Challenge', 'Invoice Number', 'Invoice Status', 'Days Outstanding', 'Payment Terms'],
    acquisition.map(d => ({
      ...dealRow(d),
      'Seats Committed': d.properties.zia_seats_committed,
      'Primary Challenge': d.properties.zia_primary_challenge,
      'Invoice Number': d.properties.zia_invoice_number,
      'Invoice Status': LBL('deals','zia_invoice_status',d.properties.zia_invoice_status),
      'Days Outstanding': d.properties.zia_days_outstanding,
      'Payment Terms': (d.properties.zia_payment_terms || '').replace('_', ' ').toUpperCase(),
    })));

  write('deals_delivery.csv',
    ['Deal Name', 'Amount', 'Close Date', 'Pipeline', 'Deal Stage', 'Associated Company',
      'Engagement Type', 'Service Type', 'First Touch Source', 'Placement Status',
      'Hourly Rate', 'Hours Per Week', 'Embed Start Date', 'Embed End Date',
      'Health Score', 'Health Basis', 'Talent Email'],
    delivery.map(d => ({
      ...dealRow(d),
      'Placement Status': LBL('deals','zia_placement_status',d.properties.zia_placement_status),
      'Hourly Rate': d.properties.zia_hourly_rate,
      'Hours Per Week': d.properties.zia_hours_per_week,
      'Embed Start Date': DATE(d.properties.zia_embed_start_date),
      'Embed End Date': DATE(d.properties.zia_embed_end_date),
      'Health Score': d.properties.zia_health_score,
      'Health Basis': d.properties.zia_health_basis,
      'Talent Email': d.properties.zia_talent_email,
    })));

  // ---- tickets ---------------------------------------------------------
  const TICKET_STAGE = { 1: 'New', 2: 'Waiting on contact', 3: 'Waiting on us', 4: 'Closed' };
  write('tickets.csv',
    ['Subject', 'ZIA Ticket Type', 'Ticket Status', 'Priority', 'SLA Breached',
      'Placement Health Score', 'Talent Email'],
    tickets.map(t => {
      const p = t.properties;
      return {
        'Subject': p.subject, 'ZIA Ticket Type': LBL('tickets','zia_ticket_type',p.zia_ticket_type),
        'Ticket Status': TICKET_STAGE[p.hs_pipeline_stage] || p.hs_pipeline_stage,
        'Priority': p.hs_ticket_priority, 'SLA Breached': p.zia_sla_breached,
        'Placement Health Score': p.zia_health_score, 'Talent Email': p.zia_talent_email,
      };
    }));

  // ---- commerce: products, line items (with discounting), quotes ----------
  const [products, lineItems, quotes] = await Promise.all([
    listAll('products', ['name', 'hs_sku', 'price', 'description']),
    listAll('line_items', ['name', 'hs_sku', 'price', 'quantity', 'amount', 'hs_discount_percentage']),
    listAll('quotes', ['hs_title', 'hs_status', 'hs_expiration_date', 'hs_createdate']),
  ]);

  write('products.csv',
    ['Name', 'SKU', 'Unit Price', 'Description'],
    products.map(p => ({
      'Name': p.properties.name, 'SKU': p.properties.hs_sku,
      'Unit Price': p.properties.price, 'Description': p.properties.description,
    })));

  // Line items carry the discounting story — 39% of everything sold is discounted,
  // and `amount` is already NET of it, so list value has to be recomputed here.
  const liDeal = await readAssociations('line_items', 'deals', lineItems.map(l => l.id));
  const dealName = new Map(deals.map(d => [String(d.id), d.properties.dealname]));
  write('line_items.csv',
    ['Deal', 'Product', 'SKU', 'Unit Price', 'Quantity', 'Discount %', 'List Value', 'Net Amount'],
    lineItems.map(l => {
      const q = +l.properties.quantity || 0, pr = +l.properties.price || 0;
      const d = (liDeal.get(String(l.id)) || [])[0];
      return {
        'Deal': d ? dealName.get(String(d)) || '' : '',
        'Product': l.properties.name, 'SKU': l.properties.hs_sku,
        'Unit Price': pr, 'Quantity': q,
        'Discount %': l.properties.hs_discount_percentage || 0,
        'List Value': (pr * q).toFixed(2), 'Net Amount': l.properties.amount,
      };
    }));

  const qDeal = await readAssociations('quotes', 'deals', quotes.map(q => q.id));
  write('quotes.csv',
    ['Quote Title', 'Status', 'Deal', 'Created', 'Expires'],
    quotes.map(q => {
      const d = (qDeal.get(String(q.id)) || [])[0];
      return {
        'Quote Title': q.properties.hs_title, 'Status': q.properties.hs_status,
        'Deal': d ? dealName.get(String(d)) || '' : '',
        'Created': DATE(q.properties.hs_createdate), 'Expires': DATE(q.properties.hs_expiration_date),
      };
    }));

  // ---- documents (attachments) --------------------------------------------
  // Files are PRIVATE, so the export lists metadata, never a public link — a CRM
  // document on a public URL is a data breach, and private files are only reachable
  // through a signed, expiring URL anyway.
  let files = [], after;
  do {
    const qs = new URLSearchParams({ limit: '100' });
    if (after) qs.set('after', after);
    const r = await api('GET', `/files/v3/files/search?${qs}`);
    files.push(...r.results);
    after = r.paging && r.paging.next ? r.paging.next.after : null;
  } while (after);
  write('documents.csv',
    ['File Name', 'Extension', 'Size (bytes)', 'Access', 'Created'],
    files.map(f => ({
      'File Name': f.name, 'Extension': f.extension, 'Size (bytes)': f.size,
      'Access': f.access, 'Created': DATE(f.createdAt),
    })));

  // ---- activity history ----------------------------------------------------
  const [notes, calls, meetings, tasks] = await Promise.all([
    listAll('notes', ['hs_note_body', 'hs_timestamp']),
    listAll('calls', ['hs_call_title', 'hs_timestamp']),
    listAll('meetings', ['hs_meeting_title', 'hs_timestamp']),
    listAll('tasks', ['hs_task_subject', 'hs_timestamp']),
  ]);
  const strip = h => (h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const activity = [
    ...notes.map(n => ({ Type: 'Note', Title: strip(n.properties.hs_note_body).slice(0, 160), When: DATE(n.properties.hs_timestamp) })),
    ...calls.map(c => ({ Type: 'Call', Title: c.properties.hs_call_title, When: DATE(c.properties.hs_timestamp) })),
    ...meetings.map(m => ({ Type: 'Meeting', Title: m.properties.hs_meeting_title, When: DATE(m.properties.hs_timestamp) })),
    ...tasks.map(t => ({ Type: 'Task', Title: t.properties.hs_task_subject, When: DATE(t.properties.hs_timestamp) })),
  ].sort((a, b) => String(a.When).localeCompare(String(b.When)));
  write('activities.csv', ['Type', 'Title', 'When'], activity);

  fs.writeFileSync(path.join(OUT, 'README.md'),
    `# ZIA — CSV export\n\n`
    + `Generated ${new Date().toISOString()} from HubSpot portal 247000083.\n\n`
    + `**These files are a view of the live portal, not a source for it.** The portal is\n`
    + `the source of truth; regenerate with \`node zia-automation/export-csv.js\`.\n\n`
    + `Headers use HubSpot **import labels**, not internal property names — the import UI\n`
    + `matches on label while the API matches on internal name, and confusing the two is\n`
    + `the most common reason a HubSpot import silently maps nothing.\n\n`
    + `\`Pipeline\` and \`Deal Stage\` are included on both deal files because HubSpot\n`
    + `rejects a deal import without them.\n\n`
    + `Do not use \`zia_hubspot_demo/seed/\` — those are the original pre-reskin dental\n`
    + `seed files and describe a business that no longer exists.\n`,
    'utf8');

  console.log('\nwrote README.md');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
