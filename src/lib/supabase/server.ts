import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicSupabaseConfig } from "./config";

export async function sessionClient() {
  const config = publicSupabaseConfig();
  if (!config) throw new Error("Supabase authentication is unconfigured");
  const jar = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try {
          for (const { name, value, options } of values) jar.set(name, value, options);
        } catch {
          // Server Components are read-only. The proxy refreshes their session cookies.
        }
      },
    },
  });
}

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Supabase server access is unconfigured");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export type SessionClient = Awaited<ReturnType<typeof sessionClient>>;

export async function currentSession() {
  const db = await sessionClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError" && error.status !== 401 && error.status !== 403) {
    throw new Error("Unable to verify the session");
  }
  return { db, user };
}
