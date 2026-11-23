import "server-only";
import { NextResponse } from "next/server";

export function appOrigin(request: Request) {
  const configured = process.env.ONIRO_APP_URL;
  const url = new URL(configured || request.url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!configured && !loopback) || (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username || url.password) throw new Error("Invalid application origin");
  return url.origin;
}

export function sameOrigin(request: Request) {
  try {
    return request.headers.get("origin") === appOrigin(request);
  } catch {
    return false;
  }
}

export function go(request: Request, path: string, params?: Record<string, string>) {
  const url = new URL(path, appOrigin(request));
  for (const [name, value] of Object.entries(params ?? {})) url.searchParams.set(name, value);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function databaseStatus(code?: string) {
  switch (code) {
    case "42501": return 403;
    case "P0002": return 404;
    case "22023": return 400;
    case "55000":
    case "23505": return 409;
    default: return 503;
  }
}
