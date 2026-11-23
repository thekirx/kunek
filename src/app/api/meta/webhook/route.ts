import { readMessengerEvents, verifySignature, verifySubscription } from "@/lib/meta/webhook";

export const runtime = "nodejs";

const maxBodyBytes = 1024 * 1024;

export function GET(request: Request) {
  const token = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!token) return new Response("Webhook is unconfigured", { status: 503 });
  const challenge = verifySubscription(new URL(request.url).searchParams, token);
  return challenge === null ? new Response("Forbidden", { status: 403 }) : new Response(challenge);
}

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return new Response("Webhook is unconfigured", { status: 503 });
  if (!request.body) return new Response("Missing body", { status: 400 });

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      length += result.value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        return new Response("Body too large", { status: 413 });
      }
      chunks.push(result.value);
    }
  } catch {
    return new Response("Unreadable body", { status: 400 });
  } finally {
    reader.releaseLock();
  }

  const raw = Buffer.concat(chunks, length);
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const events = readMessengerEvents(JSON.parse(raw.toString("utf8")));
    // Keep Meta's retries available until tenant-scoped persistence is wired.
    if (events.length) return new Response("Message persistence is unavailable", { status: 503 });
    return new Response("OK");
  } catch {
    return new Response("Invalid webhook payload", { status: 400 });
  }
}
