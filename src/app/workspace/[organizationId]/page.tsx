import { Inbox } from "@/components/inbox";
import { requireMembership } from "@/lib/supabase/access";
import { inboxSnapshot } from "@/lib/inbox/snapshot";

export default async function WorkspaceInbox({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const { db, user, role } = await requireMembership(organizationId);
  const snapshot = await inboxSnapshot(db, organizationId, user.id, role);
  return <Inbox key={organizationId} live={snapshot} />;
}
