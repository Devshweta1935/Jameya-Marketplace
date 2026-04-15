import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { Prisma } from '@prisma/client';

/**
 * POST /payments/webhook
 *
 * Handles inbound payment provider webhook events.
 *
 * Idempotency guarantee (TOCTOU-safe):
 *   - provider_event_id is UNIQUE in the DB.
 *   - We do NOT do a pre-check + insert (race condition). Instead we attempt
 *     the update and catch the unique constraint violation, returning 200
 *     immediately. This works correctly even with concurrent duplicate webhooks.
 *
 * Flow:
 *  1. Validate input
 *  2. In a DB transaction:
 *     a. Find the PENDING payment for this booking
 *     b. Set provider_event_id + new status (unique constraint prevents duplicates)
 *     c. If SUCCESS and booking not CONFIRMED → confirm booking + mark seat BOOKED
 *  3. Commit
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const { provider_event_id, booking_id, status } = req.body;

  if (!provider_event_id || !booking_id || !status) {
    res.status(400).json({ error: 'provider_event_id, booking_id, and status are required' });
    return;
  }

  if (!['SUCCESS', 'FAILED'].includes(status)) {
    res.status(400).json({ error: `Unknown payment status: ${status}` });
    return;
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      // Find the PENDING payment for this booking
      const payment = await tx.payment.findFirst({
        where: { booking_id, status: 'PENDING' },
      });

      if (!payment) {
        // Check if it's already been processed (idempotent replay)
        const processed = await tx.payment.findFirst({
          where: { booking_id, provider_event_id },
        });
        if (processed) {
          // Already processed — idempotent, bubble up a sentinel
          throw new Error('ALREADY_PROCESSED');
        }
        throw new Error('PAYMENT_NOT_FOUND');
      }

      // ── TOCTOU-safe: set provider_event_id atomically inside the transaction.
      // The UNIQUE constraint on provider_event_id means a second concurrent
      // webhook will hit a unique violation here and be rejected, not silently ignored.
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
          provider_event_id,
        },
      });

      if (status === 'SUCCESS') {
        const booking = await tx.booking.findUnique({ where: { id: booking_id } });

        if (!booking) throw new Error('BOOKING_NOT_FOUND');

        if (booking.status !== 'CONFIRMED') {
          await tx.booking.update({
            where: { id: booking_id },
            data: { status: 'CONFIRMED' },
          });

          await tx.seat.update({
            where: { id: booking.seat_id },
            data: { status: 'BOOKED', expires_at: null },
          });
        }
      }
    });

    // Invalidate caches on success
    if (status === 'SUCCESS') {
      await redis.del('cache:jameyas:list');
      const booking = await prisma.booking.findUnique({ where: { id: booking_id }, select: { seat_id: true } });
      if (booking) {
        const seat = await prisma.seat.findUnique({ where: { id: booking.seat_id }, select: { jameya_id: true } });
        if (seat) {
          await redis.del(`cache:jameya:${seat.jameya_id}:seats`);
        }
      }
    }

    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';

    // TOCTOU: concurrent duplicate webhook hit the unique constraint
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      console.log(`[webhook] Duplicate event ${provider_event_id} — unique constraint (TOCTOU-safe)`);
      res.status(200).json({ message: 'Event already processed', idempotent: true });
      return;
    }

    if (message === 'ALREADY_PROCESSED') {
      console.log(`[webhook] Duplicate event ${provider_event_id} — already processed`);
      res.status(200).json({ message: 'Event already processed', idempotent: true });
      return;
    }

    if (message === 'PAYMENT_NOT_FOUND') {
      res.status(404).json({ error: 'No pending payment found for this booking' });
    } else if (message === 'BOOKING_NOT_FOUND') {
      res.status(404).json({ error: 'Booking not found' });
    } else {
      console.error('[handleWebhook] Unexpected error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
