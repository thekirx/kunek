import type { Conversation } from "./demo";

export type LiveInboxSnapshot = {
  organizationId: string;
  organizationName: string;
  agentId: string;
  agentName: string;
  role: "owner" | "admin" | "agent";
  conversations: Conversation[];
  pages: { id: string; name: string; status: string }[];
  agents: { id: string; name: string; role: string }[];
  subscription?: { name: string; status: string; priceCentavos: number } | null;
};

export type LiveInboxAction = "status" | "assign" | "note" | "add_tag" | "remove_tag" | "lead" | "read" | "reply";
