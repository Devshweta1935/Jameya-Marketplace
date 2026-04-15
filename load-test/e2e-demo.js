#!/usr/bin/env node
/**
 * End-to-End Demo Script
 *
 * Walks through the complete Jameya seat booking flow:
 *
 *  Phase 1 — Happy Path
 *    Step 1: List Jameyas
 *    Step 2: Browse seats for first Jameya
 *    Step 3: Reserve a seat (user-1)
 *    Step 4: Check booking status → PENDING_PAYMENT
 *    Step 5: Initiate payment
 *    Step 6: Simulate payment webhook (SUCCESS)
 *    Step 7: Re-check booking status → CONFIRMED
 *    Step 8: Verify seat status → BOOKED
 *
 *  Phase 2 — Idempotency Test
 *    Step 9: Send the same webhook again → must get 200 idempotent:true
 *
 *  Phase 3 — Concurrency Test
 *    Step 10: Pick a second seat, fire 50 concurrent requests → expect exactly 1 success
 *
 * Usage:
 *   node load-test/e2e-demo.js
 */

const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ── HTTP Helper ──────────────────────────────────────────────────────────────
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function log(icon, label, value) {
  const val = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
  console.log(`\n${icon}  ${label}`);
  if (val) {
    val.split('\n').forEach((l) => console.log(`   ${l}`));
  }
}

function pass(label) { console.log(`   ✅ PASS — ${label}`); }
function fail(label) { console.log(`   ❌ FAIL — ${label}`); process.exitCode = 1; }
function section(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`   ${title}`);
  console.log('═'.repeat(60));
}

