import { Router } from 'express';
import { listJameyas, listSeats } from '../controllers/jameyaController';

const router = Router();

router.get('/', listJameyas);
router.get('/:jameya_id/seats', listSeats);

export default router;
