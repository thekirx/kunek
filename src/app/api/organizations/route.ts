import { z } from "zod";
import { go, sameOrigin } from "@/lib/http";
import { displayName } from "@/lib/supabase/access";
import { currentSession, serviceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  try {
    const { user } = await currentSession();
    if (!user) return go(request, "/login");
    const form = await request.formData().catch(() => null);
    const name = z.string().trim().min(1).max(100).safeParse(form?.get("name"));
    if (!name.success) return go(request, "/workspace", { notice: "create" });
    const { data, error } = await serviceClient().rpc("oniro_create_organization", {
      p_actor: user.id, p_name: name.data, p_display_name: displayName(user.email),
    });
    if (error || !data?.organization_id) return go(request, "/workspace", { notice: "create" });
    return go(request, "/workspace/" + data.organization_id);
  } catch {
    return go(request, "/workspace", { notice: "create" });
  }
}
