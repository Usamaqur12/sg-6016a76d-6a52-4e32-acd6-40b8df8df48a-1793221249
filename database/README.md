# PrimeBet database deployment

PrimeBet uses **Supabase PostgreSQL**, Supabase Auth and Supabase Storage. A normal
cPanel MySQL database is not compatible with this application. The Node.js app
on cPanel connects to a separate production Supabase project over HTTPS.

## New Supabase project (recommended)

1. Create a new Supabase project and wait for it to become healthy.
2. Open **SQL Editor > New query**.
3. Paste and run `01_primebet_complete_schema.sql` once. It installs every
   ordered migration inside one transaction, so an error rolls the install back.
4. Run `04_verify_installation.sql`. It must return
   `launch smoke checks passed`.
5. In **Authentication > Users**, create the first admin user with a strong,
   unique password and confirmed email.
6. Replace the email placeholder in `03_promote_first_admin.sql`, then run that
   file in SQL Editor.
7. Sign in at `/admin/login` and enroll authenticator-app 2FA. Database admin
   permissions intentionally require an AAL2/MFA session.
8. Copy Project URL, public anon key and service-role key into the cPanel Node.js
   application environment variables described in `CPANEL_DEPLOYMENT.md`.

Do not load `02_optional_demo_seed.sql` into a real-money project. It contains
play-money fixtures for staging demonstrations only.

## Existing Supabase project

Do not run the complete installer against an existing PrimeBet database. Apply
only missing files from `supabase/migrations` in filename order, then run the
verification SQL.

If you use Supabase CLI, the preferred commands are:

```text
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

## Production settings

- Set Authentication Site URL and redirect URLs to the final HTTPS domain.
- Keep `NEXT_PUBLIC_ENABLE_DEMO_BACKEND=false` on cPanel.
- Keep `NEXT_PUBLIC_DEMO_MODE=true` until licensing, payments, KYC and provider
  acceptance are complete.
- Never expose the service-role key in a `NEXT_PUBLIC_` variable.
- Enable the backup option appropriate to the Supabase plan and perform a restore
  drill before launch.

