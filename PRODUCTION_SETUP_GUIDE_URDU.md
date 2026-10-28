# PrimeBet Production Setup Guide (اردو میں)

## ⚠️ اہم: یہ ایک مکمل betting platform ہے

یہ project **demo mode** سے **real production** میں convert کرنے کے لیے complete guide ہے.

---

## Step 1: Supabase Account Setup کریں

### 1.1 Supabase Project بنائیں
1. https://supabase.com پر جائیں اور sign up کریں
2. **New Project** button پر click کریں
3. Project details fill کریں:
   - **Name**: PrimeBet (یا اپنی پسند کا نام)
   - **Database Password**: ایک strong password بنائیں (محفوظ کر لیں!)
   - **Region**: اپنے قریب ترین region select کریں
4. **Create Project** پر click کریں اور 2-3 منٹ انتظار کریں

### 1.2 Project Settings نوٹ کریں
Project بن جانے کے بعد:
1. **Settings** > **API** میں جائیں
2. یہ values کاپی کر لیں:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon/public key**: `eyJhbGci...` (لمبی string)
   - **service_role key**: `eyJhbGci...` (دوسری لمبی string)

⚠️ **service_role key کو SECURE رکھیں** - یہ database کی full access دیتی ہے!

---

## Step 2: Database Schema Install کریں

### 2.1 SQL Editor میں Schema چلائیں
1. Supabase dashboard میں **SQL Editor** پر جائیں
2. **New Query** button click کریں
3. `database/01_primebet_complete_schema.sql` فائل کھولیں اس project میں
4. **پوری فائل کی content** کاپی کریں (6700+ lines)
5. Supabase SQL Editor میں paste کریں
6. **Run** button دبائیں
7. 30-60 سیکنڈ انتظار کریں - Success message آنا چاہیے

### 2.2 Installation Verify کریں
1. نیا query بنائیں
2. `database/04_verify_installation.sql` کی content paste کریں
3. Run کریں
4. Result میں **"launch smoke checks passed"** دکھنا چاہیے

✅ اگر یہ message آیا تو database **perfect** install ہوا!

---

## Step 3: First Admin User بنائیں

### 3.1 User Create کریں
1. Supabase میں **Authentication** > **Users** پر جائیں
2. **Add User** > **Create new user** click کریں
3. Fill کریں:
   - **Email**: اپنا email (admin access کے لیے)
   - **Password**: strong password (یاد رکھیں!)
   - **Auto Confirm User**: ✓ (check کریں)
4. **Create User** دبائیں

### 3.2 Admin Role دیں
1. `database/03_promote_first_admin.sql` فائل کھولیں
2. Line 41 میں email replace کریں:
   ```sql
   WHERE email = 'your-email@example.com'  -- اپنا email یہاں لکھیں
   ```
3. Supabase SQL Editor میں یہ query run کریں
4. Success message آنا چاہیے

---

## Step 4: Project Configuration (.env.local)

اب اپنے project کی `.env.local` فائل update کریں:

```bash
# === PRODUCTION CONFIGURATION ===

# Demo mode کو DISABLE کریں (production کے لیے)
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_ENABLE_DEMO_BACKEND=false

# Supabase Configuration (Step 1.2 سے copy کریں)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...your-anon-key-here...

# Server-only Secret (NEVER NEXT_PUBLIC_)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...your-service-role-key-here...

# Site Configuration
NEXT_PUBLIC_SITE_NAME=PrimeBet
NEXT_PUBLIC_SITE_URL=https://your-domain.com
NEXT_PUBLIC_DISPLAY_CURRENCY=PKR
NEXT_PUBLIC_SUPPORT_EMAIL=support@yourdomain.com

# Security Secrets (random strings بنائیں)
SPORTS_FEED_WEBHOOK_SECRET=long-random-string-123456789
SPORTS_PROVIDER_ENCRYPTION_KEY=another-long-random-string-987654321
CRON_SECRET=cron-secret-random-string-456789123
API_RATE_LIMIT_SALT=rate-limit-salt-random-789456123

# Crypto Payments (optional - start with disabled)
CRYPTO_DEPOSITS_ENABLED=false
NEXT_PUBLIC_CRYPTO_DEPOSITS_ENABLED=false

# Casino Integration (optional - start with disabled)
CASINO_ENABLED=false

# Web Push Notifications (optional)
WEB_PUSH_ENABLED=false

# Production Mode
PRODUCTION_MODE=true
ENFORCE_PRODUCTION_READINESS=false
```

