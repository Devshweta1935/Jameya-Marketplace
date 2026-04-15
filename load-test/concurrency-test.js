#!/usr/bin/env node
/**
 * Concurrency Load Test — seat reservation
 *
 * Simulates N users simultaneously trying to reserve the same seat.
 * Expected result: exactly 1 succeeds (HTTP 201), all others get 409.
 *
 * Usage:
 *   node load-test/concurrency-test.js <seat_id> [concurrency]
 *
 * Example:
 *   node load-test/concurrency-test.js "YOUR-SEAT-UUID" 20
 *
 * Prerequisites:
 *   - Server running on http://localhost:3000
 *   - seat_id exists in DB with status = AVAILABLE
 */

const http = require('http');

const SEAT_ID = process.argv[2];
const CONCURRENCY = parseInt(process.argv[3] || '20', 10);
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

if (!SEAT_ID) {
  console.error('Usage: node load-test/concurrency-test.js <seat_id> [concurrency]');
  process.exit(1);
}

function reserveSeat(userId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ user_id: userId });
    const url = new URL(`/seats/${SEAT_ID}/reserve`, BASE_URL);

    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: JSON.parse(data) });
      });
    });

    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.write(body);
    req.end();
  });
}

async function runTest() {
  console.log(`\n🚀 Firing ${CONCURRENCY} concurrent requests for seat: ${SEAT_ID}\n`);
  console.log('─'.repeat(60));

  const promises = Array.from({ length: CONCURRENCY }, (_, i) =>
    reserveSeat(`user-${i + 1}`)
  );

  const results = await Promise.all(promises);

  // ── Summary ──────────────────────────────────────────────────────────────
  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);
  const errors    = results.filter((r) => r.status !== 201 && r.status !== 409);

  console.log('\n📊 Results:');
  console.log(`  ✅ 201 Created (reserved):  ${successes.length}`);
  console.log(`  ⚡ 409 Conflict (rejected): ${conflicts.length}`);
  console.log(`  ❌ Other errors:            ${errors.length}`);
  console.log('─'.repeat(60));

  if (successes.length === 1) {
    console.log('\n✅ PASS — Exactly one reservation succeeded. No double booking.\n');
    console.log('   Winning booking_id:', successes[0].body.booking_id);
  } else if (successes.length === 0) {
    console.log('\n❌ FAIL — No reservation succeeded (seat may already be reserved).\n');
  } else {
    console.log(`\n🚨 FAIL — Double booking detected! ${successes.length} reservations succeeded.\n`);
    successes.forEach((r, i) => {
      console.log(`   [${i + 1}] booking_id: ${r.body.booking_id}`);
    });
  }

  if (errors.length > 0) {
    console.log('\n⚠️  Unexpected errors:');
    errors.forEach((r) => console.log('  ', r));
  }
}

runTest().catch(console.error);
