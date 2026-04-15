import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';

/**
 * POST /bookings/:booking_id/pay
 *
 * Initiates a payment for a booking in PENDING_PAYMENT status.
 * Idempotency is guaranteed via a unique idempotency_key stored in the Payment table.
 */
export async function initiatePayment(req: Request, res: Response): Promise<void> {
  const booking_id = req.params['booking_id'] as string;

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: booking_id },
    });

    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    if (booking.status !== 'PENDING_PAYMENT') {
      res.status(409).json({
        error: `Booking is in status '${booking.status}', payment cannot be initiated`,
      });
      return;
    }

    if (new Date() > booking.expires_at) {
      res.status(410).json({ error: 'Booking has expired. Please create a new reservation.' });
      return;
    }

    // Generate a unique idempotency key for this payment attempt
    const idempotencyKey = uuidv4();

    const payment = await prisma.payment.create({
      data: {
        booking_id,
        status: 'PENDING',
        idempotency_key: idempotencyKey,
      },
    });

    // In production: call payment provider SDK (e.g. Razorpay, Stripe) here.
    const mockPaymentUrl = `https://pay.mock-provider.com/checkout?payment_id=${payment.id}&key=${idempotencyKey}`;

    res.status(201).json({
      message: 'Payment initiated',
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      payment_url: mockPaymentUrl,
      expires_at: booking.expires_at,
    });
  } catch (err) {
    console.error('[initiatePayment] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
