export type ReadinessOwner = "development" | "external";

export type RuntimeCheck = {
  id: string;
  label: string;
  ready: boolean;
  detail: string;
  owner: ReadinessOwner;
  critical?: boolean;
};

const placeholderPattern = /^(your-|replace-with|https:\/\/your-project|support@example\.com|<[^>]+>|undefined$|null$|changeme$)/i;

export function environmentValueConfigured(name: string) {
  const value = process.env[name]?.trim();
  return Boolean(value && !placeholderPattern.test(value));
}

function allConfigured(...names: string[]) {
  return names.every(environmentValueConfigured);
}

function anyConfigured(...names: string[]) {
  return names.some(environmentValueConfigured);
}

function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

export function getRuntimeReadiness() {
  const productionMode = enabled("PRODUCTION_MODE") || process.env.NODE_ENV === "production";
  const checks: RuntimeCheck[] = [
    {
      id: "database-secrets",
      label: "Supabase database and server keys",
      ready: allConfigured("NEXT_PUBLIC_SUPABASE_URL") &&
        anyConfigured("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
        anyConfigured("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
      detail: "URL, browser publishable/anon key, and server secret/service-role key must be configured.",
      owner: "development",
      critical: true,
    },
    {
      id: "demo-disabled",
      label: "Demo services disabled",
      ready: !enabled("NEXT_PUBLIC_DEMO_MODE") && !enabled("NEXT_PUBLIC_ENABLE_DEMO_BACKEND"),
      detail: "Both browser demo flags must be false on a live deployment.",
      owner: "development",
      critical: true,
    },
    {
      id: "worker-secrets",
      label: "Sports and cron worker secrets",
      ready: allConfigured("CRON_SECRET", "SPORTS_FEED_WEBHOOK_SECRET", "SPORTS_PROVIDER_ENCRYPTION_KEY"),
      detail: "Independent long random secrets protect schedules, feed callbacks, and stored provider credentials.",
      owner: "development",
      critical: true,
    },
    {
      id: "api-protection",
      label: "Shared API rate limiting",
      ready: allConfigured("API_RATE_LIMIT_SALT", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"),
      detail: "Configure a rate-limit salt and shared Redis counters for multi-instance hosting.",
      owner: "development",
      critical: true,
    },
    {
      id: "branding",
      label: "Public site identity",
      ready: allConfigured("NEXT_PUBLIC_SITE_NAME", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPPORT_EMAIL"),
      detail: "Set the public name, canonical HTTPS URL, and a monitored support address.",
      owner: "development",
    },
    {
      id: "monitoring",
      label: "Off-site error monitoring",
      ready: allConfigured("ERROR_MONITORING_WEBHOOK_URL", "ERROR_MONITORING_WEBHOOK_TOKEN"),
      detail: "Configure an external alert receiver and its authentication token.",
      owner: "external",
    },
    {
      id: "sports",
      label: "Production sports data provider",
      ready: environmentValueConfigured("SPORTS_PROVIDER_ENCRYPTION_KEY") && !enabled("NEXT_PUBLIC_DEMO_MODE"),
      detail: "Add a contracted provider in Admin → Providers and verify live sync and certified results.",
      owner: "external",
    },
    {
      id: "kyc",
      label: "KYC and AML provider",
      ready: allConfigured("KYC_PROVIDER_BASE_URL", "KYC_PROVIDER_API_KEY", "KYC_WEBHOOK_SECRET"),
      detail: "Identity, age, sanctions, PEP, and AML credentials are required for automated verification.",
      owner: "external",
    },
    {
      id: "communications",
      label: "Email and SMS delivery",
      ready: allConfigured("EMAIL_PROVIDER_API_KEY", "EMAIL_FROM", "SMS_PROVIDER_API_KEY", "SMS_FROM"),
      detail: "Configure transactional email and SMS providers for account and risk notices.",
      owner: "external",
    },
    {
      id: "licence",
      label: "Operating licence identity",
      ready: allConfigured("GAMBLING_LICENSE_NUMBER", "GAMBLING_LICENSE_JURISDICTION"),
      detail: "The operator must supply the approved licence number and jurisdiction.",
      owner: "external",
    },
    {
      id: "casino",
      label: "Licensed casino aggregator",
      ready: !enabled("CASINO_ENABLED") || allConfigured("CASINO_AGGREGATOR_BASE_URL", "CASINO_AGGREGATOR_API_KEY", "CASINO_CALLBACK_SECRET"),
      detail: enabled("CASINO_ENABLED") ? "Casino is enabled and requires complete aggregator credentials." : "Casino stays disabled until a licensed aggregator is connected.",
      owner: "external",
    },
    {
      id: "crypto",
      label: "Approved crypto deposits",
      ready: !enabled("CRYPTO_DEPOSITS_ENABLED") || allConfigured("NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"),
      detail: enabled("CRYPTO_DEPOSITS_ENABLED") ? "Crypto deposits are enabled and require valid provider webhook credentials." : "Crypto deposits stay disabled until merchant and compliance approval.",
      owner: "external",
    },
  ];

  const failedCriticalChecks = checks.filter((check) => check.critical && !check.ready).map((check) => check.id);
  return {
    productionMode,
    productionReady: failedCriticalChecks.length === 0,
    failedCriticalChecks,
    checks,
    timestamp: new Date().toISOString(),
  };
}

export function getReadinessStatus() {
  const runtime = getRuntimeReadiness();
  const ready = runtime.checks.filter((check) => check.ready).length;
  return {
    generatedAt: runtime.timestamp,
    score: Math.round((ready / runtime.checks.length) * 100),
    ready,
    total: runtime.checks.length,
    productionMode: runtime.productionMode,
    productionReady: runtime.productionReady,
    failedCriticalChecks: runtime.failedCriticalChecks,
    items: runtime.checks,
  };
}
