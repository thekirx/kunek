import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { go, sameOrigin } from "@/lib/http";
import { memberRole } from "@/lib/supabase/access";
import { currentSession, serviceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const organizationId = z.uuid().safeParse(form?.get("organizationId")).data;
  if (!organizationId) return new Response("Invalid organization", { status: 400 });
  const path = `/workspace/${organizationId}/team`;
  const email = z.email().max(254).safeParse(String(form?.get("email") ?? "").trim().toLowerCase()).data;
  const role = z.enum(["admin", "agent"]).safeParse(form?.get("role")).data;
  if (!email || !role) return go(request, path, { notice: "invalid" });
  try {
    const { db, user } = await currentSession();
    if (!user) return go(request, "/login");
    const member = await memberRole(db, user.id, organizationId);
    if (!member || member === "agent" || (role === "admin" && member !== "owner")) return new Response("Forbidden", { status: 403 });
    const token = randomBytes(32).toString("base64url");
    const { error } = await serviceClient().rpc("oniro_create_invitation", {
      p_actor: user.id, p_org: organizationId, p_email: email, p_role: role,
      p_token_hash: createHash("sha256").update(token).digest("hex"),
    });
    if (error) return go(request, path, { notice: "failed" });
    const response = go(request, path, { notice: "created" });
    response.cookies.set("oniro_invite_link", token, {
      path, maxAge: 300, httpOnly: true, secure: new URL(process.env.ONIRO_APP_URL || request.url).protocol === "https:", sameSite: "lax",
    });
    return response;
  } catch {
    return go(request, path, { notice: "failed" });
  }
}
