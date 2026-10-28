# 🚀 Quick Start Guide (فوری شروعات)

## Step-by-Step Setup (5 minutes)

### 1️⃣ Supabase Project (2 min)
```
1. https://supabase.com پر جائیں
2. "Start your project" click کریں
3. Email سے sign up کریں
4. "New Project" بنائیں
5. Password set کریں (محفوظ کریں!)
6. Region select کریں (قریب ترین)
7. 2 منٹ انتظار کریں...
```

### 2️⃣ Database Setup (1 min)
```
1. Supabase میں "SQL Editor" کھولیں
2. "New Query" click کریں
3. اس project میں database/01_primebet_complete_schema.sql کھولیں
4. CTRL+A سے سب select کریں اور CTRL+C سے copy کریں
5. Supabase میں paste کریں (CTRL+V)
6. "Run" button دبائیں
7. ✅ Success message کا انتظار کریں
```

### 3️⃣ Admin User (1 min)
```
1. Supabase میں "Authentication" > "Users" جائیں
2. "Add User" click کریں
3. Email: admin@test.com
4. Password: Test@12345
5. ✓ Auto Confirm User
6. "Create User" دبائیں
```

### 4️⃣ Admin Role (30 sec)
```
1. Supabase "SQL Editor" میں new query بنائیں
2. یہ paste کریں:
   
   UPDATE auth.users 
   SET raw_user_meta_data = 
     jsonb_set(
       COALESCE(raw_user_meta_data, '{}'::jsonb),
       '{role}',
       '"admin"'
     )
   WHERE email = 'admin@test.com';

3. "Run" دبائیں
```

### 5️⃣ Configuration (1 min)
```
1. Supabase میں Settings > API جائیں
2. یہ 3 چیزیں copy کریں:
   - Project URL
   - anon public key  
   - service_role key

3. اس project کی .env.local فائل کھولیں
4. Replace کریں:
   NEXT_PUBLIC_SUPABASE_URL=your-copied-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-copied-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-copied-service-key

5. Save کریں (CTRL+S)
```

### 6️⃣ Start Server (30 sec)
```bash
pm2 restart all
```

### 7️⃣ Login! 🎉
```
1. Browser میں /admin/login پر جائیں
2. Email: admin@test.com
3. Password: Test@12345
4. Login!
```

---

## ✅ Ab Yeh Sab Kaam Karega

### Users Ke Liye:
- Registration/Login
- Betting (sports)
- Wallet (deposit/withdraw)
- Dashboard (stats)
- Support tickets
- Rewards program

### Admin Ke Liye:
- User management
- Bet monitoring
- Transaction approval
- KYC verification
- Reports/Analytics
- System settings

---

## 🆘 Problem Ho To?

### Login nahi ho raha?
```
- Email/password check karo
- Admin role assign hua? (Step 4)
- Supabase project active hai?
```

### Database error?
```
- Schema run hua? (Step 2)
- Verification query run karo:
  database/04_verify_installation.sql
```

### Server start nahi ho rahi?
```bash
# Logs dekho
pm2 logs nextjs

# Restart karo
pm2 restart all
```

---

## 📱 Test Karne Ke Liye

### User Account Test:
1. `/register` par jao
2. Naya account banao
3. Login karo
4. Test bet lagao (demo odds)

### Admin Panel Test:
1. `/admin/login` par jao
2. Admin credentials se login
3. Users/Bets/Transactions dekho
4. Settings explore karo

---

## 🎯 Production Ke Liye

Complete guide yahan hai: **PRODUCTION_SETUP_GUIDE_URDU.md**

Important steps:
- Real payment gateway
- SMS/Email service
- Sports odds provider
- SSL certificate
- Domain setup

---

**Mubarak ho! 🎊 Aapka betting platform ready hai!**