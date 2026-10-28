const http = require("node:http");
const next = require("next");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3000", 10);

function configured(name) {
  const value = process.env[name]?.trim();
  return Boolean(value && !/^(your-|replace-with|https:\/\/your-project|support@example\.com|<[^>]+>|undefined$|null$|changeme$)/i.test(value));
}

function enforceProductionReadiness() {
  if (process.env.ENFORCE_PRODUCTION_READINESS !== "true") return;
  const missing = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SPORTS_FEED_WEBHOOK_SECRET", "SPORTS_PROVIDER_ENCRYPTION_KEY", "CRON_SECRET",
    "API_RATE_LIMIT_SALT", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
    "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPPORT_EMAIL",
  ].filter((name) => !configured(name));
  if (!configured("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") && !configured("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  }
  if (!configured("SUPABASE_SECRET_KEY") && !configured("SUPABASE_SERVICE_ROLE_KEY")) {
    missing.push("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)");
  }
  if (process.env.NODE_ENV !== "production") missing.push("NODE_ENV=production");
  if (process.env.PRODUCTION_MODE !== "true") missing.push("PRODUCTION_MODE=true");
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "false") missing.push("NEXT_PUBLIC_DEMO_MODE=false");
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO_BACKEND === "true") missing.push("NEXT_PUBLIC_ENABLE_DEMO_BACKEND=false");
  if (missing.length) throw new Error(`Production startup blocked. Missing or unsafe configuration: ${missing.join(", ")}`);
}

enforceProductionReadiness();

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((request, response) => {
      handle(request, response);
    });

    server.listen(port, hostname, () => {
      console.log(`PrimeBet is running on http://${hostname}:${port}`);
    });

    const shutdown = (signal) => {
      console.log(`${signal} received; closing PrimeBet server.`);
      server.close(() => process.exit(0));
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((error) => {
    console.error("PrimeBet failed to start", error);
    process.exit(1);
  });
