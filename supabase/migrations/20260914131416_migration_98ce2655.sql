-- Enable RLS on all tables
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bet_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing profile policies to recreate them with admin support
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);
CREATE POLICY "Admins can update all profiles" ON profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- Wallet transactions policies
CREATE POLICY "Users can view own transactions" ON wallet_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can insert transactions" ON wallet_transactions FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Admins can view all transactions" ON wallet_transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- Sports, leagues, events, markets, odds - public read
CREATE POLICY "Public can view active sports" ON sports FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public can view active leagues" ON leagues FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Public can view events" ON events FOR SELECT USING (TRUE);
CREATE POLICY "Public can view markets" ON markets FOR SELECT USING (TRUE);
CREATE POLICY "Public can view active odds" ON odds FOR SELECT USING (is_active = TRUE);

-- Admin write policies for sports management
CREATE POLICY "Admins can manage sports" ON sports FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);
CREATE POLICY "Admins can manage leagues" ON leagues FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);
CREATE POLICY "Admins can manage events" ON events FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);
CREATE POLICY "Admins can manage markets" ON markets FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);
CREATE POLICY "Admins can manage odds" ON odds FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'sports_trader'))
);

-- Bets policies
CREATE POLICY "Users can view own bets" ON bets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own bets" ON bets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all bets" ON bets FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);
CREATE POLICY "Admins can update bets" ON bets FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- Bet selections policies
CREATE POLICY "Users can view own bet selections" ON bet_selections FOR SELECT USING (
  EXISTS (SELECT 1 FROM bets WHERE id = bet_selections.bet_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert bet selections" ON bet_selections FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM bets WHERE id = bet_selections.bet_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can view all bet selections" ON bet_selections FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- Promotions policies
CREATE POLICY "Public can view active promotions" ON promotions FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Admins can manage promotions" ON promotions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'finance'))
);

-- User bonuses policies
CREATE POLICY "Users can view own bonuses" ON user_bonuses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can insert bonuses" ON user_bonuses FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Admins can view all bonuses" ON user_bonuses FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);

-- KYC documents policies
CREATE POLICY "Users can view own kyc docs" ON kyc_documents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can upload kyc docs" ON kyc_documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage kyc docs" ON kyc_documents FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'kyc'))
);

-- Favorites policies
CREATE POLICY "Users can manage own favorites" ON favorites FOR ALL USING (auth.uid() = user_id);

-- Support tickets policies
CREATE POLICY "Users can view own tickets" ON support_tickets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create tickets" ON support_tickets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all tickets" ON support_tickets FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);
CREATE POLICY "Admins can update tickets" ON support_tickets FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE AND admin_role IN ('super_admin', 'support'))
);

-- Audit logs policies
CREATE POLICY "Admins can view audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);
CREATE POLICY "Admins can insert audit logs" ON audit_logs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
);