import { createHmac, timingSafeEqual } from "node:crypto";
export function verifySignature(raw: Buffer, signature: string | null, secret: string) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

export function verifySubscription(query: URLSearchParams, secret: string) {
  const challenge = query.get("hub.challenge");
  const token = query.get("hub.verify_token");
  if (!secret || !token || query.get("hub.mode") !== "subscribe" || !challenge || !/^\d+$/.test(challenge)) return null;
  const supplied = Buffer.from(token);
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? challenge : null;
}