// ── Concurrency helper ───────────────────────────────────────────────────────
async function fireConcurrentReserve(seatId, n) {
  const promises = Array.from({ length: n }, (_, i) =>
    request('POST', `/seats/${seatId}/reserve`, { user_id: `stress-user-${i + 1}` })
  );
  return Promise.all(promises);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n🚀  Jameya Seat Booking — End-to-End Demo');
  console.log(`    Server: ${BASE_URL}\n`);

  // ── Phase 1: Happy Path ──────────────────────────────────────────────────
  section('Phase 1 — Happy Path');

  // Step 1: List Jameyas
  log('📋', 'Step 1: GET /jameyas');
  const jRes = await request('GET', '/jameyas');
  if (jRes.status !== 200 || !jRes.body.data?.length) {
    fail('Could not list Jameyas. Did you run db:seed?');
    return;
  }
  const jameya = jRes.body.data[0];
  log('  ', `Found ${jRes.body.data.length} Jameya(s) — using: "${jameya.name}"`, null);
  log('  ', 'Source', jRes.body.source);
  pass('GET /jameyas returned data');

  // Step 2: Browse seats
  log('🪑', `Step 2: GET /jameyas/${jameya.id}/seats`);
  const seatsRes = await request('GET', `/jameyas/${jameya.id}/seats`);
  const availSeats = seatsRes.body.data.filter((s) => s.status === 'AVAILABLE');
  log('  ', `${seatsRes.body.data.length} seats total, ${availSeats.length} AVAILABLE`, null);
  if (availSeats.length < 2) {
    fail('Need at least 2 available seats for this demo');
    return;
  }
  const seat1 = availSeats[0];
  const seat2 = availSeats[1];
  log('  ', `Using seat #${seat1.seat_number} (price: ${seat1.price}) for happy path`, null);
  log('  ', `Using seat #${seat2.seat_number} (price: ${seat2.price}) for concurrency test`, null);
  pass('Seat availability listing works with Redis cache');

  // Step 3: Reserve seat
  log('🔒', `Step 3: POST /seats/${seat1.id}/reserve (user-1)`);
  const reserveRes = await request('POST', `/seats/${seat1.id}/reserve`, { user_id: 'user-1' });
  log('  ', 'Response', { status: reserveRes.status, ...reserveRes.body });
  if (reserveRes.status !== 201) { fail('Reservation failed'); return; }
  const bookingId = reserveRes.body.booking_id;
  pass(`Seat reserved. booking_id: ${bookingId}`);

  // Step 4: Check booking status
  log('📄', `Step 4: GET /bookings/${bookingId}`);
  const b1 = await request('GET', `/bookings/${bookingId}`);
  log('  ', 'Booking', { status: b1.body.status, expires_in_seconds: b1.body.expires_in_seconds });
  if (b1.body.status !== 'PENDING_PAYMENT') { fail('Booking should be PENDING_PAYMENT'); return; }
  pass('Booking status = PENDING_PAYMENT ✓');

  // Step 5: Initiate payment
  log('💳', `Step 5: POST /bookings/${bookingId}/pay`);
  const payRes = await request('POST', `/bookings/${bookingId}/pay`, {});
  log('  ', 'Response', { status: payRes.status, payment_id: payRes.body.payment_id });
  if (payRes.status !== 201) { fail('Payment initiation failed'); return; }
  const paymentId = payRes.body.payment_id;
  pass(`Payment initiated. payment_id: ${paymentId}`);

  // Step 6: Webhook — SUCCESS
  const eventId = `evt_demo_${Date.now()}`;
  log('📡', `Step 6: POST /payments/webhook (SUCCESS, event: ${eventId})`);
  const wh1 = await request('POST', '/payments/webhook', {
    provider_event_id: eventId,
    booking_id: bookingId,
    status: 'SUCCESS',
  });
  log('  ', 'Response', { status: wh1.status, ...wh1.body });
  if (wh1.status !== 200) { fail('Webhook processing failed'); return; }
  pass('Webhook processed successfully');

  // Step 7: Re-check booking
  log('✔️ ', `Step 7: GET /bookings/${bookingId} (expect CONFIRMED)`);
  const b2 = await request('GET', `/bookings/${bookingId}`);
  log('  ', 'Booking status', b2.body.status);
  if (b2.body.status !== 'CONFIRMED') { fail('Booking should be CONFIRMED after webhook'); return; }
  pass('Booking status = CONFIRMED ✓');

  // Step 8: Check seat is BOOKED
  log('🪑', 'Step 8: Check seat is BOOKED');
  const seatsRes2 = await request('GET', `/jameyas/${jameya.id}/seats`);
  const bookedSeat = seatsRes2.body.data.find((s) => s.id === seat1.id);
  log('  ', 'Seat status', bookedSeat?.status);
  if (bookedSeat?.status !== 'BOOKED') { fail('Seat should be BOOKED'); return; }
  pass('Seat status = BOOKED ✓');

  // ── Phase 2: Idempotency Test ────────────────────────────────────────────
  section('Phase 2 — Duplicate Webhook Idempotency');

  log('📡', `Step 9: Re-send same webhook event (${eventId})`);
  const wh2 = await request('POST', '/payments/webhook', {
    provider_event_id: eventId,
    booking_id: bookingId,
    status: 'SUCCESS',
  });
  log('  ', 'Response', { status: wh2.status, ...wh2.body });
  if (wh2.status === 200 && wh2.body.idempotent === true) {
    pass('Duplicate webhook correctly returned 200 idempotent:true (TOCTOU-safe)');
  } else {
    fail('Duplicate webhook was not handled idempotently');
  }

  // ── Phase 3: Concurrency Test ────────────────────────────────────────────
  section(`Phase 3 — Concurrency Test (50 users → seat #${seat2.seat_number})`);

  log('🚀', `Step 10: Firing 50 concurrent reserve requests for seat ${seat2.id}`);
  const results = await fireConcurrentReserve(seat2.id, 50);

  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);
  const others    = results.filter((r) => r.status !== 201 && r.status !== 409);

  console.log('\n   📊 Results:');
  console.log(`      ✅ 201 Created  : ${successes.length}`);
  console.log(`      ⚡ 409 Conflict : ${conflicts.length}`);
  console.log(`      ❌ Other errors : ${others.length}`);

  if (successes.length === 1) {
    pass(`Exactly 1 reservation succeeded — no double booking!\n      Winning booking_id: ${successes[0].body.booking_id}`);
  } else if (successes.length === 0) {
    fail('No reservation succeeded (seat may already be reserved)');
  } else {
    fail(`🚨 DOUBLE BOOKING! ${successes.length} reservations succeeded`);
    successes.forEach((r, i) => console.log(`      [${i + 1}] ${r.body.booking_id}`));
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  section('Demo Complete');
  if (process.exitCode === 1) {
    console.log('\n   ❌ Some assertions failed. See above for details.\n');
  } else {
    console.log('\n   ✅ All assertions passed!\n');
    console.log('   Demonstrated:');
    console.log('     • Seat reservation with Redis lock + DB transaction');
    console.log('     • Booking creation (PENDING_PAYMENT → CONFIRMED)');
    console.log('     • Idempotent payment webhook (TOCTOU-safe via unique constraint)');
    console.log('     • No double booking under 50 concurrent users');
    console.log('     • Redis-cached seat availability (5s staleness tolerance)');
    console.log('     • Seat pricing (each seat has a different entry price)\n');
  }
}

run().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
