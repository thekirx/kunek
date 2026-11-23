import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { candidatesFor } from "@/lib/meta/connection";
import { metaOAuthConfig } from "@/lib/meta/config";
import { requireMembership } from "@/lib/supabase/access";

const notices: Record<string, string> = {
  connected: "Messenger Page connected.",
  disconnected: "Messenger Page disconnected.",
  configuration: "Meta configuration is incomplete. Check the setup instructions.",
  state: "The authorization request expired, was cancelled, or could not be verified. Start again.",
  oauth: "Unable to retrieve authorized Pages. Review the Meta app permissions and try again.",
  expired: "Page selection has expired. Authorize with Meta again.",
  authorization: "Meta rejected the credentials or permissions. Authorize with Meta again.",
  conflict: "This Page may belong to another workspace or have an operation already in progress.",
  operation: "The Page operation could not be completed.",
  uncertain: "Meta did not confirm the change. The Page needs attention. Check its status and wait five minutes before trying again.",
};

export default async function Channels({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ notice?: string; attempt?: string }>;
}) {
  const { organizationId } = await params;
  const { db, user } = await requireMembership(organizationId, true);
  const query = await searchParams;
  const attempt = z.uuid().safeParse(query.attempt).data;
  const { data, error } = await db.from("channels").select("id,name,status").eq("organization_id", organizationId).order("name");
  const candidates = attempt ? await candidatesFor(user.id, organizationId, attempt).catch(() => null) : null;
  let configured = true;
  try { metaOAuthConfig(); } catch { configured = false; }
  const notice = query.notice && Object.hasOwn(notices, query.notice) ? notices[query.notice] : undefined;
  return <main className="oniro-access"><section className="oniro-panel oniro-wide">
    <Link href={`/workspace/${organizationId}`}>Back to inbox</Link>
    <h1>Messenger Pages</h1>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">Unable to load connected Pages.</p>}
    {!configured && !notice && <p>Set up the Meta app and server credentials to connect a Page.</p>}
    <form action="/api/meta/oauth/start" method="post">
      <input type="hidden" name="organizationId" value={organizationId} />
      <Button type="submit" disabled={!configured}>Authorize with Meta</Button>
    </form>
    {attempt && <section>
      <h2>Pages available to connect</h2>
      {!candidates ? <p>Page selection expired. Authorize with Meta again.</p> :
        !candidates.length ? <p>Meta returned no Pages you can connect.</p> : <ul>
          {candidates.map(({ id, name }) => <li key={id}>
            <form action="/api/meta/channels" method="post">
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="attempt" value={attempt} />
              <input type="hidden" name="pageId" value={id} />
              <strong>{name}</strong><Button name="action" type="submit" value="connect">Connect Page</Button>
            </form>
          </li>)}
        </ul>}
    </section>}
    <section><h2>Workspace Pages</h2>
      {!data?.length && !error ? <p>This workspace has no Messenger Pages yet.</p> : <ul>
        {data?.map((channel) => <li key={channel.id}>
          <form action="/api/meta/channels" method="post">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="channelId" value={channel.id} />
            <strong>{channel.name}</strong>
            <span>{channel.status === "attention" ? "Needs attention" : channel.status === "connected" ? "Connected" : "Disconnected"}</span>
            {channel.status !== "disconnected" && <Button variant="outline" name="action" type="submit" value="disconnect">Disconnect</Button>}
          </form>
        </li>)}
      </ul>}
      {data?.length ? <p>To reconnect a Page, authorize again and select that Page.</p> : null}
    </section>
  </section></main>;
}
