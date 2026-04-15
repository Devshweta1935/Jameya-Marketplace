import { Router } from 'express';
import { handleWebhook } from '../controllers/paymentController';

const router = Router();

// POST /payments/webhook
router.post('/webhook', handleWebhook);

export default router;
