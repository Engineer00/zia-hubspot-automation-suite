#!/usr/bin/env node
'use strict';
/**
 * High-Fidelity Local Stripe Backend Mock Server.
 *
 * Provides REST API parity for Stripe APIs without external dependencies:
 *   - /v1/customers
 *   - /v1/payment_intents
 *   - /v1/payment_intents/:id/confirm
 *   - /v1/checkout/sessions
 *   - /v1/subscriptions
 *   - /v1/refunds
 *   - /v1/webhooks/dispatch
 *
 * Features signed Stripe-Signature headers (HMAC SHA-256) and a realistic test-card matrix.
 */
const http = require('http');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 4001;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret_key_1234567890';

// In-memory data store
const db = {
  customers: new Map(),
  paymentIntents: new Map(),
  checkoutSessions: new Map(),
  subscriptions: new Map(),
  refunds: new Map(),
  dispatchedEvents: [],
};

// Helpers
const genId = prefix => `${prefix}_mock_${crypto.randomBytes(12).toString('hex')}`;

function computeStripeSignature(payload, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${payload}`;
  const hmac = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${hmac}`;
}

function parseFormOrJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(body);
        const obj = {};
        for (const [k, v] of params.entries()) {
          const keys = k.replace(/\]/g, '').split('[');
          let curr = obj;
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (i === keys.length - 1) curr[key] = v;
            else curr = curr[key] = curr[key] || {};
          }
        }
        resolve(obj);
      } else {
        resolve({ rawBody: body });
      }
    });
  });
}

