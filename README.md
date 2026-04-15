# Seat Booking System

A minimal, concurrency-safe seat booking backend built with **Node.js + Express + PostgreSQL (Prisma) + Redis**.

## Folder Structure

```
jameya-poc-new/
├── prisma/
│   └── schema.prisma           # DB models: Seat, Booking, Payment
├── src/
│   ├── app.ts                  # Express app + routes
│   ├── index.ts                # Entry point + background job
│   ├── controllers/
│   │   ├── seatController.ts   # POST /seats/:id/reserve (Redis lock + TX)
│   │   ├── bookingController.ts# POST /bookings/:id/pay  (idempotency key)
│   │   └── paymentController.ts# POST /payments/webhook  (idempotent handler)
│   ├── routes/
│   │   ├── seatRoutes.ts
│   │   ├── bookingRoutes.ts
│   │   └── paymentRoutes.ts
│   ├── jobs/
│   │   └── expiryJob.ts        # Background expiry every 30s
│   └── lib/
│       ├── prisma.ts           # Prisma singleton
│       └── redis.ts            # Redis client + lock helpers
├── load-test/
│   ├── concurrency-test.js     # Concurrency test (pure Node.js)
│   └── seed.js                 # DB seeder
├── .env.example
└── package.json
```

## Quick Start

### 1. Prerequisites
- **PostgreSQL** running locally (or via Docker)
- **Redis** running locally (or via Docker)

```bash
# Quick Docker setup:
docker run -d --name pg -e POSTGRES_PASSWORD=password -e POSTGRES_DB=seat_booking -p 5432:5432 postgres:15
docker run -d --name redis -p 6379:6379 redis:7
```

### 2. Setup

```bash
# Copy env
cp .env.example .env
# Edit DATABASE_URL and REDIS_URL if needed

# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Run migrations (creates tables)
npm run db:migrate
# When prompted for migration name, type: init

# Seed test data
npm run db:seed
# Copy a seat UUID from the output for testing
```

### 3. Run

```bash
npm run dev
```

The server starts at `http://localhost:3000`.

## API Reference

### `POST /seats/:seat_id/reserve`
Reserve a seat for a user. Utilizing Redis-based distributed locking + SQL `SELECT FOR UPDATE`.

```bash
curl -X POST http://localhost:3000/seats/<SEAT_ID>/reserve \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user-42"}'
```

---

### `POST /bookings/:booking_id/pay`
Initiate payment for a booking. Uses a unique idempotency key.

```bash
curl -X POST http://localhost:3000/bookings/<BOOKING_ID>/pay
```

---

### `POST /payments/webhook`
Simulates a payment provider callback. TOCTOU-safe idempotent handler.

```bash
curl -X POST http://localhost:3000/payments/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "provider_event_id": "evt_123",
    "booking_id": "<BOOKING_ID>",
    "status": "SUCCESS"
  }'
```

---

### `GET /jameyas`
Browse available Jameyas. 
*Results are cached in Redis for 5 seconds.*

---

### `GET /jameyas/:jameya_id/seats`
Browse all seats in a Jameya with live availability and pricing.
*Results are cached in Redis for 5 seconds.*

---

### `GET /health`
```bash
curl http://localhost:3000/health
```

---

## Testing & Demos

### 1. Robust E2E Demo (Recommended)
This script walks through the entire life cycle: discovery, reservation, payment, and concurrency stress testing.

```bash
npm run demo
```

### 2. Manual Concurrency Stress Test
Fires multiple simultaneous `/reserve` requests for a single seat to prove only one succeeds.

```bash
# Seed DB first, grab a seat UUID, then:
node load-test/concurrency-test.js <SEAT_UUID> 30
```

**Expected output:** exactly 1 `✅ 201 Created`, 29 `⚡ 409 Conflict`.

---

## Concurrency Mechanism

| Layer | Mechanism | Purpose |
|---|---|---|
| Redis | `SET NX PX 10000` | Prevent concurrent entry into DB tx for same seat |
| PostgreSQL | `SELECT ... FOR UPDATE` | Row-level lock inside tx for double-safety |
| DB Unique | `provider_event_id UNIQUE` | Idempotent webhook at DB level |
| DB Unique | `idempotency_key UNIQUE` | Idempotent payment at DB level |

---

## Background Job

Every 30 seconds the expiry job:
1. Finds all `seats` where `status = RESERVED AND expires_at < NOW()`
2. **Atomic** state reset using a DB transaction.

Runs immediately on server startup to handle any stale state from downtime.

---

## Utilities

### Reset & Reseed
If you fill up all the seats during testing, use this command to wipe the database and re-seed with 10 fresh, priced seats:

```bash
npm run db:reset
```