# PrimeBet sportsbook platform

PrimeBet is a full-stack Next.js sportsbook and casino-platform foundation with a local play-money backend and guarded production integrations.

## Included

- Sports, leagues, events, markets, odds and live-score views
- Single, multiple and round-robin system bets
- Settlement, cancellation, early-payout and full/partial cash-out workflows
- Cash, bonus and locked-funds ledger foundations
- Responsible-play limits and self-exclusion
- Promotions, rewards, notifications and support conversations
- Manual payment, crypto-provider and broker workflows
- Sports-feed and casino-provider integration layers
- Admin panels for users, KYC, sports, trading, risk, payments, providers, reports and monitoring
- Row-level security migrations, AAL2 admin enforcement, audit logs and maker-checker approvals
- Health/readiness probes and fail-closed production startup

## Local demo

1. Install Node.js 22 and run `npm ci`.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_ENABLE_DEMO_BACKEND=true` and `NEXT_PUBLIC_DEMO_MODE=true`.
4. Run `npm run dev`.

Demo administrator:

- Email: `admin@primebet.demo`
- Password: `PrimeBetDemo2026!`

These credentials are only accepted by the browser-local demo backend. They are not production credentials.

## Database

Apply the ordered files in `supabase/migrations`, or use the generated installer in `database/01_primebet_complete_schema.sql` for a new empty project. The installer currently includes 54 migrations. Promote the first administrator using `database/03_promote_first_admin.sql`. Admin dashboard login supports password authentication as requested; MFA remains strongly recommended and sensitive finance/KYC approval functions may still require higher assurance.

## Production activation

Configure the variables documented in `.env.example`, disable both demo switches and set:

```env
NODE_ENV=production
PRODUCTION_MODE=true
ENFORCE_PRODUCTION_READINESS=true
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_ENABLE_DEMO_BACKEND=false
```

The server refuses to start when mandatory production configuration is missing. Hosting probes are available at `/api/health` and `/api/ready`; the detailed authenticated report is at `/admin/readiness`.

Paid sports feeds, payment merchants, licensed casino aggregation, KYC/AML verification, transactional messaging and gambling licensing require approved external accounts and must be configured before real-money use.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
npm run test:ui-actions
npm run test:security
npm run test:readiness
```

This repository does not include production API keys, customer data or operating licences.
