import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { serviceClient } from "@/lib/supabase/server";

export const metaStateCookie = "oniro_meta_oauth";
export const metaPath = "/api/meta/oauth";
export const hashNonce = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

export const candidateSchema = z.object({
  id: z.string().regex(/^[0-9]+$/).max(100),
  name: z.string().min(1).max(250),
  ciphertext: z.string().min(1).max(16384),
});
export type Candidate = z.infer<typeof candidateSchema>;

export async function candidatesFor(actorId: string, orgId: string, attempt: string) {
  const { data, error } = await serviceClient().rpc("oniro_oauth_pages", {
    p_actor: actorId, p_org: orgId, p_attempt: attempt,
  });
  if (error) throw new Error("Unable to load Pages");
  return data == null ? null : z.array(candidateSchema).parse(data);
}
