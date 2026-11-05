import { createHmac } from "node:crypto";

const BASE_URL = "https://ccpayment.com/ccpayment/v2";
let usdFiatIdPromise: Promise<number> | null = null;

type CCPaymentEnvelope<T> = {
  code: number;
  msg: string;
  data: T;
};

export function getCCPaymentConfiguration() {
  const appId = process.env.CCPAYMENT_APP_ID?.trim();
  const appSecret = process.env.CCPAYMENT_APP_SECRET?.trim();
  const fiatId = process.env.CCPAYMENT_USD_FIAT_ID?.trim();
  return {
    appId,
    appSecret,
    fiatId,
    configured: Boolean(appId && appSecret),
  };
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


type FiatListResponse = {
  fiats?: Array<{ fiatId?: string | number; symbol?: string }>;
};

export async function resolveCCPaymentUsdFiatId() {
  const configuredId = process.env.CCPAYMENT_USD_FIAT_ID?.trim();
  if (configuredId) {
    const value = Number(configuredId);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("CCPAYMENT_USD_FIAT_ID must be a positive integer");
    return value;
  }

  if (!usdFiatIdPromise) {
    usdFiatIdPromise = ccPaymentRequest<FiatListResponse>("getFiatList", {})
      .then((data) => {
        const usd = data.fiats?.find((fiat) => fiat.symbol?.toUpperCase() === "USD");
        if (usd?.fiatId === undefined || usd.fiatId === null) {
          throw new Error("USD is unavailable in the CCPayment fiat list");
        }
        const value = Number(usd.fiatId);
        if (!Number.isSafeInteger(value) || value <= 0) throw new Error("CCPayment returned an invalid USD fiat ID");
        return value;
      })
      .catch((error) => {
        usdFiatIdPromise = null;
        throw error;
      });
  }

  return usdFiatIdPromise;
}