---

## Step 5: Server Restart کریں

Configuration update کرنے کے بعد:

```bash
pm2 restart all
```

یا npm script:
```bash
npm run dev
```

---

## Step 6: Admin Panel میں Login کریں

1. Browser میں `/admin/login` پر جائیں
2. Step 3.1 میں بنائے ہوئے email/password سے login کریں
3. **2FA setup** کریں (Google Authenticator یا Authy app)
4. Dashboard access ہو جائے گا

---

## ✅ Features Jo Ab Work کریں گے

### User Features:
- ✅ **Registration/Login** - Real Supabase auth
- ✅ **Wallet System** - Deposits, withdrawals, transactions
- ✅ **Sports Betting** - Place bets, view odds
- ✅ **Bet History** - Complete betting records
- ✅ **Dashboard** - User stats اور overview
- ✅ **Support Tickets** - Issue reporting
- ✅ **Rewards Program** - Points اور tiers
- ✅ **Settings** - Profile, preferences, security

### Admin Features:
- ✅ **User Management** - View/edit users
- ✅ **Bet Management** - Monitor/settle bets
- ✅ **Transaction Control** - Approve withdrawals
- ✅ **KYC Verification** - Document review
- ✅ **Risk Management** - Exposure monitoring
- ✅ **Reports** - Analytics اور insights
- ✅ **Sports Providers** - Configure odds feeds
- ✅ **Promotions** - Create/manage bonuses

---

## 🔧 Advanced Configuration (Optional)

### Sports Odds Provider Setup
Real-time odds کے لیے provider connect کریں:
1. Admin panel میں `/admin/providers` جائیں
2. Sports provider add کریں (OpenLigaDB, BetRadar, etc.)
3. API credentials configure کریں

### Payment Gateway Integration
Real payments کے لیے:
1. Crypto: NowPayments account بنائیں
2. Bank: Manual deposits/withdrawals already supported
3. E-wallets: JazzCash/EasyPaisa configuration

### Email/SMS Notifications
1. SendGrid یا Mailgun account setup
2. Twilio for SMS (optional)
3. `.env.local` میں credentials add کریں

---

## 🚨 Important Security Notes

1. **Service Role Key** - یہ کبھی browser/frontend میں expose نہ کریں
2. **Random Secrets** - تمام secrets unique random strings ہونی چاہیے
3. **HTTPS** - Production میں ہمیشہ SSL use کریں
4. **2FA** - Admin accounts پر compulsory
5. **RLS Policies** - Supabase میں already configured ہیں

---

## 🆘 Troubleshooting

### "Supabase connection failed"
- Check کریں `.env.local` میں URL اور keys correct ہیں
- Supabase project status check کریں (should be healthy)

### "Database error"
- Schema installation verify کریں (Step 2.2)
- Supabase logs check کریں

### "Admin login not working"
- User email confirmed ہے؟ (Step 3.1)
- Admin role assigned ہے؟ (Step 3.2)
- 2FA setup complete ہے?

---

## 📞 Support

Issues کے لیے:
1. Supabase logs check کریں: Settings > API > Logs
2. Browser console errors دیکھیں (F12)
3. Server logs: `pm2 logs nextjs`

---

## ✅ Final Checklist

Before going live:

- [ ] Supabase project created اور healthy
- [ ] Database schema installed اور verified
- [ ] Admin user created اور role assigned
- [ ] `.env.local` updated with real credentials
- [ ] Demo mode disabled
- [ ] Server restarted successfully
- [ ] Admin panel accessible
- [ ] Test user registration working
- [ ] Test bet placement working
- [ ] Wallet transactions working

**Congratulations! 🎉 Aapka betting platform production-ready ہے!**