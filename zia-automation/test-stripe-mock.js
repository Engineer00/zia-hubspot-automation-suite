#!/usr/bin/env node
'use strict';
/**
 * Automated Verification Suite for Stripe Backend Mock Server.
 * Tests REST APIs, test card matrix scenarios, and HMAC SHA-256 Webhook signatures.
 */
const { server, evaluateCardNumber, computeStripeSignature } = require('./stripe-mock-server');
const http = require('http');
const crypto = require('crypto');

const PORT = 4001;
const BASE = `http://localhost:${PORT}`;

function request(method, path, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : '';
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (postData) reqHeaders['Content-Length'] = Buffer.byteLength(postData);

    const req = http.request(`${BASE}${path}`, { method, headers: reqHeaders }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

(async () => {
  console.log('='.repeat(66));
  console.log('STRIPE MOCK SERVER VERIFICATION SUITE');
  console.log('='.repeat(66));

  await new Promise(r => server.listen(PORT, r));
  let passed = 0, failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const health = await request('GET', '/health');
    assert(health.status === 200 && health.body.service === 'Stripe Mock Server', 'GET /health returns 200 OK');

    // 2. Customer Creation
    const cus = await request('POST', '/v1/customers', { email: 'test@antigravity.ai', name: 'Antigravity Test' });
    assert(cus.status === 200 && cus.body.id.startsWith('cus_mock_'), `POST /v1/customers created customer (${cus.body.id})`);

    // 3. PaymentIntent Success Card (4242...)
    const piSuccess = await request('POST', '/v1/payment_intents', {
      amount: 12500,
      currency: 'usd',
      card_number: '4242424242424242',
      customer: cus.body.id,
    });
    assert(piSuccess.status === 200 && piSuccess.body.status === 'succeeded', 'POST /v1/payment_intents (4242...) returns succeeded');

    // 4. PaymentIntent Decline Card (4000...0002)
    const piDecline = await request('POST', '/v1/payment_intents', {
      amount: 12500,
      currency: 'usd',
      card_number: '4000000000000002',
    });
    assert(piDecline.body.status === 'requires_payment_method' && piDecline.body.last_payment_error.code === 'card_declined', 'POST /v1/payment_intents (4000...0002) returns card_declined');

    // 5. PaymentIntent 3DS Card (4000...0315)
    const pi3DS = await request('POST', '/v1/payment_intents', {
      amount: 12500,
      currency: 'usd',
      card_number: '4000000000000315',
    });
    assert(pi3DS.body.status === 'requires_action' && pi3DS.body.next_action.type === 'use_stripe_sdk', 'POST /v1/payment_intents (4000...0315) returns requires_action');

    // 6. Checkout Session
    const session = await request('POST', '/v1/checkout/sessions', {
      amount_total: 25000,
      currency: 'usd',
      success_url: 'http://localhost:4000/success',
    });
    assert(session.status === 200 && session.body.id.startsWith('cs_mock_'), `POST /v1/checkout/sessions created session (${session.body.id})`);

    // 7. Subscription
    const sub = await request('POST', '/v1/subscriptions', { customer: cus.body.id });
    assert(sub.status === 200 && sub.body.status === 'active', `POST /v1/subscriptions created active sub (${sub.body.id})`);

    // 8. Refund
    const ref = await request('POST', '/v1/refunds', { payment_intent: piSuccess.body.id, amount: 5000 });
    assert(ref.status === 200 && ref.body.status === 'succeeded', `POST /v1/refunds created refund (${ref.body.id})`);

    // 9. HMAC Webhook Signature Verification Test
    const payload = JSON.stringify({ event: 'payment_intent.succeeded', id: 'evt_123' });
    const secret = 'whsec_test_secret_key_1234567890';
    const timestamp = Math.floor(Date.now() / 1000);
    const sigHeader = computeStripeSignature(payload, secret, timestamp);
    
    // Validate HMAC computation using crypto.timingSafeEqual
    const sigPart = sigHeader.split(',')[1].split('=')[1];
    const expectedHmac = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    const matches = crypto.timingSafeEqual(Buffer.from(sigPart), Buffer.from(expectedHmac));
    assert(matches, 'HMAC SHA-256 Stripe-Signature matches timingSafeEqual verification');

    console.log('='.repeat(66));
    console.log(`VERIFICATION COMPLETE: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(66));

    server.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test runner exception:', err);
    server.close();
    process.exit(1);
  }
})();
