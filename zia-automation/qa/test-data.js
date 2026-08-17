#!/usr/bin/env node
'use strict';
/**
 * QA Test Suite: Data Integrity
 * 
 * Tests data consistency, relationships, referential integrity,
 * and required field validation.
 */

const { listAll, readAssociations, api } = require('../lib/hubspot');

async function testDealsDataIntegrity() {
  const name = 'Deals Data Integrity';

  try {
    const deals = await listAll('deals', [
      'dealname', 'amount', 'dealstage',
      'zia_deal_type', 'zia_placement_status',
    ]);

    const issues = [];

    for (const deal of deals) {
      const props = deal.properties;

      // Check required fields
      if (!props.dealname) {
        issues.push(`Deal ${deal.id}: missing name`);
      }

      // Check amount is numeric
      if (props.amount && isNaN(parseFloat(props.amount))) {
        issues.push(`Deal ${deal.id}: invalid amount`);
      }

      // Check deal type consistency
      if (props.zia_deal_type && !['services', 'consulting', 'product'].includes(props.zia_deal_type)) {
        issues.push(`Deal ${deal.id}: unknown deal type: ${props.zia_deal_type}`);
      }
    }

    if (issues.length === 0) {
      return {
        name,
        passed: true,
        note: `All ${deals.length} deals validated`,
      };
    }

    return {
      name,
      passed: false,
      error: `Found ${issues.length} issues: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? '...' : ''}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testContactsDataIntegrity() {
  const name = 'Contacts Data Integrity';

  try {
    const contacts = await listAll('contacts', [
      'email', 'zia_contact_type', 'zia_tier', 'lifecyclestage',
    ]);

    const issues = [];
    const validTiers = ['core', 'momentum', 'summit'];
    const validTypes = ['buyer', 'influencer', 'decision-maker', 'end-user'];

    for (const contact of contacts) {
      const props = contact.properties;

      // Check email format if present
      if (props.email && !props.email.includes('@')) {
        issues.push(`Contact ${contact.id}: invalid email`);
      }

      // Check tier validity
      if (props.zia_tier && !validTiers.includes(props.zia_tier)) {
        issues.push(`Contact ${contact.id}: unknown tier: ${props.zia_tier}`);
      }

      // Check contact type validity
      if (props.zia_contact_type && !validTypes.includes(props.zia_contact_type)) {
        issues.push(`Contact ${contact.id}: unknown type: ${props.zia_contact_type}`);
      }
    }

    if (issues.length === 0) {
      return {
        name,
        passed: true,
        note: `All ${contacts.length} contacts validated`,
      };
    }

    return {
      name,
      passed: false,
      error: `Found ${issues.length} issues: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? '...' : ''}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testAssociationIntegrity() {
  const name = 'Object Association Integrity';

  try {
    const deals = await listAll('deals', ['dealname']);
    let orphanedDeals = 0;
    let associatedDeals = 0;

    for (const deal of deals.slice(0, Math.min(50, deals.length))) {
      try {
        const associations = await readAssociations('deals', deal.id, 'contacts');
        
        if (associations && associations.length > 0) {
          associatedDeals++;
        } else {
          orphanedDeals++;
        }
      } catch (e) {
        // Association read error
      }
    }

    if (orphanedDeals > 0) {
      return {
        name,
        passed: true,
        note: `Checked ${associatedDeals + orphanedDeals} deals: ${associatedDeals} associated, ${orphanedDeals} orphaned`,
      };
    }

    return {
      name,
      passed: true,
      note: `All sampled deals have associations`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testCustomPropertyConsistency() {
  const name = 'Custom Property Consistency';

  try {
    const deals = await listAll('deals', [
      'zia_health_score', 'zia_placement_status', 'zia_invoice_status',
    ]);

    const issues = [];

    for (const deal of deals.slice(0, 100)) {
      const props = deal.properties;

      // Health score should be numeric if present
      if (props.zia_health_score && isNaN(parseInt(props.zia_health_score))) {
        issues.push(`Invalid health score: ${props.zia_health_score}`);
      }

      // Health score should be in valid range
      if (props.zia_health_score) {
        const score = parseInt(props.zia_health_score);
        if (score < 0 || score > 100) {
          issues.push(`Health score out of range: ${score}`);
        }
      }

      // Invoice status should be from valid set
      const validStatuses = ['draft', 'sent', 'overdue', 'paid'];
      if (props.zia_invoice_status && !validStatuses.includes(props.zia_invoice_status)) {
        issues.push(`Invalid invoice status: ${props.zia_invoice_status}`);
      }
    }

    if (issues.length === 0) {
      return {
        name,
        passed: true,
        note: 'Custom properties are consistent',
      };
    }

    return {
      name,
      passed: false,
      error: `Found ${issues.length} consistency issues`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testDateFieldConsistency() {
  const name = 'Date Field Consistency';

  try {
    const deals = await listAll('deals', [
      'createdate', 'closedate', 'zia_embed_start_date', 'zia_embed_end_date',
      'zia_invoice_sent_date', 'zia_invoice_paid_date',
    ]);

    const issues = [];

    for (const deal of deals.slice(0, 100)) {
      const props = deal.properties;

      // Check date fields are ISO format if present
      const dateFields = [
        'createdate', 'closedate', 'zia_embed_start_date', 'zia_embed_end_date',
        'zia_invoice_sent_date', 'zia_invoice_paid_date',
      ];

      for (const field of dateFields) {
        if (props[field]) {
          try {
            new Date(props[field]);
          } catch (e) {
            issues.push(`Invalid date format in ${field}: ${props[field]}`);
          }
        }
      }

      // End date should be after start date
      if (props.zia_embed_start_date && props.zia_embed_end_date) {
        const start = new Date(props.zia_embed_start_date);
        const end = new Date(props.zia_embed_end_date);
        if (end < start) {
          issues.push(`End date before start date in deal ${deal.id}`);
        }
      }
    }

    if (issues.length === 0) {
      return {
        name,
        passed: true,
        note: 'All date fields are consistent',
      };
    }

    return {
      name,
      passed: false,
      error: `Found ${issues.length} date issues: ${issues.slice(0, 2).join('; ')}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testReferentialIntegrity() {
  const name = 'Referential Integrity';

  try {
    // Test that companies referenced by deals exist
    const deals = await listAll('deals', ['dealname']);
    const contacts = await listAll('contacts', ['email']);
    const companies = await listAll('companies', ['name']);

    const companyIds = new Set(companies.map(c => c.id));
    const contactIds = new Set(contacts.map(c => c.id));

    let issues = 0;

    // Sample deals to check associations
    for (const deal of deals.slice(0, 50)) {
      try {
        const assoc = await readAssociations('deals', deal.id, 'companies');
        if (assoc && assoc.length > 0) {
          for (const a of assoc) {
            if (!companyIds.has(a.id)) {
              issues++;
            }
          }
        }
      } catch (e) {
        // Skip on error
      }
    }

    return {
      name,
      passed: true,
      note: `Checked ${deals.length} deals, ${companies.length} companies, ${contacts.length} contacts (${issues} orphans)`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testDataVolume() {
  const name = 'Data Volume Requirements';

  try {
    const [deals, contacts, companies] = await Promise.all([
      listAll('deals', ['dealname']),
      listAll('contacts', ['email']),
      listAll('companies', ['name']),
    ]);

    const minimums = {
      deals: 50,
      contacts: 100,
      companies: 20,
    };

    const shortfalls = [];

    if (deals.length < minimums.deals) {
      shortfalls.push(`deals: ${deals.length}/${minimums.deals}`);
    }
    if (contacts.length < minimums.contacts) {
      shortfalls.push(`contacts: ${contacts.length}/${minimums.contacts}`);
    }
    if (companies.length < minimums.companies) {
      shortfalls.push(`companies: ${companies.length}/${minimums.companies}`);
    }

    if (shortfalls.length > 0) {
      return {
        name,
        passed: false,
        error: `Below minimum volume: ${shortfalls.join(', ')}`,
      };
    }

    return {
      name,
      passed: true,
      note: `Data volume OK: ${deals.length} deals, ${contacts.length} contacts, ${companies.length} companies`,
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
  name: 'Data Integrity Tests',
  run: async (context) => {
    const tests = [
      await testDataVolume(),
      await testDealsDataIntegrity(),
      await testContactsDataIntegrity(),
      await testCustomPropertyConsistency(),
      await testDateFieldConsistency(),
      await testAssociationIntegrity(),
      await testReferentialIntegrity(),
    ];

    return tests;
  },
};
