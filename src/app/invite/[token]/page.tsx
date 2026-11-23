import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { verifyInviteToken } from "@/lib/supabase/auth-actions";
import { publicSupabaseConfig } from "@/lib/supabase/config";
import { currentSession } from "@/lib/supabase/server";

export default async function Invite({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ notice?: string }>;
}) {
  const { token } = await params;
  if (!verifyInviteToken(token)) notFound();
  const { notice } = await searchParams;
  const { user } = publicSupabaseConfig() ? await currentSession() : { user: null };
  return <main className="oniro-access"><section className="oniro-panel">
    <h1>Workspace invitation</h1>
    {notice === "verify" && <p role="alert">Verify your email before accepting the invitation.</p>}
    {notice === "failed" && <p role="alert">This invitation may have expired or belong to another account.</p>}
    {user ? <form action="/api/invitations/accept" method="post">
      <input type="hidden" name="token" value={token} />
      <Button type="submit">Accept invitation</Button>
    </form> : <nav>
      <Link href={{ pathname: "/login", query: { invite: token } }}>Sign in</Link>
      <Link href={{ pathname: "/signup", query: { invite: token } }}>Create account</Link>
    </nav>}
  </section></main>;
}
