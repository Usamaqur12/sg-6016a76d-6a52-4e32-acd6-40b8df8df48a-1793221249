import { createHash } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";

type RateEntry = { count: number; resetAt: number };
type ProtectionOptions = { limit: number; windowMs: number; scope: string; requireJson?: boolean; failClosed?: boolean };

const globalRateStore = globalThis as typeof globalThis & { __primebetRateStore?: Map<string, RateEntry> };
const rateStore = globalRateStore.__primebetRateStore || new Map<string, RateEntry>();
globalRateStore.__primebetRateStore = rateStore;

function clientAddress(req: NextApiRequest) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return raw?.trim() || req.socket.remoteAddress || "unknown";
}

function anonymousClientKey(req: NextApiRequest, scope: string) {
  const salt = process.env.API_RATE_LIMIT_SALT || "primebet-local-rate-limit";
  return createHash("sha256").update(`${salt}:${scope}:${clientAddress(req)}`).digest("hex");
}

async function distributedRateEntry(key: string, windowMs: number): Promise<RateEntry | null> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!baseUrl || !token) return null;

  const response = await fetch(`${baseUrl}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([["INCR", key], ["PTTL", key]]),
    signal: AbortSignal.timeout(2_500),
  });
  if (!response.ok) throw new Error(`Distributed rate limiter returned ${response.status}`);
  const payload = await response.json() as Array<{ result?: number }>;
  const count = Number(payload[0]?.result || 0);
  let ttl = Number(payload[1]?.result ?? -1);
  if (ttl < 0) {
    const expiry = await fetch(`${baseUrl}/pexpire/${encodeURIComponent(key)}/${windowMs}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_500),
    });
    if (!expiry.ok) throw new Error(`Distributed rate limiter expiry returned ${expiry.status}`);
    ttl = windowMs;
  }
  return { count, resetAt: Date.now() + Math.max(ttl, 1) };
}

function localRateEntry(key: string, windowMs: number) {
  const now = Date.now();
  const current = rateStore.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  entry.count += 1;
  rateStore.set(key, entry);
  if (rateStore.size > 5_000) {
    for (const [storedKey, stored] of rateStore) if (stored.resetAt <= now) rateStore.delete(storedKey);
  }
  return entry;
}

export async function protectApi(req: NextApiRequest, res: NextApiResponse, options: ProtectionOptions) {
  if (options.requireJson && !["GET", "HEAD"].includes(req.method || "") && !String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    res.status(415).json({ error: "Content-Type application/json is required" });
    return false;
  }

  const now = Date.now();
  const key = `primebet:rate:${options.scope}:${anonymousClientKey(req, options.scope)}`;
  let entry: RateEntry;
  try {
    entry = await distributedRateEntry(key, options.windowMs) || localRateEntry(key, options.windowMs);
  } catch (error) {
    console.error("Distributed rate limiter unavailable", error);
    if (options.failClosed) {
      res.status(503).json({ error: "Request protection is temporarily unavailable" });
      return false;
    }
    entry = localRateEntry(key, options.windowMs);
  }

  const remaining = Math.max(options.limit - entry.count, 0);
  res.setHeader("X-RateLimit-Limit", String(options.limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
  if (entry.count > options.limit) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return false;
  }

  return true;
}

