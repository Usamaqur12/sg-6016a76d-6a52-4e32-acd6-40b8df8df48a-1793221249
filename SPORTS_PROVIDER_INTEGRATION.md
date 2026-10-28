# Sports provider integration

## Admin provider manager

Open `/admin/providers` with a 2FA-verified sports admin account. The manager can:

- add TheSportsDB Live or Sportmonks credentials;
- test a connection without importing events;
- enable/disable and remove providers;
- sync immediately and inspect sample matches;
- preview Bundesliga scores through the bundled no-key OpenLigaDB connection;
- use the bundled TheSportsDB development schedule for a local preview.

Production API keys are encrypted with AES-256-GCM using
`SPORTS_PROVIDER_ENCRYPTION_KEY`. They are never returned to the browser. The
free OpenLigaDB and TheSportsDB development connections import authentic scores
or fixture names, but neither is a certified betting settlement source and they
do not create betting odds. The demo admin automatically performs one
OpenLigaDB sync per browser session. The production cron respects the provider's
60-second minimum sync interval.

`POST /api/cron/sports-feed` processes all enabled providers that are due. Call
it with `Authorization: Bearer <CRON_SECRET>`. Score-only events appear in the
catalogue as non-bettable until a licensed odds feed supplies markets.

## Live feed

Send event, score and odds updates to `POST /api/provider/feed` with the same
Bearer secret. Every payload needs a provider-unique `updateId`. The ingestion
transaction maps the provider event to one canonical local event, upserts its
league/markets/outcomes and records every price movement.

Critical incidents (`goal`, `penalty`, `red_card`, `var`, `wicket` and
`match_point`) immediately suspend the event, lock its odds and suspend active
markets. Send a later stable quote with `resumeMarkets: true` to reopen it.
Postponed, cancelled and finished events remain suspended.

## Final results

The production result provider sends `POST /api/provider/results` with:

```http
Authorization: Bearer <SPORTS_FEED_WEBHOOK_SECRET>
Content-Type: application/json
```

```json
{
  "eventId": "30000000-0000-0000-0000-000000000001",
  "providerReference": "provider-result-12345-v1",
  "status": "finished",
  "homeScore": 2,
  "awayScore": 1,
  "markets": [
    {
      "marketId": "40000000-0000-0000-0000-000000000001",
      "winningSelection": "Home"
    }
  ]
}
```

Use a globally unique, stable `providerReference` for every final-result version.
Repeating the same reference is an idempotent no-op. A correction must use the
future resettlement workflow; it must not reuse or overwrite a completed result.

Cancelled events use `status: "cancelled"`, nullable scores and an empty
`markets` array. All unresolved selections for the event are voided.

The endpoint validates and queues the result. It does not settle wallets in the
HTTP request. Vercel invokes `/api/cron/settlements` every minute with
`Authorization: Bearer <CRON_SECRET>`. The worker processes at most 25 jobs per
run and retries failed jobs with exponential backoff.

Required server-only environment variables:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SPORTS_FEED_WEBHOOK_SECRET`
- `SPORTS_PROVIDER_ENCRYPTION_KEY`
- `CRON_SECRET`

Never expose these variables to browser code or prefix them with `NEXT_PUBLIC_`.
