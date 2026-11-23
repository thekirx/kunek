import { z } from "zod";

const postgresText = z.string().refine((value) => value.isWellFormed() && !value.includes("\0"));
const externalId = z.string().min(1).max(200).pipe(postgresText);
const messageId = z.string().min(1).max(500).pipe(postgresText);
const time = z.number().int().min(1).max(99_999_999_999_999);
const eventShape = z.object({
  sender: z.object({ id: externalId }),
  recipient: z.object({ id: externalId }),
  timestamp: time.optional(),
  message: z.object({
    mid: messageId,
    text: postgresText.optional(),
    is_echo: z.boolean().optional(),
    metadata: z.string().optional(),
  }).optional(),
  delivery: z.object({ mids: z.array(messageId).optional(), watermark: time.optional() }).optional(),
  read: z.object({ watermark: time }).optional(),
});
const envelope = z.object({ object: z.literal("page"), entry: z.array(z.object({
  id: externalId, messaging: z.array(z.unknown()).optional(),
})) });

export type MessengerEvent = {
  kind: "message" | "echo" | "delivery" | "read";
  pageId: string;
  senderId: string;
  timestamp: number;
  messageId?: string;
  clientRequestId?: string;
  text?: string | null;
  messageIds?: string[];
  watermark?: number;
};

export function parseMessengerEvents(payload: unknown): MessengerEvent[] {
  const events = new Map<string, MessengerEvent>();
  for (const page of envelope.parse(payload).entry) {
    for (const candidate of page.messaging ?? []) {
      if (!candidate || typeof candidate !== "object") continue;
      if (!("message" in candidate || "delivery" in candidate || "read" in candidate)) continue;
      const parsed = eventShape.safeParse(candidate);
      if (!parsed.success) continue;
      const { sender, recipient, timestamp, message, delivery, read } = parsed.data;
      const echo = !!message?.is_echo;
      if ((echo ? sender.id : recipient.id) !== page.id) continue;
      const occurredAt = timestamp ?? delivery?.watermark ?? read?.watermark;
      if (!occurredAt) continue;
      const base = { pageId: page.id, senderId: echo ? recipient.id : sender.id, timestamp: occurredAt };
      const event: MessengerEvent | null = message
        ? { ...base, kind: echo ? "echo" : "message", messageId: message.mid, text: message.text ?? null,
            clientRequestId: echo ? z.uuid().safeParse(message.metadata).data : undefined }
        : delivery
          ? { ...base, kind: "delivery", messageIds: [...new Set(delivery.mids)].sort(), watermark: delivery.watermark }
          : read ? { ...base, kind: "read", watermark: read.watermark } : null;
      if (event) {
        const key = [event.pageId, event.kind, event.senderId, event.messageId ?? event.watermark, event.messageIds];
        if (!events.has(JSON.stringify(key))) events.set(JSON.stringify(key), event);
      }
    }
  }
  return [...events.values()];
}
