import { type NextRequest } from "next/server";
import { z } from "zod";
import { go } from "@/lib/http";
import { encryptCredential, metaOAuthConfig } from "@/lib/meta/config";
import { candidateSchema, hashNonce, metaPath, metaStateCookie } from "@/lib/meta/connection";
import { createMetaGraph } from "@/lib/meta/graph";
import { readOAuthState } from "@/lib/meta/oauth";
import { memberRole } from "@/lib/supabase/access";
import { currentSession, serviceClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const [orgValue, nonce] = request.cookies.get(metaStateCookie)?.value.split(".") ?? [];
  const org = z.uuid().safeParse(orgValue).data;
  const path = org ? `/workspace/${org}/channels` : "/workspace";
  function done(params: Record<string, string>, destination = path) {
    const response = go(request, destination, params);
    response.cookies.set(metaStateCookie, "", {
      httpOnly: true, secure: true, sameSite: "lax", path: metaPath, maxAge: 0,
    });
    return response;
  }

  if (!org || !nonce || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return done({ notice: "state" });
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!state || !code || code.length > 4096) return done({ notice: "state" });

  try {
    const { user, db } = await currentSession();
    if (!user) return done({}, "/login");
    const role = await memberRole(db, user.id, org);
    const config = metaOAuthConfig();
    if (!role || role === "agent" ||
        !readOAuthState(state, { userId: user.id, organizationId: org, nonce }, config.stateSecret)) {
      return done({ notice: "state" });
    }

    const service = serviceClient();
    const { data: attempt, error } = await service.rpc("oniro_oauth_claim", {
      p_actor: user.id, p_org: org, p_nonce_hash: hashNonce(nonce),
    });
    if (error || !attempt) return done({ notice: "state" });
    const graph = createMetaGraph(config.version);
    const token = await graph.exchangeCode({ ...config, code });
    const pages = await graph.pages(token);
    const candidates = pages.map((page) => candidateSchema.parse({
      id: page.id, name: page.name, ciphertext: encryptCredential(page.accessToken, org, page.id),
    }));
    const saved = await service.rpc("oniro_oauth_save_pages", {
      p_actor: user.id, p_org: org, p_attempt: attempt, p_candidates: candidates,
    });
    if (saved.error || !saved.data) throw new Error("Unable to store Pages");
    return done({ attempt });
  } catch {
    return done({ notice: "oauth" });
  }
}
