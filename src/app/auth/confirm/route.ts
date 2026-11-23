import { go } from "@/lib/http";
import { verifyInviteToken } from "@/lib/supabase/auth-actions";
import { publicSupabaseConfig } from "@/lib/supabase/config";
import { sessionClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const code = query.get("code");
  if (!publicSupabaseConfig() || !code || code.length > 512) return go(request, "/login", { notice: "confirm" });
  const db = await sessionClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) return go(request, "/login", { notice: "confirm" });
  const invite = verifyInviteToken(query.get("invite"));
  return go(request, invite ? "/invite/" + invite : "/workspace");
}
