"use client";

import { useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Initials, MessengerIcon } from "@/components/inbox-shared";
import { agents, brand, leadStages, pages, type Conversation } from "@/lib/inbox/demo";

export type Section = "Inbox" | "Customers" | "Team" | "Analytics" | "Settings";

type Props = {
  section: Exclude<Section, "Inbox">;
  conversations: Conversation[];
  onOpenConversation: (id: string) => void;
  notification: boolean;
  onNotificationChange: (value: boolean) => void;
};

export function WorkspaceView({ section, conversations, onOpenConversation, notification, onNotificationChange }: Props) {
  const [search, setSearch] = useState("");
  const responseTimes = conversations.flatMap((conversation) => {
    const inbound = conversation.messages.find((message) => message.kind === "inbound");
    const outbound = conversation.messages.find((message) => message.kind === "outbound" && message.sentAt != null && inbound?.sentAt != null && message.sentAt >= inbound.sentAt);
    return inbound?.sentAt != null && outbound?.sentAt != null ? [(outbound.sentAt - inbound.sentAt) / 60_000] : [];
  });
  const metrics = [
    ["Total conversations", conversations.length],
    ["Open", conversations.filter((item) => item.status === "Open").length],
    ["Unassigned", conversations.filter((item) => !item.assignee).length],
    ["Resolved", conversations.filter((item) => item.status === "Resolved").length],
    ["Avg. first response", responseTimes.length ? `${(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length).toFixed(1)} min` : "—"],
  ];

  return <div className="workspace-view">
    <h1>{section}</h1>
    {section === "Customers" && <>
      <div className="search-box view-search"><Search size={17} /><input aria-label="Search customers" placeholder="Search by name or tag…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="workspace-card">
        {conversations.filter((item) => [item.name, ...item.tags].some((value) => value.toLowerCase().includes(search.trim().toLowerCase()))).map((item) => <div className="workspace-row" key={item.id}>
          <Initials contact={item} /><div><strong>{item.name}</strong><small>{item.page}</small></div>
          <Badge variant="secondary">{item.lead}</Badge>
          <Button variant="ghost" size="icon-sm" aria-label={`Open conversation with ${item.name}`} onClick={() => onOpenConversation(item.id)}><ArrowUpRight /></Button>
        </div>)}
        {!conversations.some((item) => [item.name, ...item.tags].some((value) => value.toLowerCase().includes(search.trim().toLowerCase()))) && <p className="workspace-row">No customers found.</p>}
      </div>
    </>}
    {section === "Team" && <div className="workspace-card">
      {agents.map((agent, index) => <div className="workspace-row" key={agent}>
        <span className="agent-mark">{agent.split(" ").map((part) => part[0]).join("")}</span>
        <div><strong>{agent}</strong><small>{conversations.filter((item) => item.assignee === agent).length} assigned</small></div>
        <Badge variant="secondary">{index === 0 ? "Owner" : index === 1 ? "Admin" : "Agent"}</Badge>
      </div>)}
    </div>}
    {section === "Analytics" && <>
      <dl className="metrics">{metrics.map(([label, value]) => <div className="workspace-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="workspace-card"><h2>Leads by stage</h2>
        {leadStages.map((stage) => <div className="workspace-row" key={stage}>
          <div>{stage}</div><strong>{conversations.filter((item) => item.lead === stage).length}</strong>
        </div>)}
      </div>
    </>}
    {section === "Settings" && <>
      <div className="workspace-card"><h2>Organization</h2>
        <div className="workspace-row"><div><strong>{brand.workspace}</strong><small>Demo organization</small></div></div>
      </div>
      <div className="workspace-card"><h2>Facebook Pages</h2>
        {pages.map((page) => <div className="workspace-row" key={page}><MessengerIcon /><div><strong>{page}</strong><small>Messenger</small></div><Badge variant="secondary">Sample Page</Badge></div>)}
      </div>
      <div className="workspace-card"><h2>Account and subscription</h2>
        <div className="workspace-row"><div><strong>{brand.agent}</strong><small>Owner</small></div></div>
        <div className="workspace-row"><div><strong>Starter</strong><small>Proposed price · ₱499/month</small></div><Badge variant="outline">Unpaid</Badge></div>
        <div className="workspace-row"><div><strong>Message notifications</strong><small>Demo preference</small></div><input type="checkbox" aria-label="Message notifications" checked={notification} onChange={(event) => onNotificationChange(event.target.checked)} /></div>
      </div>
    </>}
  </div>;
}
