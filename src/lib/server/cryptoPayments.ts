import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortRecursively((value as Record<string, unknown>)[key]);
      return result;
    }, {});
  }
  return value;
}

export function canonicalPaymentPayload(payload: unknown) {
  return JSON.stringify(sortRecursively(payload));
}

export function verifyNowPaymentsSignature(payload: unknown, signature: string | undefined, secret: string | undefined) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha512", secret).update(canonicalPaymentPayload(payload)).digest("hex");
  const receivedBuffer = Buffer.from(signature.toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function paymentPayloadHash(payload: unknown) {
  return createHash("sha256").update(canonicalPaymentPayload(payload)).digest("hex");
}

