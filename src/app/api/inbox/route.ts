import { z } from "zod";
import { databaseStatus, json, sameOrigin } from "@/lib/http";
import { leadStages, statuses } from "@/lib/inbox/demo";
import { inboxSnapshot } from "@/lib/inbox/snapshot";
import { decryptCredential, graphVersion } from "@/lib/meta/config";
import { createMetaGraph } from "@/lib/meta/graph";
import { deliverReply, type ReplyReservation } from "@/lib/meta/reply";
import { memberRole } from "@/lib/supabase/access";
import { currentSession, serviceClient } from "@/lib/supabase/server";

async function authorized(organizationId: string) {
  const { db, user } = await currentSession();
  if (!user) return { response: json({ error: "Sign in to continue." }, 401) };
  const role = await memberRole(db, user.id, organizationId);
  if (!role) return { response: json({ error: "Workspace not found." }, 404) };
  return { db, user, role };
}

export async function GET(request: Request) {
  const organizationId = z.uuid().safeParse(new URL(request.url).searchParams.get("organizationId")).data;
  if (!organizationId) return json({ error: "Invalid organization." }, 400);
  try {
    const session = await authorized(organizationId);
    if (session.response) return session.response;
    return json(await inboxSnapshot(session.db, organizationId, session.user.id, session.role));
  } catch {
    return json({ error: "Could not load the inbox. Try again." }, 503);
  }
}

const actionSchema = z.object({ organizationId: z.uuid(), conversationId: z.uuid() }).and(z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), value: z.string().trim().min(1).max(2000), requestId: z.uuid() }),
  z.object({ action: z.literal("note"), value: z.string().trim().min(1).max(5000) }),
  z.object({ action: z.literal("status"), value: z.enum(statuses) }),
  z.object({ action: z.literal("lead"), value: z.enum(leadStages) }),
  z.object({ action: z.literal("assign"), value: z.uuid().nullable() }),
  z.object({ action: z.enum(["add_tag", "remove_tag"]), value: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal("read") }),
]));
type Action = z.infer<typeof actionSchema>;

function mutation(action: Exclude<Action, { action: "reply" }>) {
  switch (action.action) {
    case "note": return { action: "note", data: { body: action.value } };
    case "status": return { action: "status", data: { status: action.value.toLowerCase() } };
    case "lead": return { action: "lead", data: { leadStatus: action.value.toLowerCase().replaceAll(" ", "_") } };
    case "assign": return { action: "assign", data: { assigneeId: action.value } };
    case "add_tag":
    case "remove_tag": return { action: action.action, data: { name: action.value } };
    case "read": return { action: "mark_read", data: {} };
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const raw = await request.text().catch(() => "");
  if (raw.length > 12_000) return json({ error: "Request too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return json({ error: "Check the action and its fields." }, 400);
  const body = parsed.data;

  try {
    const session = await authorized(body.organizationId);
    if (session.response) return session.response;
    const service = serviceClient();
    const scope = { p_actor: session.user.id, p_org: body.organizationId, p_conversation_id: body.conversationId };
    if (body.action !== "reply") {
      const { action, data } = mutation(body);
      const result = await service.rpc("oniro_mutate_conversation", { ...scope, p_action: action, p_data: data });
      return result.error ? json({ error: "Could not update this conversation." }, databaseStatus(result.error.code)) : json({ ok: true });
    }

    const graph = createMetaGraph(graphVersion());
    const reservation = await service.rpc("oniro_reserve_outgoing", {
      ...scope, p_client_request_id: body.requestId, p_body: body.value,
    });
    if (reservation.error || !reservation.data) {
      const status = databaseStatus(reservation.error?.code);
      return json({ error: status === 409
        ? "This reply is unavailable. Check that the Page is connected and the customer messaged within the last 24 hours."
        : "Unable to reserve this reply." }, status);
    }
    const result = await deliverReply(reservation.data as ReplyReservation, {
      decrypt: (value, pageId) => decryptCredential(value, body.organizationId, pageId),
      send: (pageId, token, recipient) => graph.sendReply(pageId, token, recipient, body.value, body.requestId),
      finish: async (outcome, externalId) => {
        const { error } = await service.rpc("oniro_finish_outgoing", {
          p_actor: scope.p_actor, p_org: scope.p_org, p_message_id: reservation.data.message_id,
          p_outcome: outcome, p_external_message_id: externalId ?? null,
        });
        if (error) throw new Error("Unable to persist reply status");
      },
    });
    if (result.status === "queued") return json({ status: "queued", error: "Reply delivery could not be confirmed. Check the thread before sending again." }, 409);
    if (result.status === "failed") return json({ status: "failed", error: result.error ?? "Meta rejected this reply." }, 422);
    return json({ ok: true, status: result.status });
  } catch {
    return json({ error: "The inbox service is temporarily unavailable." }, 503);
  }
}
