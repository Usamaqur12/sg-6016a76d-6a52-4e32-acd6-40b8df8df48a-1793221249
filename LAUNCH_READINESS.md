# PrimeBet launch readiness

Last updated: 2026-10-24

## Launch boundary

The seven-day target is for a clearly labelled play-money demo/beta. Real-money wagering must remain disabled until licensing, legal terms, KYC/AML, payment-provider approval, production sports feeds and independent security review are complete.

## Completed in the current security pass

- Atomic authenticated bet placement with balance locking, database odds revalidation and idempotency.
- Atomic cancellation/refund and admin-authorized settlement functions.
- Protected balance, admin, verification and suspension fields on user profiles.
- Removed browser-authored wallet credits, withdrawals and cash-out mutations.
- Replaced recursive/inconsistent admin policies with central role checks and narrower permissions.
- Added demo-mode configuration and a safe environment-variable template.
- Added real About, Contact, Help, Terms, Privacy, Responsible Play, Careers and Affiliates routes.
- Removed misleading real-deposit calls to action from the main demo experience.
- Production TypeScript build and static route generation pass.
- `/sports` now loads database events/markets/odds, carries real selection UUIDs into the atomic bet RPC, and includes a working mobile bet-slip drawer.
- Home, Live and Esports now share the same database sportsbook catalogue and real bet-selection identifiers.
- Admin Sports, Promotions, Support and Audit pages now use real tables; support workflow, promotion status updates and audit CSV export are functional.
- Monitoring now reads provider health, suspended markets and failed settlement jobs from the database instead of preview values.
- Trading Control Center now has real event/market suspension, odds lock/update, odds history/audit and sport-margin controls.
- Responsible-play limits and self-exclusion are enforced by database triggers, with authenticated customer controls at `/account/responsible-play`.
- Notifications are database-backed with persisted preferences and automatic bet/KYC status messages; preview notifications were removed.
- KYC uploads now use a private 5 MB restricted bucket and short-lived signed reviewer links.
- Removed the unused Vercel CLI runtime dependency and upgraded Next.js to patched 15.5.27; critical production audit findings are now zero.
- Added rerunnable play-money fixtures in `supabase/seed.sql` for local/staging demo environments.
- Added an idempotent provider-result webhook, database settlement queue and scheduled worker. Multi-event bets settle only when resolvable; wallet credit, bet status and settlement audit are atomic.
- Replaced mock global search with database event/team/league/sport search and deep links into event markets.
- Replaced empty Results and Statistics routes with real event scores, settled-market outcomes and database coverage metrics.
- Sportsbook favourites now persist per authenticated account instead of disappearing on refresh.
- Added migration smoke assertions for the settlement ingestion/worker functions and job deduplication index.
- Added transactional live-feed ingestion with canonical provider-event mapping, duplicate update rejection, score/odds upserts, odds-movement history and automatic incident/terminal-status suspension.
- Added database-enforced risk caps, per-user/sport stake and payout limits, real-time event/market exposure recomputation, automatic liability suspension and automated stake/velocity fraud flags.
- Added an immutable double-entry wallet journal with balanced opening entries, cash, bonus and locked buckets, balanced-posting enforcement, idempotent mirroring of wallet events and funding-source-safe bet refunds. The account wallet displays each bucket separately, and finance staff have a live balance-reconciliation report in the admin transaction screen.
- Added secure play-money promotion claiming, wagering progress, odds/leg qualification rules, expiry and forfeiture processing, bonus-abuse flags, loyalty points and Bronze-to-Platinum VIP tiers. The customer Promotions page now reads live offers and bonus progress from the database.
- Added password recovery/update routes, authenticator-app TOTP enrollment and verification, other-session revocation and database-enforced AAL2 for all authenticated admin permissions.
- Added an installable PWA manifest, branded maskable vector icon, production service-worker registration and a network-safe offline fallback that never caches authenticated sportsbook or wallet pages.
- Added full/partial atomic cash-out, round-robin system bets, odds-change preferences, same-event bet-builder correlation validation and configurable early-payout rules.
- Added customer missions, loyalty leaderboard, saved withdrawal-address cooling, match statistics/lineups, maintenance controls and an admin liability heatmap.
- Added privacy-preserving API rate limiting to provider, payment and admin connector endpoints.
- Added browser push subscription storage, authenticated enrollment and service-worker push/click handling; remote delivery remains gated by production VAPID keys.
- Added an admin Launch Readiness dashboard that checks production environment configuration and provider/database state without returning secret values.
- Added automated readiness smoke checks for unsigned provider callbacks, push gating, protected routes and rate-limit response headers.
- Added an optional Upstash-compatible distributed rate limiter with local fallback; payment and casino mutations fail closed in production when shared protection is configured but unavailable.
- Added privacy-redacted browser error capture, an internal error journal, an operations dashboard error tab and an optional external alert webhook.
- Added a disabled-by-default casino integration layer: admin provider/game catalogue controls, authenticated game-session launch, signed callback verification, idempotent bet/win/refund processing and double-entry wallet mirroring.
- Regenerated the complete database installer with 43 ordered migrations through `20261024190000_operational_hardening.sql`.

## Required before demo deployment

- Apply all Supabase migrations to a staging project and run authenticated integration tests.
- Run authenticated staging tests for signup, login, bet placement, odds changes, insufficient balance, duplicate requests, cancellation and settlement against the selected Supabase project.
- Configure monitoring, error reporting, backups, rate limits, bot protection and secure deployment secrets.
- Configure a shared Redis-compatible rate-limit service for multi-instance deployment and an external error-alert destination.
- Configure `SUPABASE_SERVICE_ROLE_KEY`, `SPORTS_FEED_WEBHOOK_SECRET` and `CRON_SECRET`, then connect the chosen feed provider to `/api/provider/results`.
- Run provider certification tests for duplicate callbacks, out-of-order results, cancellations, partial market results and multi-event accumulators.
- Replace placeholder support email, company identity and social links.
- Review the remaining non-critical transitive dependency advisories and reduce the existing lint-warning backlog.
- Complete cross-browser and mobile QA plus an accessibility pass.
- Certify the selected casino aggregator's launch request and callback field mapping before enabling `CASINO_ENABLED`.

## Inputs the owner must provide

- Supabase project URL, public anon key and secure administrator access for staging migrations.
- Target launch country/jurisdiction and registered company details.
- Chosen sports/odds/results provider account and API documentation.
- Domain/DNS and hosting access.
- Brand support email, company address and approved legal text.

## Additional inputs required for real money

- Gambling licence or an approved licensed operating partner.
- KYC/AML provider, sanctions/PEP screening and age-verification accounts.
- Gambling-compatible payment provider and merchant approval.
- Regulatory reporting, segregation/reconciliation rules and responsible-gambling requirements for the target market.
- Independent penetration test and legal/compliance approval.
