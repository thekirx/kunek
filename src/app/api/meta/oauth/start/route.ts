import { randomBytes } from "node:crypto";
import { z } from "zod";
import { appOrigin, go, sameOrigin } from "@/lib/http";
import { metaOAuthConfig } from "@/lib/meta/config";
import { hashNonce, metaPath, metaStateCookie } from "@/lib/meta/connection";
import { buildOAuthUrl, createOAuthState } from "@/lib/meta/oauth";
import { memberRole } from "@/lib/supabase/access";
import { currentSession, serviceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const org = z.uuid().safeParse(form?.get("organizationId")).data;
  if (!org) return new Response("Invalid organization", { status: 400 });
  const path = `/workspace/${org}/channels`;
  try {
    const { user, db } = await currentSession();
    if (!user) return go(request, "/login");
    const role = await memberRole(db, user.id, org);
    if (!role || role === "agent") return new Response("Forbidden", { status: 403 });

    const config = metaOAuthConfig();
    if (new URL(config.redirectUri).origin !== appOrigin(request)) throw new Error("Invalid callback origin");
    const nonce = randomBytes(32).toString("base64url");
    const { error } = await serviceClient().rpc("oniro_oauth_start", {
      p_actor: user.id, p_org: org, p_nonce_hash: hashNonce(nonce),
    });
    if (error) throw new Error("Unable to store OAuth state");
    const state = createOAuthState({ userId: user.id, organizationId: org, nonce }, config.stateSecret);
    const response = go(request, buildOAuthUrl(config, state).toString());
    response.cookies.set(metaStateCookie, org + "." + nonce, {
      httpOnly: true, secure: true, sameSite: "lax", path: metaPath, maxAge: 600,
    });
    return response;
  } catch {
    return go(request, path, { notice: "configuration" });
  }
}
