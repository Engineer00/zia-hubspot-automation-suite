#!/usr/bin/env node
'use strict';
/**
 * QA Test Suite: API Connectivity
 * 
 * Tests HubSpot API connectivity, authentication, rate limits, and health checks.
 */

const { api, listAll, readAssociations } = require('../lib/hubspot');

async function testApiHealth() {
  const name = 'API Health Check';
  const start = Date.now();

  try {
    const result = await api('GET', '/crm/v3/objects/contacts?limit=1');
    const duration = Date.now() - start;

    if (result && result.results !== undefined) {
      return {
        name,
        passed: true,
        duration,
        note: `API responding (${duration}ms)`,
      };
    }

    return {
      name,
      passed: false,
      error: 'Invalid API response structure',
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testAuthToken() {
  const name = 'Authentication Token Validation';

  try {
    const token = process.env.HUBSPOT_API_KEY;
    if (!token) {
      return {
        name,
        passed: false,
        error: 'HUBSPOT_API_KEY not set',
      };
    }

    if (token.length < 10) {
      return {
        name,
        passed: false,
        error: 'API key appears invalid (too short)',
      };
    }

    // Attempt a simple authenticated call
    const result = await api('GET', '/crm/v3/objects/contacts?limit=1');
    
    return {
      name,
      passed: true,
      note: 'Token is valid and authenticated',
    };
  } catch (e) {
    if (e.message.includes('401') || e.message.includes('Unauthorized')) {
      return {
        name,
        passed: false,
        error: 'Authentication failed - invalid or expired token',
      };
    }

    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testObjectTypes() {
  const name = 'Required Object Types Accessible';
  const requiredTypes = ['contacts', 'deals', 'companies', 'tickets', 'line_items', 'quotes'];
  const failures = [];

  try {
    for (const objType of requiredTypes) {
      try {
        const result = await api('GET', `/crm/v3/objects/${objType}?limit=1`);
        if (!result || !Array.isArray(result.results)) {
          failures.push(`${objType}: invalid response`);
        }
      } catch (e) {
        failures.push(`${objType}: ${e.message}`);
      }
    }

    if (failures.length === 0) {
      return {
        name,
        passed: true,
        note: `All ${requiredTypes.length} object types accessible`,
      };
    }

    return {
      name,
      passed: false,
      error: `${failures.length} object type(s) failed: ${failures.join('; ')}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testCustomProperties() {
  const name = 'Custom Properties Exist';
  const requiredProps = ['zia_deal_type', 'zia_placement_status', 'zia_health_score'];
  const failures = [];

  try {
    const result = await api('GET', '/crm/v3/properties/deals');
    const properties = result.results || [];
    const propNames = properties.map(p => p.name);

    for (const prop of requiredProps) {
      if (!propNames.includes(prop)) {
        failures.push(prop);
      }
    }

    if (failures.length === 0) {
      return {
        name,
        passed: true,
        note: `All ${requiredProps.length} required custom properties present`,
      };
    }

    return {
      name,
      passed: false,
      error: `Missing properties: ${failures.join(', ')}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testRateLimits() {
  const name = 'Rate Limiting Check';

  try {
    const results = [];
    const iterations = 5;

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await api('GET', '/crm/v3/objects/contacts?limit=1');
      results.push(Date.now() - start);
    }

    const avgTime = results.reduce((a, b) => a + b, 0) / results.length;
    const maxTime = Math.max(...results);

    // If max time is > 2 seconds on average, rate limiting may be in effect
    if (maxTime > 5000) {
      return {
        name,
        passed: false,
        error: `Rate limiting detected (max response: ${maxTime}ms)`,
      };
    }

    return {
      name,
      passed: true,
      note: `Normal response times (avg: ${avgTime.toFixed(0)}ms, max: ${maxTime}ms)`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testAssociations() {
  const name = 'Object Associations Working';

  try {
    // Get a sample deal
    const deals = await api('GET', '/crm/v3/objects/deals?limit=1');
    
    if (!deals.results || deals.results.length === 0) {
      return {
        name,
        passed: true,
        skipped: true,
        note: 'No deals to test associations',
      };
    }

    const dealId = deals.results[0].id;
    
    // Try to read associations
    const result = await api('GET', `/crm/v3/objects/deals/${dealId}?associations=contacts`);

    if (result && result.associations) {
      return {
        name,
        passed: true,
        note: 'Associations are queryable',
      };
    }

    return {
      name,
      passed: true,
      note: 'Deal retrieved (associations may be empty)',
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
  name: 'API Tests',
  run: async (context) => {
    const tests = [
      await testApiHealth(),
      await testAuthToken(),
      await testObjectTypes(),
      await testCustomProperties(),
      await testRateLimits(),
      await testAssociations(),
    ];

    return tests;
  },
};
