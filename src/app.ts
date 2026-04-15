import express from 'express';
import seatRoutes from './routes/seatRoutes';
import bookingRoutes from './routes/bookingRoutes';
import paymentRoutes from './routes/paymentRoutes';
import jameyaRoutes from './routes/jameyaRoutes';

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());

// Request logger (development only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/jameyas', jameyaRoutes);
app.use('/seats', seatRoutes);
app.use('/bookings', bookingRoutes);
app.use('/payments', paymentRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

export default app;
