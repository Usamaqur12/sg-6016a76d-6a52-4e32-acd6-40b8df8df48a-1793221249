import { timingSafeEqual } from "node:crypto";

export function verifyBearerSecret(
  authorization: string | undefined,
  expectedSecret: string | undefined
): boolean {
  if (!authorization || !expectedSecret || !authorization.startsWith("Bearer ")) {
    return false;
  }

  const received = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(expectedSecret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