function jsonRes(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Test Card Handler
function evaluateCardNumber(cardNumber = '4242424242424242') {
  const sanitized = String(cardNumber).replace(/\s+/g, '');
  if (sanitized === '4000000000000002') {
    return { status: 'requires_payment_method', error: { code: 'card_declined', message: 'Your card was declined.' } };
  }
  if (sanitized === '4000000000000012') {
    return { status: 'requires_payment_method', error: { code: 'incorrect_cvc', message: 'Your card CVC is incorrect.' } };
  }
  if (sanitized === '4000000000000127') {
    return { status: 'requires_payment_method', error: { code: 'insufficient_funds', message: 'Your card has insufficient funds.' } };
  }
  if (sanitized === '4000000000000315') {
    return {
      status: 'requires_action',
      next_action: { type: 'use_stripe_sdk', use_stripe_sdk: { type: 'three_d_secure_redirect', stripe_js: 'https://hooks.stripe.com/redirect/mock' } },
    };
  }
  // Default to instant success
  return { status: 'succeeded', error: null };
}

// Server router
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;


  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await parseFormOrJson(req) : {};

    // 1. Health check
    if (method === 'GET' && (pathname === '/health' || pathname === '/')) {
      return jsonRes(res, 200, {
        status: 'ok',
        service: 'Stripe Mock Server',
        port: PORT,
        activeCustomers: db.customers.size,
        paymentIntents: db.paymentIntents.size,
        webhookEventsDispatched: db.dispatchedEvents.length,
      });
    }

    // 2. Customers: POST /v1/customers
    if (method === 'POST' && pathname === '/v1/customers') {
      const id = genId('cus');
      const customer = {
        id,
        object: 'customer',
        email: body.email || 'customer@example.com',
        name: body.name || 'Jane Doe',
        description: body.description || 'Test Customer',
        metadata: body.metadata || {},
        created: Math.floor(Date.now() / 1000),
      };
      db.customers.set(id, customer);
      return jsonRes(res, 200, customer);
    }

    // 3. Customers: GET /v1/customers/:id
    if (method === 'GET' && pathname.startsWith('/v1/customers/')) {
      const id = pathname.split('/')[3];
      const customer = db.customers.get(id);
      if (!customer) return jsonRes(res, 404, { error: { code: 'resource_missing', message: `No such customer: ${id}` } });
      return jsonRes(res, 200, customer);
    }

    // 4. Payment Intents: POST /v1/payment_intents
    if (method === 'POST' && pathname === '/v1/payment_intents') {
      const id = genId('pi');
      const amount = parseInt(body.amount, 10) || 5000;
      const currency = (body.currency || 'usd').toLowerCase();
      const cardNumber = body.card_number || (body.payment_method_data && body.payment_method_data.card && body.payment_method_data.card.number) || '4242424242424242';
      
      const evalResult = evaluateCardNumber(cardNumber);
      const pi = {
        id,
        object: 'payment_intent',
        amount,
        amount_received: evalResult.status === 'succeeded' ? amount : 0,
        currency,
        customer: body.customer || null,
        status: evalResult.status,
        last_payment_error: evalResult.error || null,
        next_action: evalResult.next_action || null,
        client_secret: `${id}_secret_${crypto.randomBytes(8).toString('hex')}`,
        metadata: body.metadata || {},
        created: Math.floor(Date.now() / 1000),
      };

      db.paymentIntents.set(id, pi);
      return jsonRes(res, 200, pi);
    }

    // 5. Payment Intents: POST /v1/payment_intents/:id/confirm
    if (method === 'POST' && pathname.match(/^\/v1\/payment_intents\/[^\/]+\/confirm$/)) {
      const id = pathname.split('/')[3];
      const pi = db.paymentIntents.get(id);
      if (!pi) return jsonRes(res, 404, { error: { code: 'resource_missing', message: `No such payment_intent: ${id}` } });

      const cardNumber = body.card_number || '4242424242424242';
      const evalResult = evaluateCardNumber(cardNumber);
      pi.status = evalResult.status;
      pi.amount_received = evalResult.status === 'succeeded' ? pi.amount : 0;
      pi.last_payment_error = evalResult.error || null;
      pi.next_action = evalResult.next_action || null;

      db.paymentIntents.set(id, pi);
      return jsonRes(res, 200, pi);
    }

    // 6. Payment Intents: GET /v1/payment_intents/:id
    if (method === 'GET' && pathname.startsWith('/v1/payment_intents/')) {
      const id = pathname.split('/')[3];
      const pi = db.paymentIntents.get(id);
      if (!pi) return jsonRes(res, 404, { error: { code: 'resource_missing', message: `No such payment_intent: ${id}` } });
      return jsonRes(res, 200, pi);
    }

    // 7. Checkout Sessions: POST /v1/checkout/sessions
    if (method === 'POST' && pathname === '/v1/checkout/sessions') {
      const id = genId('cs');
      const session = {
        id,
        object: 'checkout.session',
        customer: body.customer || genId('cus'),
        payment_status: 'paid',
        status: 'complete',
        success_url: body.success_url || 'http://localhost:4000/success',
        cancel_url: body.cancel_url || 'http://localhost:4000/cancel',
        url: `http://localhost:${PORT}/checkout/pay/${id}`,
        amount_total: parseInt(body.amount_total, 10) || 10000,
        currency: body.currency || 'usd',
        metadata: body.metadata || {},
        created: Math.floor(Date.now() / 1000),
      };
      db.checkoutSessions.set(id, session);
      return jsonRes(res, 200, session);
    }

    // 8. Subscriptions: POST /v1/subscriptions
    if (method === 'POST' && pathname === '/v1/subscriptions') {
      const id = genId('sub');
      const sub = {
        id,
        object: 'subscription',
        customer: body.customer || genId('cus'),
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        metadata: body.metadata || {},
        created: Math.floor(Date.now() / 1000),
      };
      db.subscriptions.set(id, sub);
      return jsonRes(res, 200, sub);
    }

    // 9. Refunds: POST /v1/refunds
    if (method === 'POST' && pathname === '/v1/refunds') {
      const id = genId('re');
      const piId = body.payment_intent;
      const pi = db.paymentIntents.get(piId);
      const amount = parseInt(body.amount, 10) || (pi ? pi.amount : 5000);

      const refund = {
        id,
        object: 'refund',
        amount,
        currency: pi ? pi.currency : 'usd',
        payment_intent: piId || genId('pi'),
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
      };
      db.refunds.set(id, refund);
      return jsonRes(res, 200, refund);
    }

    // 10. Webhooks Engine: POST /v1/webhooks/dispatch
    if (method === 'POST' && pathname === '/v1/webhooks/dispatch') {
      const targetUrl = body.targetUrl || body.target_url;
      if (!targetUrl) return jsonRes(res, 400, { error: 'targetUrl parameter is required' });

      const eventType = body.type || 'payment_intent.succeeded';
      const payloadData = body.data || {
        object: {
          id: genId('pi'),
          object: 'payment_intent',
          amount: 15000,
          currency: 'usd',
          status: 'succeeded',
          metadata: body.metadata || { invoice_id: 'INV-1001' },
        },
      };

      const eventPayload = {
        id: genId('evt'),
        object: 'event',
        api_version: '2023-10-16',
        created: Math.floor(Date.now() / 1000),
        type: eventType,
        data: payloadData,
      };

      const rawJson = JSON.stringify(eventPayload);
      const sig = computeStripeSignature(rawJson, body.secret || WEBHOOK_SECRET);

      const destUrl = new URL(targetUrl);
      const postReq = http.request({
        hostname: destUrl.hostname,
        port: destUrl.port || (destUrl.protocol === 'https:' ? 443 : 80),
        path: destUrl.pathname + destUrl.search,
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawJson),
          'Stripe-Signature': sig,
          'User-Agent': 'Stripe-Mock-Webhook/1.0',
        },
      }, webhookRes => {
        let respBody = '';
        webhookRes.on('data', c => { respBody += c; });
        webhookRes.on('end', () => {
          const result = {
            eventId: eventPayload.id,
            type: eventType,
            targetUrl,
            signatureSent: sig,
            statusCode: webhookRes.statusCode,
            response: respBody.slice(0, 300),
          };
          db.dispatchedEvents.push(result);
          jsonRes(res, 200, { ok: true, dispatchResult: result });
        });
      });

      postReq.on('error', err => {
        jsonRes(res, 500, { error: `Webhook dispatch failed to ${targetUrl}: ${err.message}` });
      });

      postReq.write(rawJson);
      postReq.end();
      return;
    }

    return jsonRes(res, 404, { error: { code: 'unsupported_route', message: `Route ${method} ${pathname} not found in Stripe Mock Server` } });
  } catch (err) {
    return jsonRes(res, 500, { error: { message: err.message, stack: err.stack } });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('='.repeat(66));
    console.log(`STRIPE MOCK SERVER running on http://localhost:${PORT}`);
    console.log(`Webhook secret: ${WEBHOOK_SECRET}`);
    console.log('='.repeat(66));
  });
}

module.exports = { server, db, evaluateCardNumber, computeStripeSignature };
