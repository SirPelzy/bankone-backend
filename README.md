# BankOne Backend

Vercel-deployed TypeScript backend for BankOne's wallet-backed transfer flow.

This is built for a real test environment, not mocked demos. Mono and Nomba adapters call their live test/sandbox APIs when the required environment variables are set. Production rollout is intended to be an environment swap: set production keys and `APP_ENV=production`.

## Stack

- Next.js Route Handlers on Vercel
- Supabase Auth and Postgres
- Supabase Queues through `pgmq`
- Mono for open-banking account linking and advisory balances
- Nomba for card tokenization, tokenized-card funding, bank transfers, and webhooks

## Setup

1. Create a Supabase project.
2. Apply `supabase/migrations/001_initial_schema.sql`.
3. Add the variables from `.env.example` to Vercel Preview/Test.
4. Configure Mono webhook URL: `/api/webhooks/mono`.
5. Configure Nomba webhook URL: `/api/webhooks/nomba`.
6. Subscribe Nomba to payment success/failure/reversal and payout success/failure/refund events.

## Worker Scheduling

The built-in Vercel cron is configured for Hobby compatibility:

```json
{ "path": "/api/workers/funding", "schedule": "0 3 * * *" }
```

Vercel Hobby only allows cron jobs that run once per day. For product testing that needs faster funding processing, use either:

- Vercel Pro with a more frequent schedule such as `*/5 * * * *`.
- An external scheduler that calls `POST /api/workers/funding` with `Authorization: Bearer $CRON_SECRET`.

Keep `CRON_SECRET` set in Vercel. Vercel Cron automatically sends it as the `Authorization` header when invoking the route.

## Local Commands

```bash
npm install
npm run dev
npm run typecheck
npm test
```

## Important Safety Defaults

- All money amounts are stored as integer kobo.
- `APP_ENV` is written into every money-moving record.
- User-facing APIs require Supabase JWTs.
- Worker and webhook routes use server-side service-role access only.
- Ledger entries are append-only; reversals are new entries.
- Nomba payout finality comes from verified webhook/requery status, not the initial transfer response.
