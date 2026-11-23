import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicSupabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  const config = publicSupabaseConfig();
  if (!config) return NextResponse.next({ request });
  let response = NextResponse.next({ request });
  const db = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
        if (headers) {
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        }
      },
    },
  });
  await db.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/workspace/:path*", "/invite/:path*"] };
