import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err));

// ─── Distributed Lock Helpers ─────────────────────────────────────────────────
// Uses SET NX PX (atomic) as a simple single-node Redis lock.
// For multi-node Redis, swap in Redlock. This is sufficient for a single Redis instance.

const LOCK_PREFIX = 'lock:seat:';
const LOCK_TTL_MS = 10_000; // 10 seconds max lock hold time

/**
 * Acquire a Redis lock for a given seat.
 * Returns true if acquired, false if the seat is already locked.
 */
export async function acquireLock(seatId: string, token: string): Promise<boolean> {
  const key = `${LOCK_PREFIX}${seatId}`;
  // SET key token NX PX <ttlMs> — atomically sets only if key does NOT exist
  const result = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
  return result === 'OK';
}

/**
 * Release a Redis lock only if we own it (compare-and-delete via Lua script).
 * Prevents releasing a lock acquired by another process after TTL expiry.
 */
export async function releaseLock(seatId: string, token: string): Promise<void> {
  const key = `${LOCK_PREFIX}${seatId}`;
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, key, token);
}
