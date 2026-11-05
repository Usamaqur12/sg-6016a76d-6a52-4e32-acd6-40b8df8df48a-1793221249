import { createHmac, timingSafeEqual } from "node:crypto";

const BASE_URL = "https://ccpayment.com/ccpayment/v2";

type CCPaymentEnvelope<T> = {
  code: number;
  msg: string;
  data: T;
};

export function getCCPaymentConfiguration() {
  const appId = process.env.CCPAYMENT_APP_ID?.trim();
  const appSecret = process.env.CCPAYMENT_APP_SECRET?.trim();
  const fiatId = process.env.CCPAYMENT_USD_FIAT_ID?.trim();
  const webhookSecret = process.env.CCPAYMENT_WEBHOOK_SECRET?.trim();

  return {
    appId,
    appSecret,
    fiatId,
    webhookSecret,
    configured: Boolean(appId && appSecret && fiatId && webhookSecret),
  };
}

export function secureStringEqual(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function ccPaymentRequest<T>(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<T> {
  const { appId, appSecret } = getCCPaymentConfiguration();
  if (!appId || !appSecret) {
    throw new Error("CCPayment App ID or App Secret is missing");
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign = createHmac("sha256", appSecret)
    .update(appId + timestamp + body)
    .digest("hex");

  const response = await fetch(`${BASE_URL}/${endpoint.replace(/^\//, "")}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      Appid: appId,
      Timestamp: timestamp,
      Sign: sign,
      "User-Agent": "MindBetPro-CCPayment/1.0",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });

  const raw = await response.text();
  let parsed: CCPaymentEnvelope<T>;
  try {
    parsed = JSON.parse(raw) as CCPaymentEnvelope<T>;
  } catch {
    throw new Error("CCPayment returned an invalid response");
  }

  if (!response.ok || parsed.code !== 10000) {
    const safeMessage = typeof parsed.msg === "string" ? parsed.msg.slice(0, 180) : "Request failed";
    throw new Error(`CCPayment request failed (${parsed.code || response.status}): ${safeMessage}`);
  }

  return parsed.data;
}
