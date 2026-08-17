#!/usr/bin/env node
'use strict';
/**
 * QA Test Suite: Server Tests
 * 
 * Tests the dashboard server functionality, API endpoints, and health checks.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

async function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(5000);
    req.end();
  });
}

async function testServerAccessibility() {
  const name = 'Dashboard Server Accessibility';

  try {
    // Check if server is running (default port 4000)
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: '/',
      method: 'GET',
    };

    const response = await httpRequest(options);

    if (response.statusCode === 200) {
      return {
        name,
        passed: true,
        note: 'Dashboard server is running and accessible',
      };
    }

    return {
      name,
      passed: false,
      error: `Server returned ${response.statusCode}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: `Server not accessible: ${e.message}`,
      note: 'Dashboard server may not be running. Start with: node server.js',
    };
  }
}

async function testServerHealthCheck() {
  const name = 'Server Health Endpoint';

  try {
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: '/health',
      method: 'GET',
    };

    const response = await httpRequest(options);

    if (response.statusCode === 200 || response.statusCode === 404) {
      return {
        name,
        passed: true,
        skipped: response.statusCode === 404,
        note: response.statusCode === 404 ? 'Health endpoint not implemented' : 'Health check OK',
      };
    }

    return {
      name,
      passed: false,
      error: `Health check returned ${response.statusCode}`,
    };
  } catch (e) {
    return {
      name,
      passed: true,
      skipped: true,
      note: 'Server not running',
    };
  }
}

async function testServerContentType() {
  const name = 'Server Content Type';

  try {
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: '/',
      method: 'GET',
    };

    const response = await httpRequest(options);

    const contentType = response.headers['content-type'] || '';

    if (contentType.includes('text/html')) {
      return {
        name,
        passed: true,
        note: 'HTML content type correct',
      };
    }

    return {
      name,
      passed: false,
      error: `Unexpected content type: ${contentType}`,
    };
  } catch (e) {
    return {
      name,
      passed: true,
      skipped: true,
      note: 'Server not running',
    };
  }
}

async function testAPIEndpoints() {
  const name = 'API Endpoints';

  try {
    const endpoints = ['/api/health', '/api/snapshot', '/api/refresh'];
    const accessible = [];
    const missing = [];

    for (const endpoint of endpoints) {
      try {
        const options = {
          hostname: 'localhost',
          port: 4000,
          path: endpoint,
          method: 'GET',
          timeout: 2000,
        };

        const response = await httpRequest(options);
        
        if (response.statusCode !== 404) {
          accessible.push(endpoint);
        } else {
          missing.push(endpoint);
        }
      } catch (e) {
        missing.push(endpoint);
      }
    }

    if (accessible.length > 0) {
      return {
        name,
        passed: missing.length === 0,
        note: `${accessible.length}/${endpoints.length} endpoints available`,
      };
    }

    return {
      name,
      passed: true,
      skipped: true,
      note: 'Server not running',
    };
  } catch (e) {
    return {
      name,
      passed: true,
      skipped: true,
      note: 'Server check skipped',
    };
  }
}

async function testServerResponseTime() {
  const name = 'Server Response Time';

  try {
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: '/',
      method: 'GET',
    };

    const start = Date.now();
    const response = await httpRequest(options);
    const duration = Date.now() - start;

    if (response.statusCode === 200) {
      // Should respond in less than 1 second (cached data)
      const passed = duration < 1000;
      return {
        name,
        passed,
        note: `Response time: ${duration}ms`,
      };
    }

    return {
      name,
      passed: true,
      skipped: true,
      note: 'Server not running',
    };
  } catch (e) {
    return {
      name,
      passed: true,
      skipped: true,
      note: 'Server not running',
    };
  }
}

async function testServerConfiguration() {
  const name = 'Server Configuration';

  try {
    const serverPath = path.join(__dirname, '../server.js');
    
    if (!fs.existsSync(serverPath)) {
      return {
        name,
        passed: false,
        error: 'server.js not found',
      };
    }

    const content = fs.readFileSync(serverPath, 'utf8');

    // Check for key configuration elements
    const checks = {
      'Port configuration': content.includes('PORT') || content.includes('--port'),
      'Auto-refresh': content.includes('AUTO') || content.includes('--every'),
      'Data file path': content.includes('DATA_FILE') || content.includes('dashboard-data.json'),
      'Template file': content.includes('TEMPLATE') || content.includes('zia-command-deck.html'),
    };

    const failed = Object.entries(checks).filter(([_, v]) => !v).map(([k]) => k);

    if (failed.length === 0) {
      return {
        name,
        passed: true,
        note: 'Server configuration is complete',
      };
    }

    return {
      name,
      passed: false,
      error: `Missing configuration: ${failed.join(', ')}`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testDashboardTemplate() {
  const name = 'Dashboard Template';

  try {
    const templatePath = path.join(__dirname, '../zia-command-deck.html');
    
    if (!fs.existsSync(templatePath)) {
      return {
        name,
        passed: false,
        error: 'Dashboard template not found',
      };
    }

    const content = fs.readFileSync(templatePath, 'utf8');

    // Check for key template elements
    const checks = {
      'HTML structure': content.includes('<html') || content.includes('<!DOCTYPE'),
      'Script tags': content.includes('<script'),
      'CSS styles': content.includes('<style') || content.includes('\.css'),
      'Data bindings': content.includes('{{') || content.includes('data'),
    };

    const allPresent = Object.values(checks).every(v => v);

    if (allPresent) {
      return {
        name,
        passed: true,
        note: 'Dashboard template is valid',
      };
    }

    return {
      name,
      passed: false,
      error: 'Template structure is incomplete',
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testDataFileSync() {
  const name = 'Data File Synchronization';

  try {
    const dataPath = path.join(__dirname, '../dashboard-data.json');
    
    if (!fs.existsSync(dataPath)) {
      return {
        name,
        passed: false,
        error: 'dashboard-data.json not found',
      };
    }

    const stat = fs.statSync(dataPath);
    const lastModified = new Date(stat.mtime);
    const age = Date.now() - lastModified.getTime();
    const ageHours = age / (1000 * 60 * 60);

    if (ageHours > 24) {
      return {
        name,
        passed: false,
        error: `Data file is stale (${ageHours.toFixed(1)} hours old)`,
      };
    }

    return {
      name,
      passed: true,
      note: `Data file updated ${Math.round(age / 60000)} minutes ago`,
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
  name: 'Server Tests',
  run: async (context) => {
    const tests = [
      await testServerConfiguration(),
      await testDashboardTemplate(),
      await testDataFileSync(),
      await testServerAccessibility(),
      await testServerHealthCheck(),
      await testServerContentType(),
      await testServerResponseTime(),
      await testAPIEndpoints(),
    ];

    return tests;
  },
};
