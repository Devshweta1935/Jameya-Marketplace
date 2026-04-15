import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const CACHE_TTL_SECONDS = 5; // Seat availability may tolerate ~5s staleness

/**
 * GET /jameyas
 *
 * Returns a list of all Jameyas. Featured ones come first.
 * Cached in Redis for 5 seconds (eventual consistency for catalogue browsing).
 */
export async function listJameyas(_req: Request, res: Response): Promise<void> {
  const cacheKey = 'cache:jameyas:list';

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      res.json({ source: 'cache', data: JSON.parse(cached) });
      return;
    }

    const jameyas = await db.jameya.findMany({
      orderBy: [{ featured: 'desc' }, { created_at: 'asc' }],
      include: {
        _count: { select: { seats: true } },
      },
    });

    const enriched = jameyas.map((j: any) => ({
      id: j.id,
      name: j.name,
      monthly_amount: j.monthly_amount,
      duration_months: j.duration_months,
      featured: j.featured,
      total_seats: j._count.seats,
    }));

    await redis.set(cacheKey, JSON.stringify(enriched), 'EX', CACHE_TTL_SECONDS);
    res.json({ source: 'db', data: enriched });
  } catch (err) {
    console.error('[listJameyas] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /jameyas/:jameya_id/seats
 *
 * Returns all seats for a Jameya with live status, price, and countdown timer
 * for RESERVED seats. Cached for 5 seconds (stale availability is acceptable).
 */
export async function listSeats(req: Request, res: Response): Promise<void> {
  const jameya_id = req.params['jameya_id'] as string;
  const cacheKey = `cache:jameya:${jameya_id}:seats`;

  try {
    const jameya = await db.jameya.findUnique({ where: { id: jameya_id } });
    if (!jameya) {
      res.status(404).json({ error: 'Jameya not found' });
      return;
    }

    const cached = await redis.get(cacheKey);
    if (cached) {
      res.json({ source: 'cache', jameya_id, data: JSON.parse(cached) });
      return;
    }

    const seats = await db.seat.findMany({
      where: { jameya_id },
      orderBy: { seat_number: 'asc' },
    });

    const now = new Date();
    const enriched = seats.map((s: any) => {
      const secsRemaining =
        s.status === 'RESERVED' && s.expires_at
          ? Math.max(0, Math.floor((s.expires_at.getTime() - now.getTime()) / 1000))
          : null;

      return {
        id: s.id,
        seat_number: s.seat_number,
        price: s.price,
        status: s.status,
        reserved_by: s.status === 'RESERVED' ? s.reserved_by : null,
        expires_in_seconds: secsRemaining,
      };
    });

    await redis.set(cacheKey, JSON.stringify(enriched), 'EX', CACHE_TTL_SECONDS);
    res.json({ source: 'db', jameya_id, data: enriched });
  } catch (err) {
    console.error('[listSeats] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /bookings/:booking_id
 *
 * Returns the current status of a booking (used by frontend for polling / optimistic UI).
 */
export async function getBooking(req: Request, res: Response): Promise<void> {
  const booking_id = req.params['booking_id'] as string;

  try {
    const booking = await db.booking.findUnique({
      where: { id: booking_id },
      include: {
        seat: { select: { id: true, seat_number: true, price: true, jameya_id: true } },
        payments: { select: { id: true, status: true, idempotency_key: true, provider_event_id: true } },
      },
    });

    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const now = new Date();
    const expiresInSeconds = Math.max(0, Math.floor((booking.expires_at.getTime() - now.getTime()) / 1000));

    res.json({
      id: booking.id,
      user_id: booking.user_id,
      status: booking.status,
      expires_at: booking.expires_at,
      expires_in_seconds: booking.status === 'PENDING_PAYMENT' ? expiresInSeconds : null,
      seat: booking.seat,
      payments: booking.payments,
    });
  } catch (err) {
    console.error('[getBooking] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
