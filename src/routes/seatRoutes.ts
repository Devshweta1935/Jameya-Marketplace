import { Router } from 'express';
import { reserveSeat } from '../controllers/seatController';

const router = Router();

// POST /seats/:seat_id/reserve
router.post('/:seat_id/reserve', reserveSeat);

export default router;
