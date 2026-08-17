#!/usr/bin/env node
'use strict';
/**
 * QA Test Utilities
 * 
 * Common functions and utilities for QA tests.
 */

const config = require('./qa-config.json');

class TestResult {
  constructor(name, passed = false, options = {}) {
    this.name = name;
    this.passed = passed;
    this.skipped = options.skipped || false;
    this.error = options.error || null;
    this.note = options.note || null;
    this.duration = options.duration || null;
    this.data = options.data || null;
  }

  static pass(name, options = {}) {
    return new TestResult(name, true, options);
  }

  static fail(name, error, options = {}) {
    return new TestResult(name, false, { ...options, error });
  }

  static skip(name, note, options = {}) {
    return new TestResult(name, false, { ...options, skipped: true, note });
  }

  toJSON() {
    const obj = {
      name: this.name,
      passed: this.passed,
      skipped: this.skipped,
    };

    if (this.error) obj.error = this.error;
    if (this.note) obj.note = this.note;
    if (this.duration !== null) obj.duration = this.duration;
    if (this.data) obj.data = this.data;

    return obj;
  }
}

/**
 * Retry a function with exponential backoff
 */
async function retry(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoffFactor = 2,
    onRetry = null,
  } = options;

  let lastError;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;

      if (attempt < maxAttempts) {
        if (onRetry) onRetry(attempt, delay, e);
        await new Promise(r => setTimeout(r, delay));
        delay *= backoffFactor;
      }
    }
  }

  throw lastError;
}

/**
 * Timeout wrapper for async operations
 */
async function withTimeout(promise, timeoutMs, timeoutMessage = 'Operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

/**
 * Measure execution time
 */
async function measureTime(fn) {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

/**
 * Format milliseconds to human-readable time
 */
function formatTime(ms) {
  if (ms < 1000) return ms.toFixed(0) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}

/**
 * Validate numeric range
 */
function inRange(value, min, max, name = 'value') {
  if (typeof value !== 'number') {
    throw new Error(`${name} is not a number`);
  }

  if (value < min || value > max) {
    throw new Error(`${name} ${value} is not in range [${min}, ${max}]`);
  }

  return true;
}

/**
 * Validate required fields in object
 */
function hasRequiredFields(obj, fields, name = 'object') {
  const missing = fields.filter(f => !(f in obj));

  if (missing.length > 0) {
    throw new Error(`${name} missing fields: ${missing.join(', ')}`);
  }

  return true;
}

/**
 * Compare two values with tolerance
 */
function withinTolerance(actual, expected, toleranceFraction = 0.05, name = 'value') {
  if (actual === expected) return true;

  if (expected === 0) {
    return actual === 0;
  }

  const diff = Math.abs((actual - expected) / expected);
  const tolerance = toleranceFraction;

  if (diff > tolerance) {
    throw new Error(
      `${name}: ${actual} is not within ${(tolerance * 100).toFixed(1)}% of expected ${expected}. ` +
      `Difference: ${(diff * 100).toFixed(1)}%`
    );
  }

  return true;
}

/**
 * Validate date format
 */
function isValidISODate(dateString) {
  if (typeof dateString !== 'string') return false;
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Get threshold for a specific test
 */
function getThreshold(testType, metric = null) {
  const thresholds = config.qa.thresholds;

  if (metric) {
    return thresholds[testType]?.[metric];
  }

  return thresholds[testType];
}

/**
 * Get timeout for a specific suite
 */
function getTimeout(suiteName) {
  return config.qa.timeouts[suiteName] || config.qa.timeouts.singleTest;
}

/**
 * Get sample size limit for data tests
 */
function getSampleSize(type) {
  return config.qa.sampling[type] || 100;
}

/**
 * Get config section
 */
function getConfig(section) {
  return config.qa[section] || config[section] || null;
}

/**
 * Validate all required rules exist
 */
function validateRules(rules) {
  const required = config.rules.requiredRules;
  const found = rules.map(r => r.id.toLowerCase());
  const missing = required.filter(r => !found.includes(r.toLowerCase()));

  if (missing.length > 0) {
    throw new Error(`Missing required rules: ${missing.join(', ')}`);
  }

  return true;
}

/**
 * Count writes in a rule result
 */
function countWrites(result) {
  const writeKeys = config.rules.writeKeys;
  return writeKeys.reduce((sum, key) => sum + (result[key] || 0), 0);
}

/**
 * Format test summary
 */
function formatSummary(results) {
  const total = results.length;
  const passed = results.filter(r => r.passed && !r.skipped).length;
  const failed = results.filter(r => !r.passed && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  return {
    total,
    passed,
    failed,
    skipped,
    successRate: total > 0 ? ((passed / (total - skipped)) * 100).toFixed(1) : 0,
  };
}

module.exports = {
  TestResult,
  retry,
  withTimeout,
  measureTime,
  formatBytes,
  formatTime,
  inRange,
  hasRequiredFields,
  withinTolerance,
  isValidISODate,
  isValidEmail,
  getThreshold,
  getTimeout,
  getSampleSize,
  getConfig,
  validateRules,
  countWrites,
  formatSummary,
  config,
};
