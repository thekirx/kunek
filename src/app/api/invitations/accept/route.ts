import { createHash } from "node:crypto";
import { go, sameOrigin } from "@/lib/http";
import { displayName } from "@/lib/supabase/access";
import { verifyInviteToken } from "@/lib/supabase/auth-actions";
import { currentSession, serviceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const token = verifyInviteToken(form?.get("token"));
  if (!token) return new Response("Invalid invitation", { status: 400 });
  const path = "/invite/" + token;
  try {
    const { user } = await currentSession();
    if (!user) return go(request, "/login", { invite: token });
    if (!user.email || !user.email_confirmed_at) return go(request, path, { notice: "verify" });
    const { data, error } = await serviceClient().rpc("oniro_accept_invitation", {
      p_actor: user.id, p_email: user.email, p_display_name: displayName(user.email),
      p_token_hash: createHash("sha256").update(token).digest("hex"),
    });
    return error || !data ? go(request, path, { notice: "failed" }) : go(request, "/workspace/" + data);
  } catch {
    return go(request, path, { notice: "failed" });
  }
}
