import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { redis, acquireLock, releaseLock } from '../lib/redis';

const RESERVATION_TTL_MINUTES = 5;

/**
 * Mock KYC check — always returns VERIFIED in this implementation.
 * Replace with a real KYC service call in production.
 */
async function checkKYC(_userId: string): Promise<boolean> {
  return true;
}

/**
 * POST /seats/:seat_id/reserve
 *
 * Flow:
 *  1. Validate user KYC (mocked)
 *  2. Acquire Redis lock on seat_id (prevent race conditions)
 *  3. Begin DB transaction
 *  4. Assert seat is AVAILABLE via SELECT FOR UPDATE
 *  5. Mark seat RESERVED + set expires_at
 *  6. Create Booking (PENDING_PAYMENT)
 *  7. Commit transaction
 *  8. Release Redis lock
 *  9. Return booking_id
 */
export async function reserveSeat(req: Request, res: Response): Promise<void> {
  const seat_id = req.params['seat_id'] as string;
  const { user_id } = req.body as { user_id?: string };

  if (!user_id) {
    res.status(400).json({ error: 'user_id is required' });
    return;
  }

  // Step 1 — KYC check
  const eligible = await checkKYC(user_id);
  if (!eligible) {
    res.status(403).json({ error: 'User is not KYC verified' });
    return;
  }

  // Step 2 — Acquire distributed Redis lock for this seat
  const lockToken = uuidv4();
  const acquired = await acquireLock(seat_id, lockToken);

  if (!acquired) {
    // Another request is currently processing this seat — fast-fail
    res.status(409).json({
      error: 'Seat is currently being processed. Please retry in a moment.',
    });
    return;
  }

  try {
    // Steps 3–7 — Atomic DB transaction
    const booking = await prisma.$transaction(async (tx: any) => {
      // Step 4 — SELECT FOR UPDATE: row-level lock prevents phantom reads in concurrent txns
      const seats = await tx.$queryRaw<
        { id: string; status: string }[]
      >`SELECT id, status FROM seats WHERE id = ${seat_id} FOR UPDATE`;

      if (seats.length === 0) {
        throw new Error('SEAT_NOT_FOUND');
      }

      const seat = seats[0];

      if (seat.status !== 'AVAILABLE') {
        throw new Error('SEAT_NOT_AVAILABLE');
      }

      const expiresAt = new Date(
        Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000
      );

      // Step 5 — Mark seat RESERVED
      await tx.seat.update({
        where: { id: seat_id },
        data: {
          status: 'RESERVED',
          reserved_by: user_id,
          expires_at: expiresAt,
        },
      });

      // Step 6 — Create booking record
      const newBooking = await tx.booking.create({
        data: {
          user_id,
          seat_id,
          status: 'PENDING_PAYMENT',
          expires_at: expiresAt,
        },
      });

      return newBooking;
    });

    // Invalidate caches
    const jameyaId = (booking as any).seat?.jameya_id || (booking as any).jameya_id; 
    // Note: booking.seat is not included in the transaction result by default in the current code, 
    // but we can find it or just clear the main list. 
    // To be safe and simple, let's clear the seat list for this seat's jameya if we had the ID.
    // In reserveSeat, we have the seat_id. We can get the jameya_id from the seat update or a query.
    
    await redis.del('cache:jameyas:list');
    // We'll fetch the jameya_id to clear the specific seat cache
    const seatInfo = await prisma.seat.findUnique({ where: { id: seat_id }, select: { jameya_id: true } });
    if (seatInfo) {
      await redis.del(`cache:jameya:${seatInfo.jameya_id}:seats`);
    }

    // Step 9 — Success response
    res.status(201).json({
      message: 'Seat reserved successfully',
      booking_id: booking.id,
      expires_at: booking.expires_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    if (message === 'SEAT_NOT_FOUND') {
      res.status(404).json({ error: 'Seat not found' });
    } else if (message === 'SEAT_NOT_AVAILABLE') {
      res.status(409).json({ error: 'Seat is not available for reservation' });
    } else {
      console.error('[reserveSeat] Unexpected error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    // Step 8 — Always release lock (even on failure)
    await releaseLock(seat_id, lockToken);
  }
}
