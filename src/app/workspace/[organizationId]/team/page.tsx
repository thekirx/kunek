import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Button } from "@/components/ui/button";
import { requireMembership } from "@/lib/supabase/access";
import { verifyInviteToken } from "@/lib/supabase/auth-actions";

export default async function Team({ params, searchParams }: {
  params: Promise<{ organizationId: string }>; searchParams: Promise<{ notice?: string }>;
}) {
  const { organizationId } = await params;
  const { role } = await requireMembership(organizationId, true);
  const { notice } = await searchParams;
  const token = notice === "created" ? verifyInviteToken((await cookies()).get("oniro_invite_link")?.value) : undefined;
  const headerList = await headers();
  const origin = process.env.ONIRO_APP_URL || `http://${headerList.get("host") ?? "localhost:3000"}`;
  const invite = token ? new URL("/invite/" + token, origin).toString() : undefined;
  return <main className="oniro-access"><section className="oniro-panel">
    <Link href={`/workspace/${organizationId}`}>Back to inbox</Link>
    <h1>Invite a teammate</h1>
    {notice === "failed" && <p role="alert">Unable to create the invitation. Try again.</p>}
    {notice === "invalid" && <p role="alert">Check the invitee email and role.</p>}
    {invite && <label>Share this link with the invitee<input readOnly value={invite} /><small>The link expires in two days and requires the invited email address.</small></label>}
    <form action="/api/invitations/create" method="post">
      <input name="organizationId" type="hidden" value={organizationId} />
      <label>Invitee email<input name="email" type="email" maxLength={254} required /></label>
      <label>Role<select name="role"><option value="agent">Agent</option>{role === "owner" && <option value="admin">Admin</option>}</select></label>
      <Button type="submit">Create invitation</Button>
    </form>
  </section></main>;
}
