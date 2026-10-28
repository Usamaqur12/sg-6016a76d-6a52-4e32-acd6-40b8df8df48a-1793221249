import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export function casinoPayloadHash(payload: unknown) {
  return createHash("sha256").update(canonical(payload)).digest("hex");
}

export function verifyCasinoSignature(payload: unknown, signature: string | undefined, secret: string | undefined) {
  if (!signature || !secret) return false;
  const provided = signature.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = createHmac("sha256", secret).update(canonical(payload)).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

export async function createCasinoLaunch(input: { sessionId: string; gameId: string; userId: string; currency: string; callbackUrl: string; returnUrl: string }) {
  const baseUrl = process.env.CASINO_AGGREGATOR_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.CASINO_AGGREGATOR_API_KEY;
  const sessionPath = process.env.CASINO_SESSION_PATH || "/v1/sessions";
  if (!baseUrl || !apiKey) throw new Error("Casino aggregator is not configured");
  const response = await fetch(`${baseUrl}${sessionPath.startsWith("/") ? sessionPath : `/${sessionPath}`}`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      clientSessionId: input.sessionId,
      gameId: input.gameId,
      playerId: input.userId,
      currency: input.currency,
      callbackUrl: input.callbackUrl,
      returnUrl: input.returnUrl,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const providerSessionId = String(payload.sessionId || payload.session_id || "");
  const launchUrl = String(payload.launchUrl || payload.launch_url || payload.url || "");
  if (!response.ok || !providerSessionId || !/^https:\/\//i.test(launchUrl)) throw new Error("Casino provider rejected the launch request");
  return { providerSessionId, launchUrl };
}
