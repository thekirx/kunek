import "server-only";
import { z } from "zod";
import { appOrigin, go, sameOrigin } from "@/lib/http";
import { publicSupabaseConfig } from "./config";
import { sessionClient } from "./server";

const emailSchema = z.email().max(254);
const inviteSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const verifyInviteToken = (value: unknown) => inviteSchema.safeParse(value).data;

export async function handleCredentials(request: Request, mode: "login" | "signup") {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const path = "/" + mode;
  if (!publicSupabaseConfig()) return go(request, path, { notice: "configuration" });
  const form = await request.formData().catch(() => null);
  const invite = verifyInviteToken(form?.get("invite"));
  const params: Record<string, string> = invite ? { invite } : {};
  const email = emailSchema.safeParse(String(form?.get("email") ?? "").trim().toLowerCase());
  const password = z.string().min(mode === "signup" ? 8 : 1).max(128).safeParse(form?.get("password"));
  if (!email.success || !password.success) return go(request, path, { ...params, notice: "invalid" });
  const db = await sessionClient();
  if (mode === "login") {
    const { error } = await db.auth.signInWithPassword({ email: email.data, password: password.data });
    return error ? go(request, path, { ...params, notice: "login" }) : go(request, invite ? "/invite/" + invite : "/workspace");
  }
  const confirmation = new URL("/auth/confirm", appOrigin(request));
  if (invite) confirmation.searchParams.set("invite", invite);
  const { data, error } = await db.auth.signUp({
    email: email.data, password: password.data, options: { emailRedirectTo: confirmation.toString() },
  });
  if (error) return go(request, path, { ...params, notice: "signup" });
  if (data.session) return go(request, invite ? "/invite/" + invite : "/workspace");
  return go(request, "/login", { ...params, notice: "check-email" });
}
