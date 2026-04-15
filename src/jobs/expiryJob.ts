import { prisma } from '../lib/prisma';

/**
 * Background job — runs every 30 seconds.
 *
 * Finds all seats that are RESERVED but whose expires_at has passed,
 * then atomically:
 *  - Sets the seat back to AVAILABLE
 *  - Marks the associated booking as EXPIRED
 *
 * Uses a raw SQL approach (prisma.$queryRaw + $executeRaw) inside a transaction
 * to avoid N+1 queries on large tables.
 */
export async function runExpiryJob(): Promise<void> {
  const now = new Date();

  try {
    // Find all expired reserved seats in one query
    const expiredSeats = await prisma.seat.findMany({
      where: {
        status: 'RESERVED',
        expires_at: { lte: now },
      },
      select: { id: true },
    });

    if (expiredSeats.length === 0) return;

    const expiredSeatIds = expiredSeats.map((s: any) => s.id);

    console.log(
      `[ExpiryJob] Expiring ${expiredSeatIds.length} seat(s): ${expiredSeatIds.join(', ')}`
    );

    // Atomically update seats and bookings in a single transaction
    await prisma.$transaction(async (tx: any) => {
      // Reset seats to AVAILABLE
      await tx.seat.updateMany({
        where: { id: { in: expiredSeatIds }, status: 'RESERVED' },
        data: {
          status: 'AVAILABLE',
          reserved_by: null,
          expires_at: null,
        },
      });

      // Expire associated PENDING_PAYMENT bookings
      await tx.booking.updateMany({
        where: {
          seat_id: { in: expiredSeatIds },
          status: 'PENDING_PAYMENT',
        },
        data: { status: 'EXPIRED' },
      });
    });

    console.log(`[ExpiryJob] Done — ${expiredSeatIds.length} reservation(s) expired`);
  } catch (err) {
    console.error('[ExpiryJob] Error during expiry run:', err);
  }
}
