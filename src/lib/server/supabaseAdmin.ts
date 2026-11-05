import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseServiceKey = (
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY
)?.trim();

/**
 * Keep API modules loadable even when a deployment secret is missing.
 * requireAdminApi returns a clear 503 before any privileged query executes.
 */
export const isSupabaseAdminConfigured = Boolean(supabaseUrl && supabaseServiceKey);

const clientUrl = supabaseUrl || "http://127.0.0.1:54321";
const clientKey = supabaseServiceKey || "missing-server-supabase-key";

export const supabase = createClient(clientUrl, clientKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Alias for backwards compatibility
export const supabaseAdmin = supabase;
