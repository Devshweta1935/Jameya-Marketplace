import { Router } from 'express';
import { initiatePayment } from '../controllers/bookingController';
import { getBooking } from '../controllers/jameyaController';

const router = Router();

router.get('/:booking_id', getBooking);
router.post('/:booking_id/pay', initiatePayment);

export default router;
