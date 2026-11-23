import "server-only";
import type { SessionClient } from "@/lib/supabase/server";
import type { LiveInboxSnapshot } from "./live-types";
import { leadStages, statuses, type Conversation, type Message } from "./demo";

type Row = {
  id: string;
  channel_id: string;
  contact_id: string;
  status: string;
  unread_count: number;
  created_at: string;
  last_message_at: string | null;
  contacts: { display_name: string; email: string | null; lead_status: string;
    contact_tags: { tags: { name: string } | null }[] } | null;
  messages: { id: string; direction: "inbound" | "outbound"; body: string | null; status: string;
    created_at: string; sent_at: string | null; delivered_at: string | null; read_at: string | null }[];
  conversation_notes: { id: string; body: string; created_at: string }[];
  conversation_assignments: { assignee_id: string }[];
};

const colors = ["coral", "sky", "lilac", "sand", "mint"] as const;
const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
const toEnum = (value: string) => value.toLowerCase().replaceAll(" ", "_");

function conversation(row: Row, pages: LiveInboxSnapshot["pages"], agents: LiveInboxSnapshot["agents"]): Conversation {
  const name = row.contacts?.display_name ?? "Messenger customer";
  const assigneeId = row.conversation_assignments[0]?.assignee_id;
  const page = pages.find((item) => item.id === row.channel_id);
  const messages: Message[] = [
    ...row.messages.map((message): Message => {
      const sentAt = Date.parse(message.sent_at ?? message.created_at);
      return {
        id: message.id, kind: message.direction, body: message.body ?? "Unsupported message attachment",
        deliveryStatus: message.read_at ? "read" : message.delivered_at ? "delivered"
          : message.status as Message["deliveryStatus"],
        sentAt, time: timeFormat.format(sentAt),
      };
    }),
    ...row.conversation_notes.map((note): Message => ({
      id: note.id, kind: "note", body: note.body, sentAt: Date.parse(note.created_at), time: timeFormat.format(new Date(note.created_at)),
    })),
  ].sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0) || a.id.localeCompare(b.id));
  return {
    id: row.id, name, initials: name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(),
    color: colors[(row.id.charCodeAt(0) + row.id.charCodeAt(1)) % colors.length],
    page: page?.name ?? "Messenger", pageId: row.channel_id, contactId: row.contact_id,
    email: row.contacts?.email ?? undefined,
    status: statuses.find((status) => toEnum(status) === row.status) ?? "New",
    lead: leadStages.find((lead) => toEnum(lead) === row.contacts?.lead_status) ?? "New Lead",
    assignee: agents.find((agent) => agent.id === assigneeId)?.name, assigneeId,
    tags: row.contacts?.contact_tags.flatMap((tag) => tag.tags ? [tag.tags.name] : []) ?? [],
    unread: row.unread_count, time: timeFormat.format(new Date(row.last_message_at ?? row.created_at)),
    date: dateFormat.format(new Date(row.created_at)), messages,
  };
}

export async function inboxSnapshot(db: SessionClient, organizationId: string, agentId: string, role: LiveInboxSnapshot["role"]) {
  const [org, channels, members, threads, subscription] = await Promise.all([
    db.from("organizations").select("id,name").eq("id", organizationId).single(),
    db.from("channels").select("id,name,status").eq("organization_id", organizationId).order("name"),
    db.from("organization_members").select("user_id,role,profiles(display_name)").eq("organization_id", organizationId),
    db.from("conversations").select(`
      id, channel_id, contact_id, status, unread_count, created_at, last_message_at,
      contacts(display_name,email,lead_status,contact_tags(tags(name))),
      messages(id,direction,body,status,created_at,sent_at,delivered_at,read_at),
      conversation_notes(id,body,created_at),conversation_assignments(assignee_id)
    `).eq("organization_id", organizationId)
      .is("conversation_assignments.ended_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false }).order("id")
      .limit(75)
      .order("created_at", { referencedTable: "messages", ascending: false })
      .limit(100, { referencedTable: "messages" })
      .order("created_at", { referencedTable: "conversation_notes", ascending: false })
      .limit(100, { referencedTable: "conversation_notes" }),
    db.from("organization_subscriptions").select("status,subscription_plans(name,price_centavos)")
      .eq("organization_id", organizationId).maybeSingle(),
  ]);

  if (org.error || channels.error || members.error || threads.error || subscription.error) throw new Error("Inbox could not be loaded");
  const pages = channels.data as LiveInboxSnapshot["pages"];
  const agents = (members.data as unknown as {
    user_id: string; role: string; profiles: { display_name: string } | null;
  }[]).map((member) => ({ id: member.user_id, role: member.role, name: member.profiles?.display_name ?? "Team member" }));
  const plan = subscription.data as unknown as { status: string; subscription_plans: { name: string; price_centavos: number } | null } | null;
  return {
    organizationId, organizationName: org.data.name, agentId, role,
    agentName: agents.find((agent) => agent.id === agentId)?.name ?? "Team member",
    pages, agents, conversations: (threads.data as unknown as Row[]).map((row) => conversation(row, pages, agents)),
    subscription: plan?.subscription_plans ? { status: plan.status, name: plan.subscription_plans.name,
      priceCentavos: plan.subscription_plans.price_centavos } : null,
  } satisfies LiveInboxSnapshot;
}
