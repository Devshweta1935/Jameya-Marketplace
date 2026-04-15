import 'dotenv/config';
import app from './app';
import { runExpiryJob } from './jobs/expiryJob';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';

const PORT = parseInt(process.env.PORT || '3000', 10);
const EXPIRY_JOB_INTERVAL_MS = 30_000; // 30 seconds

async function bootstrap() {
  // Verify DB connectivity
  await prisma.$connect();
  console.log('[DB] PostgreSQL connected');

  // Redis is connected lazily — ping to confirm
  await redis.ping();
  console.log('[Redis] Ping OK');

  // Start the background expiry job
  setInterval(runExpiryJob, EXPIRY_JOB_INTERVAL_MS);
  console.log(`[ExpiryJob] Scheduled every ${EXPIRY_JOB_INTERVAL_MS / 1000}s`);

  // Run immediately on startup to clear any stale reservations from downtime
  await runExpiryJob();

  // Start HTTP server
  const server = app.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] ${signal} received — shutting down gracefully`);
    server.close(async () => {
      await prisma.$disconnect();
      redis.disconnect();
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal error:', err);
  process.exit(1);
});
