import { z } from "zod";
import { go, sameOrigin } from "@/lib/http";
import { decryptCredential, graphVersion } from "@/lib/meta/config";
import { candidatesFor } from "@/lib/meta/connection";
import { createMetaGraph, MetaGraphError } from "@/lib/meta/graph";
import { memberRole } from "@/lib/supabase/access";
import { currentSession, serviceClient } from "@/lib/supabase/server";

const actionSchema = z.object({ organizationId: z.uuid() }).and(z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), attempt: z.uuid(), pageId: z.string().regex(/^[0-9]{1,32}$/) }),
  z.object({ action: z.literal("disconnect"), channelId: z.uuid() }),
]));

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const input = actionSchema.safeParse(form ? Object.fromEntries(form) : null);
  if (!input.success) return new Response("Invalid Page operation", { status: 400 });
  const action = input.data;
  const org = action.organizationId;
  const path = `/workspace/${org}/channels`;
  const failed = (notice: string) => go(request, path, action.action === "connect" ? { notice, attempt: action.attempt } : { notice });
  try {
    const { user, db } = await currentSession();
    if (!user) return go(request, "/login");
    const role = await memberRole(db, user.id, org);
    if (!role || role === "agent") return new Response("Forbidden", { status: 403 });

    const graph = createMetaGraph(graphVersion());
    const service = serviceClient();
    const scope = { p_actor: user.id, p_org: org };
    const connecting = action.action === "connect";
    let operation: { channel_id: string; operation_id?: string; status?: string; page_id?: string };
    let subscribe: () => Promise<void>;
    if (connecting) {
      const pages = await candidatesFor(user.id, org, action.attempt);
      const selected = pages?.find((candidate) => candidate.id === action.pageId);
      if (!selected) return failed("expired");

      const token = decryptCredential(selected.ciphertext, org, selected.id);
      await graph.verifyPage(selected.id, token);
      const reserved = await service.rpc("oniro_reserve_channel", {
        ...scope, p_page_id: selected.id, p_name: selected.name, p_token_ciphertext: selected.ciphertext,
      });
      if (reserved.error || !reserved.data) return failed(reserved.error?.code === "55000" ? "conflict" : "operation");
      operation = reserved.data;
      subscribe = () => graph.subscribe(selected.id, token);
    } else {
      const appId = process.env.META_APP_ID;
      const appSecret = process.env.META_APP_SECRET;
      if (!appId || !appSecret) return failed("configuration");
      const reserved = await service.rpc("oniro_reserve_disconnect", { ...scope, p_channel_id: action.channelId });
      if (reserved.error || !reserved.data) return failed(reserved.error?.code === "55000" ? "conflict" : "operation");
      operation = reserved.data;
      if (operation.status === "disconnected") return go(request, path, { notice: "disconnected" });
      const pageId = operation.page_id;
      if (!pageId) return failed("operation");
      subscribe = () => graph.unsubscribe(pageId, appId + "|" + appSecret);
    }

    const finish = async (success: boolean) => service.rpc(connecting ? "oniro_finish_channel" : "oniro_finish_disconnect", {
      ...scope, p_channel_id: operation.channel_id, p_operation_id: operation.operation_id, p_success: success,
    });
    if (!operation.operation_id) return failed("operation");
    try {
      await subscribe();
    } catch (error) {
      if (!(error instanceof MetaGraphError) || error.kind === "ambiguous") return failed("uncertain");
      await finish(false);
      return failed(error.kind === "auth" ? "authorization" : "operation");
    }
    const result = await finish(true);
    const expected = connecting ? "connected" : "disconnected";
    return result.error || result.data?.status !== expected ? failed("uncertain")
      : go(request, path, connecting ? { notice: expected, attempt: action.attempt } : { notice: expected });
  } catch (error) {
    return failed(error instanceof MetaGraphError && error.kind === "auth" ? "authorization" : "operation");
  }
}
