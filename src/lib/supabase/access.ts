import "server-only";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentSession, type SessionClient } from "./server";
import { publicSupabaseConfig } from "./config";

export const roleSchema = z.enum(["owner", "admin", "agent"]);

export async function memberRole(db: SessionClient, userId: string, orgId: string) {
  const { data, error } = await db.from("organization_members").select("role")
    .eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Unable to verify organization membership");
  return data ? roleSchema.parse(data.role) : null;
}

export async function requireSession() {
  if (!publicSupabaseConfig()) redirect("/login?notice=configuration");
  const session = await currentSession();
  if (!session.user) redirect("/login");
  return { db: session.db, user: session.user };
}

export async function requireMembership(orgId: string, manager = false) {
  if (!z.uuid().safeParse(orgId).success) notFound();
  const session = await requireSession();
  const role = await memberRole(session.db, session.user.id, orgId);
  if (!role || (manager && role === "agent")) notFound();
  return { ...session, role };
}

export function displayName(email: string | undefined, provided?: string) {
  return (provided?.trim() || email?.split("@")[0] || "Team member").slice(0, 100);
}
