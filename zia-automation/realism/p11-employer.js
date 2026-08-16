'use strict';
/**
 * P11 — give the consultants the right employer.
 *
 * Bug: all 400 consultants shared one primary company, and it was a CLIENT
 * ("Harrowgate Advisory"). Cause: every consultant email is @lumentalent.com, so
 * HubSpot's automatic domain-based company matching attached them all to whichever
 * company owned that domain. P0's reskin then renamed that company and changed its
 * domain — the associations survived the rename and silently became wrong.
 *
 * This is worth understanding rather than just fixing: HubSpot will auto-associate a
 * contact to a company by email domain unless you tell it not to. For a business whose
 * people all share one domain, that default produces exactly this.
 *
 * Fix: create the operating company, move all 400 consultants onto it, and drop the
 * stale association.
 *
 * Idempotent: re-running finds everyone already on the right company and writes nothing.
 *
 *   node realism/p11-employer.js --dry-run
 *   node realism/p11-employer.js
 */
const { api, listAll, pool, readAssociations } = require('../lib/hubspot');

const EMPLOYER = {
  name: 'ZIA Organizational Development',
  domain: 'lumentalent.com',        // the domain the consultant emails actually use
  zia_industry: 'professional_services',
  zia_company_stage: 'active_client',
  country: 'United States',
  city: 'Boston',
  state: 'MA',
  description: 'ZIA operating company. Consultants in the delivery network are associated here, '
    + 'not to client organizations.',
};

const CONTACT_TO_COMPANY = 1;   // primary

module.exports = async function p11({ dryRun }) {
  // ---- find or create the employer ----
  const companies = await listAll('companies', ['name', 'domain']);
  let employer = companies.find(c => c.properties.name === EMPLOYER.name);

  if (!employer) {
    if (dryRun) {
      console.log(`  would create company "${EMPLOYER.name}"`);
    } else {
      const r = await api('POST', '/crm/v3/objects/companies', { properties: EMPLOYER });
      employer = { id: r.id };
      console.log(`  created company "${EMPLOYER.name}" id ${r.id}`);
    }
  } else {
    console.log(`  employer exists: ${EMPLOYER.name} id ${employer.id}`);
  }

  // ---- the consultants ----
  const contacts = await listAll('contacts', ['email', 'zia_contact_type', 'associatedcompanyid']);
  const talent = contacts.filter(c => c.properties.zia_contact_type === 'talent');
  console.log(`  consultants: ${talent.length}`);

  const employerId = employer ? String(employer.id) : null;
  const wrong = talent.filter(c => String(c.properties.associatedcompanyid || '') !== employerId);
  console.log(`  already correct: ${talent.length - wrong.length}   to move: ${wrong.length}`);

  if (dryRun || !wrong.length) {
    return { ok: true, employerId, toMove: wrong.length, moved: 0 };
  }

  // ---- current associations, so the stale one can be removed ----
  const current = await readAssociations('contacts', 'companies', wrong.map(c => c.id));

  let moved = 0, failed = 0;
  await pool(wrong, 4, async c => {
    try {
      // attach to the employer as primary
      await api('PUT', `/crm/v4/objects/contacts/${c.id}/associations/companies/${employerId}`, [
        { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: CONTACT_TO_COMPANY },
      ]);

      // drop every other company association — a consultant has one employer
      for (const old of current.get(String(c.id)) || []) {
        if (old === employerId) continue;
        await api('DELETE', `/crm/v4/objects/contacts/${c.id}/associations/companies/${old}`);
      }
      moved++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.error(`    ! ${c.properties.email}: ${String(e.message).slice(0, 180)}`);
    }
  });

  return { ok: true, employerId, moved, failed };
};

if (require.main === module) {
  module.exports({ dryRun: process.argv.includes('--dry-run') })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e); process.exit(1); });
}
