"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { initials, Initials, MessengerIcon } from "@/components/inbox-shared";
import { agents, brand, leadStages, pages, type Conversation } from "@/lib/inbox/demo";
import type { LiveInboxSnapshot } from "@/lib/inbox/live-types";

export type Section = "Inbox" | "Customers" | "Team" | "Analytics" | "Settings";

type Props = {
  section: Exclude<Section, "Inbox">;
  conversations: Conversation[];
  onOpenConversation: (id: string) => void;
  notification: boolean;
  onNotificationChange: (value: boolean) => void;
  live?: LiveInboxSnapshot;
};

const demoTeam = agents.map((name, index) => ({ id: name, name, role: index === 0 ? "Owner" : index === 1 ? "Admin" : "Agent" }));
const demoPages = pages.map((name) => ({ id: name, name, status: "Sample Page" }));
const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });

export function WorkspaceView({ section, conversations, onOpenConversation, notification, onNotificationChange, live }: Props) {
  const [search, setSearch] = useState("");
  const contacts = new Map<string, Conversation>();
  for (const item of conversations) {
    const key = item.contactId ?? item.id;
    if (!contacts.has(key)) contacts.set(key, item);
  }
  const customers = [...contacts.values()];
  const query = search.trim().toLowerCase();
  const visibleCustomers = section === "Customers" ? customers.filter((customer) => [customer.name, ...customer.tags].some((value) => value.toLowerCase().includes(query))) : [];
  const responseTimes = section === "Analytics" ? conversations.flatMap((conversation) => {
    const inbound = conversation.messages.find((message) => message.kind === "inbound");
    const outbound = conversation.messages.find((message) => message.kind === "outbound" && message.sentAt != null && inbound?.sentAt != null && message.sentAt >= inbound.sentAt
      && (!live || ["sent", "delivered", "read"].includes(message.deliveryStatus ?? "")));
    return inbound?.sentAt != null && outbound?.sentAt != null ? [(outbound.sentAt - inbound.sentAt) / 60_000] : [];
  }) : [];
  const metrics = [
    ["Total conversations", conversations.length],
    ["Open", conversations.filter((item) => item.status === "Open").length],
    ["Unassigned", conversations.filter((item) => !(live ? item.assigneeId : item.assignee)).length],
    ["Resolved", conversations.filter((item) => item.status === "Resolved").length],
    ["Avg. first response", responseTimes.length ? `${(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length).toFixed(1)} min` : "—"],
  ];

  return <div className="workspace-view">
    <h1>{section}</h1>
    {section === "Customers" && <>
      <div className="search-box view-search"><Search size={17} /><input aria-label="Search customers" placeholder="Search by name or tag…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="workspace-card">
        {visibleCustomers.map((item) => <div className="workspace-row" key={item.id}>
          <Initials contact={item} /><div><strong>{item.name}</strong><small>{item.page}</small></div>
          <Badge variant="secondary">{item.lead}</Badge>
          <Button variant="ghost" size="icon-sm" aria-label={`Open conversation with ${item.name}`} onClick={() => onOpenConversation(item.id)}><ArrowUpRight /></Button>
        </div>)}
        {!visibleCustomers.length && <p className="workspace-row">{live && !customers.length ? "No customers yet." : "No customers found."}</p>}
      </div>
    </>}
    {section === "Team" && <div className="workspace-card">
      {(live?.agents ?? demoTeam).map(({ id, name, role }) => <div className="workspace-row" key={id}>
        <span className="agent-mark">{initials(name)}</span>
        <div><strong>{name}</strong><small>{conversations.filter((item) => (live ? item.assigneeId : item.assignee) === id).length} assigned{live ? " in inbox" : ""}</small></div>
        <Badge variant="secondary" className="workspace-role">{role}</Badge>
      </div>)}
      {live && !live.agents.length && <p className="workspace-row">No team members found.</p>}
      {live && live.role !== "agent" && <div className="workspace-row"><Button asChild variant="outline" size="sm"><Link href={`/workspace/${live.organizationId}/team`}>Manage team</Link></Button></div>}
    </div>}
    {section === "Analytics" && <>
      {live && <p className="metrics-scope">Metrics cover the conversations currently loaded in the inbox.</p>}
      <dl className="metrics">{metrics.map(([label, value]) => <div className="workspace-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="workspace-card"><h2>Leads by stage</h2>
        {leadStages.map((stage) => <div className="workspace-row" key={stage}>
          <div>{stage}</div><strong>{customers.filter((item) => item.lead === stage).length}</strong>
        </div>)}
      </div>
    </>}
    {section === "Settings" && <>
      <div className="workspace-card"><h2>Organization</h2>
        <div className="workspace-row"><div><strong>{live?.organizationName ?? brand.workspace}</strong>{!live && <small>Demo organization</small>}</div></div>
      </div>
      <div className="workspace-card"><h2>Facebook Pages</h2>
        {(live?.pages ?? demoPages).map(({ id, name, status }) => <div className="workspace-row" key={id}><MessengerIcon /><div><strong>{name}</strong><small>Messenger</small></div><Badge variant="secondary" className="workspace-role">{status.replaceAll("_", " ")}</Badge></div>)}
        {live && !live.pages.length && <p className="workspace-row">No Facebook Pages connected.</p>}
        {live && live.role !== "agent" && <div className="workspace-row"><Button asChild variant="outline" size="sm"><Link href={`/workspace/${live.organizationId}/channels`}>Manage Facebook Pages</Link></Button></div>}
      </div>
      <div className="workspace-card"><h2>{live && !live.subscription ? "Account" : "Account and subscription"}</h2>
        <div className="workspace-row"><div><strong>{live?.agentName ?? brand.agent}</strong><small className="workspace-role">{live?.role ?? "Owner"}</small></div></div>
        {live?.subscription && <div className="workspace-row"><div><strong>{live.subscription.name}</strong><small>{currency.format(live.subscription.priceCentavos / 100)}/month</small></div><Badge variant="outline" className="workspace-role">{live.subscription.status.replaceAll("_", " ")}</Badge></div>}
        {!live && <>
          <div className="workspace-row"><div><strong>Starter</strong><small>Proposed price · ₱499/month</small></div><Badge variant="outline">Unpaid</Badge></div>
          <div className="workspace-row"><div><strong>Message notifications</strong><small>Demo preference</small></div><input type="checkbox" aria-label="Message notifications" checked={notification} onChange={(event) => onNotificationChange(event.target.checked)} /></div>
        </>}
      </div>
    </>}
  </div>;
}
