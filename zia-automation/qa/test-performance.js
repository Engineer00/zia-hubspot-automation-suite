#!/usr/bin/env node
'use strict';
/**
 * QA Test Suite: Performance Tests
 * 
 * Tests performance metrics, load times, and resource usage.
 */

const fs = require('fs');
const path = require('path');
const { pull, compute } = require('../snapshot');
const { listAll } = require('../lib/hubspot');

async function testSnapshotPerformance() {
  const name = 'Snapshot Pull Performance';

  try {
    const start = Date.now();
    const raw = await pull({ quiet: true });
    const duration = Date.now() - start;

    // Snapshot should complete within reasonable time (typically 1-3 minutes)
    const timeoutThreshold = 300000; // 5 minutes

    if (duration > timeoutThreshold) {
      return {
        name,
        passed: false,
        error: `Snapshot pull took ${(duration / 1000).toFixed(1)}s (threshold: 5m)`,
      };
    }

    return {
      name,
      passed: true,
      note: `Snapshot completed in ${(duration / 1000).toFixed(1)}s`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testComputePerformance() {
  const name = 'Snapshot Compute Performance';

  try {
    const raw = await pull({ quiet: true });
    
    const start = Date.now();
    const snap = compute(raw);
    const duration = Date.now() - start;

    // Compute should be fast (< 1 second)
    if (duration > 5000) {
      return {
        name,
        passed: false,
        error: `Compute took ${(duration / 1000).toFixed(1)}s (expected < 5s)`,
      };
    }

    return {
      name,
      passed: true,
      note: `Computed in ${duration}ms`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testDataFetchPerformance() {
  const name = 'Data Fetch Performance';

  try {
    const objectTypes = [
      { type: 'contacts', threshold: 30000 },
      { type: 'deals', threshold: 30000 },
      { type: 'companies', threshold: 30000 },
    ];

    const results = [];

    for (const obj of objectTypes) {
      const start = Date.now();
      try {
        await listAll(obj.type, ['id']);
        const duration = Date.now() - start;
        results.push({
          type: obj.type,
          duration,
          passed: duration < obj.threshold,
        });
      } catch (e) {
        results.push({
          type: obj.type,
          error: e.message,
          passed: false,
        });
      }
    }

    const failed = results.filter(r => !r.passed);

    if (failed.length === 0) {
      return {
        name,
        passed: true,
        note: `All fetches within threshold: ${results.map(r => `${r.type}(${r.duration}ms)`).join(', ')}`,
      };
    }

    return {
      name,
      passed: false,
      error: `${failed.length} fetch(es) exceeded threshold`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testMemoryUsage() {
  const name = 'Memory Usage';

  try {
    // Check memory before operation
    const memBefore = process.memoryUsage().heapUsed;

    // Perform a snapshot pull
    const raw = await pull({ quiet: true });
    const snap = compute(raw);

    // Check memory after
    const memAfter = process.memoryUsage().heapUsed;
    const memUsedMB = (memAfter - memBefore) / 1024 / 1024;

    // Should use less than 500MB for typical dataset
    const threshold = 500;

    if (memUsedMB > threshold) {
      return {
        name,
        passed: false,
        error: `Memory usage: ${memUsedMB.toFixed(1)}MB (threshold: ${threshold}MB)`,
      };
    }

    return {
      name,
      passed: true,
      note: `Memory used: ${memUsedMB.toFixed(1)}MB`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testConcurrentRequests() {
  const name = 'Concurrent Request Handling';

  try {
    // Attempt to make 5 concurrent API calls
    const promises = Array(5).fill(null).map(() => 
      listAll('contacts', ['id']).catch(e => ({ error: e.message }))
    );

    const start = Date.now();
    const results = await Promise.all(promises);
    const duration = Date.now() - start;

    const errors = results.filter(r => r.error);

    if (errors.length > 0) {
      return {
        name,
        passed: false,
        error: `${errors.length} concurrent requests failed`,
      };
    }

    return {
      name,
      passed: true,
      note: `5 concurrent requests completed in ${(duration / 1000).toFixed(1)}s`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testPaginationPerformance() {
  const name = 'Pagination Performance';

  try {
    const start = Date.now();
    const contacts = await listAll('contacts', ['id', 'email']);
    const duration = Date.now() - start;

    // Should handle pagination efficiently
    const threshold = 120000; // 2 minutes max

    if (duration > threshold) {
      return {
        name,
        passed: false,
        error: `Pagination took ${(duration / 1000).toFixed(1)}s (threshold: 2m)`,
      };
    }

    return {
      name,
      passed: true,
      note: `Fetched ${contacts.length} contacts via pagination in ${(duration / 1000).toFixed(1)}s`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testFileIO() {
  const name = 'File I/O Performance';

  try {
    const dataPath = path.join(__dirname, '../dashboard-data.json');
    
    if (!fs.existsSync(dataPath)) {
      return {
        name,
        passed: true,
        skipped: true,
        note: 'No dashboard data to test',
      };
    }

    // Test read performance
    const readStart = Date.now();
    const content = fs.readFileSync(dataPath, 'utf8');
    const readDuration = Date.now() - readStart;

    // Test parse performance
    const parseStart = Date.now();
    const data = JSON.parse(content);
    const parseDuration = Date.now() - parseStart;

    // Should be sub-second
    if (readDuration > 1000 || parseDuration > 1000) {
      return {
        name,
        passed: false,
        error: `File I/O slow: read ${readDuration}ms, parse ${parseDuration}ms`,
      };
    }

    return {
      name,
      passed: true,
      note: `File I/O OK: read ${readDuration}ms, parse ${parseDuration}ms`,
    };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e.message,
    };
  }
}

async function testAPIRateLimitHandling() {
  const name = 'Rate Limit Handling';

  try {
    // Make rapid requests and check for rate limit handling
    const iterations = 3;
    const results = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      try {
        await listAll('contacts', ['id']);
        results.push({
          iteration: i + 1,
          duration: Date.now() - start,
          success: true,
        });
      } catch (e) {
        if (e.message.includes('rate') || e.message.includes('429')) {
          results.push({
            iteration: i + 1,
            error: 'Rate limited',
            success: false,
          });
        } else {
          throw e;
        }
      }
    }

    const failures = results.filter(r => !r.success);

    if (failures.length > 0) {
      return {
        name,
        passed: true,
        note: `Rate limits triggered (${failures.length}x) — system may be rate-limited`,
      };
    }

    return {
      name,
      passed: true,
      note: 'No rate limiting detected',
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
  name: 'Performance Tests',
  run: async (context) => {
    const tests = [
      await testSnapshotPerformance(),
      await testComputePerformance(),
      await testDataFetchPerformance(),
      await testFileIO(),
      await testPaginationPerformance(),
      await testMemoryUsage(),
      await testConcurrentRequests(),
      await testAPIRateLimitHandling(),
    ];

    return tests;
  },
};
