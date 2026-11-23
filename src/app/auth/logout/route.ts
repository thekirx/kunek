import { go, sameOrigin } from "@/lib/http";
import { sessionClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const db = await sessionClient();
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error && error.name !== "AuthSessionMissingError") return go(request, "/login", { notice: "logout" });
  return go(request, "/login");
}
