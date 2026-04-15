#!/usr/bin/env node
/**
 * Seed Script
 *
 * Creates a Jameya and inserts 10 AVAILABLE seats with different entry prices.
 * Run this after migrations to get test data.
 *
 * Usage:
 *   node load-test/seed.js
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const SEAT_COUNT = 10;

  // Create a featured Jameya (12-month collaborative savings group)
  const jameya = await prisma.jameya.create({
    data: {
      name: 'Golden Circle Jameya – April 2026',
      monthly_amount: 500.00,
      duration_months: 12,
      featured: true,
    },
  });

  console.log(`✅ Created Jameya: ${jameya.id} — "${jameya.name}"`);

  // Each seat has a different entry price (seat 1 most expensive = first payout)
  const seats = Array.from({ length: SEAT_COUNT }, (_, i) => ({
    jameya_id: jameya.id,
    seat_number: i + 1,
    price: parseFloat((1000 - i * 50).toFixed(2)), // 1000, 950, 900 ... 550
    status: 'AVAILABLE',
  }));

  await prisma.seat.createMany({ data: seats });

  const all = await prisma.seat.findMany({
    where: { jameya_id: jameya.id },
    orderBy: { seat_number: 'asc' },
    select: { id: true, seat_number: true, price: true, status: true },
  });

  console.log(`\n✅ Created ${all.length} seats:\n`);
  console.log('  Seat# | Price (AED) | Status    | ID');
  console.log('  ------+-------------+-----------+--------------------------------------');
  all.forEach((s) =>
    console.log(
      `  #${String(s.seat_number).padEnd(5)}| ${String(s.price).padEnd(12)}| ${s.status.padEnd(11)}| ${s.id}`
    )
  );

  console.log('\n📋 Copy any seat ID above to use in the concurrency test:');
  console.log(`   node load-test/concurrency-test.js "${all[0].id}" 20`);
  console.log(`\n📋 Or browse the Jameya via API:`);
  console.log(`   curl http://localhost:3000/jameyas`);
  console.log(`   curl http://localhost:3000/jameyas/${jameya.id}/seats`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
