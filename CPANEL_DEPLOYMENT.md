# PrimeBet cPanel deployment

This project requires cPanel's **Setup Node.js App** feature. Uploading it only to
`public_html` will not run authentication, admin access, provider webhooks or cron
API routes.

## Hosting requirements

- Node.js 20.19+ or 22.13+
- Setup Node.js App / Passenger support
- Terminal access, or the cPanel UI actions for NPM install and application restart
- A production Supabase project with all migrations applied
- HTTPS on the selected domain

## 1. Upload

Run `npm run package:cpanel` locally. Zip the contents of `cpanel-upload` and
extract them into a folder outside `public_html`, for example `primebet`.

The package includes a `database` folder. Before starting the cPanel app, follow
`database/README.md` to install and verify the Supabase/PostgreSQL schema. Do not
import these PostgreSQL files into cPanel MySQL/phpMyAdmin.

## 2. Create the Node.js application

In **cPanel > Setup Node.js App > Create Application**, use:

- Node.js version: `20.19+` or `22.13+`
- Application mode: `Production`
- Application root: `primebet`
- Application URL: the domain or subdomain selected for the site
- Application startup file: `server.js`

cPanel supplies the `PORT` automatically. Do not hard-code it.

## 3. Add environment variables

Add these in the Node.js application's environment-variable section:

```text
NODE_ENV=production
HOSTNAME=0.0.0.0
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
NEXT_PUBLIC_DEMO_MODE=true
NEXT_PUBLIC_ENABLE_DEMO_BACKEND=false
NEXT_PUBLIC_SITE_NAME=PrimeBet
NEXT_PUBLIC_SITE_URL=https://YOUR_DOMAIN
NEXT_PUBLIC_DISPLAY_CURRENCY=USD
NEXT_PUBLIC_SUPPORT_EMAIL=support@YOUR_DOMAIN
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
SPORTS_FEED_WEBHOOK_SECRET=GENERATE_A_LONG_RANDOM_SECRET
SPORTS_PROVIDER_ENCRYPTION_KEY=GENERATE_A_STABLE_32_PLUS_CHARACTER_SECRET
CRON_SECRET=GENERATE_A_DIFFERENT_LONG_RANDOM_SECRET
CRYPTO_DEPOSITS_ENABLED=false
NEXT_PUBLIC_CRYPTO_DEPOSITS_ENABLED=false
NOWPAYMENTS_API_KEY=YOUR_SERVER_ONLY_PROVIDER_KEY
NOWPAYMENTS_IPN_SECRET=YOUR_SERVER_ONLY_IPN_SECRET
```

Never place the service-role key or webhook/cron secrets in a `NEXT_PUBLIC_`
variable. Keep demo mode enabled until licensing, KYC, payments and provider
acceptance are complete.

`NEXT_PUBLIC_ENABLE_DEMO_BACKEND` must remain `false` on every public deployment.
It exists only for a local, browser-persisted admin demonstration.

Keep both crypto deposit flags `false` until the payment merchant has approved
the gambling use case, KYC/AML controls are live and the signed webhook has been
tested in the provider sandbox. Never expose the API or IPN secret to the browser.

## 4. Install and build

Open cPanel Terminal, activate the virtual environment command shown by cPanel,
then run these commands inside the application root:

```text
npm ci --include=dev
npm run typecheck
npm run build:cpanel
npm prune --omit=dev
```

The `NEXT_PUBLIC_` variables are embedded during `next build`. If any of them
change, rebuild before restarting the application.

Return to **Setup Node.js App** and click **Restart**. Open `/api/hello` and then
the homepage to verify the deployment.

## 5. Configure cron jobs

Use **cPanel > Cron Jobs**. Replace the domain and secret below. If the hosting
plan allows one-minute cron intervals, configure settlement processing every
minute:

```text
* * * * * curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR_DOMAIN/api/cron/settlements >/dev/null 2>&1
* * * * * curl -fsS -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR_DOMAIN/api/cron/sports-feed >/dev/null 2>&1
15 0 * * * curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR_DOMAIN/api/cron/bonuses >/dev/null 2>&1
```

The cPanel cron above updates providers once per minute. A provider offering
push/WebSocket delivery, or polling every few seconds, needs an always-running
worker supported by the hosting plan or a small separate VPS. Configure and test
providers from `/admin/providers` after the database migration is applied.

## 6. Supabase settings

In Supabase Authentication URL Configuration, set the Site URL to the production
domain and add these redirect URLs:

```text
https://YOUR_DOMAIN/**
https://www.YOUR_DOMAIN/**
```

Apply every SQL migration before enabling user registration. Create the first
admin through Supabase Auth, set its profile to `is_admin = true` with
`admin_role = 'super_admin'`, and enroll authenticator-app 2FA before using
`/admin/login`.

## Important

cPanel deployment makes the application reachable; it does not provide gambling
licensing, real sports/casino feeds, KYC/AML approval, payment approval or an
independent security audit.
