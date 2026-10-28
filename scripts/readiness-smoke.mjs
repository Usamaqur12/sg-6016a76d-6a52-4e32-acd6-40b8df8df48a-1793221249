#!/usr/bin/env node

console.log("🔍 Checking Production Readiness...\n");

const checks = {
  "Demo Mode": process.env.NEXT_PUBLIC_DEMO_MODE === "false",
  "Demo Backend": process.env.NEXT_PUBLIC_ENABLE_DEMO_BACKEND === "false",
  "Supabase URL": process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("supabase.co"),
  "Supabase Anon Key": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.startsWith("eyJ"),
  "Service Role Key": process.env.SUPABASE_SERVICE_ROLE_KEY?.startsWith("eyJ"),
  "Site Name": !!process.env.NEXT_PUBLIC_SITE_NAME,
  "Site URL": !!process.env.NEXT_PUBLIC_SITE_URL,
};

let allPassed = true;
for (const [check, passed] of Object.entries(checks)) {
  const status = passed ? "✅" : "❌";
  console.log(`${status} ${check}`);
  if (!passed) allPassed = false;
}

console.log("\n" + (allPassed ? "✅ Production Ready!" : "⚠️  Configuration Incomplete"));
console.log("\nNext Steps:");
console.log("1. Read: QUICK_START_URDU.md (اردو میں مکمل guide)");
console.log("2. Create Supabase account");
console.log("3. Update .env.local with real credentials");
console.log("4. Restart: pm2 restart all\n");