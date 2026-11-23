import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const envelope = z.object({
  object: z.literal("page"),
  entry: z.array(z.object({
    id: z.string().min(1),
    messaging: z.array(z.unknown()).optional(),
  })),
});

const messageEvent = z.object({
  sender: z.object({ id: z.string().min(1) }),
  recipient: z.object({ id: z.string().min(1) }),
  timestamp: z.number().int().nonnegative(),
  message: z.object({
    mid: z.string().min(1),
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
  }),
});

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

export function readMessengerEvents(payload: unknown) {
  const events = [];
  const seen = new Set<string>();
  for (const page of envelope.parse(payload).entry) {
    for (const candidate of page.messaging ?? []) {
      const parsed = messageEvent.safeParse(candidate);
      if (!parsed.success) continue;
      const { sender, recipient, message, timestamp } = parsed.data;
      if (message.is_echo || recipient.id !== page.id) continue;
      const key = JSON.stringify([page.id, message.mid]);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ pageId: page.id, senderId: sender.id, messageId: message.mid, timestamp, text: message.text ?? null });
    }
  }
  return events;
}
