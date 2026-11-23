export const brand = { name: "Oniro Dev", workspace: "Sari Studio", agent: "Alex Reyes" };
export const statuses = ["New", "Open", "Pending", "Resolved"] as const;
export const leadStages = ["New Lead", "Interested", "Quotation Sent", "Booked", "Closed Won", "Closed Lost"] as const;
export const agents = ["Alex Reyes", "Ina Villanueva", "Paolo Cruz"] as const;
export const pages = ["Sari Studio", "Sari Home"] as const;

export type Message = {
  id: string;
  kind: "inbound" | "outbound" | "note";
  body: string;
  time: string;
  sentAt?: number;
};

export type Conversation = {
  id: string;
  name: string;
  initials: string;
  color: "coral" | "sky" | "lilac" | "sand" | "mint";
  page: typeof pages[number];
  email?: string;
  status: typeof statuses[number];
  lead: typeof leadStages[number];
  assignee?: typeof agents[number];
  tags: string[];
  unread: number;
  time: string;
  date: string;
  messages: Message[];
};

const latestDay = "January 24, 2025";
const rows: Array<Omit<Conversation, "messages"> & { preview: string }> = [
  { id: "maria", name: "Maria Santos", initials: "MS", color: "coral", page: "Sari Studio", email: "maria.santos@example.com", status: "Open", lead: "Interested", assignee: "Alex Reyes", tags: ["Repeat customer", "Quezon City"], unread: 1, time: "10:24 AM", date: latestDay, preview: "Yes po! ’Yung linen tote bag, 1 piece lang po. Gaano po katagal ang delivery sa Quezon City?" },
  { id: "joaquin", name: "Joaquin Reyes", initials: "JR", color: "sky", page: "Sari Studio", status: "Pending", lead: "Quotation Sent", assignee: "Ina Villanueva", tags: ["Quotation"], unread: 1, time: "9:58 AM", date: latestDay, preview: "Salamat po! Sige po, wait ko na lang ’yung quotation." },
  { id: "bea", name: "Bea Tan", initials: "BT", color: "lilac", page: "Sari Home", status: "New", lead: "New Lead", tags: [], unread: 1, time: "9:41 AM", date: latestDay, preview: "Pwede po ba i-ship today? Nasa Makati po ako." },
  { id: "carlo", name: "Carlo Ramos", initials: "CR", color: "sand", page: "Sari Studio", status: "New", lead: "New Lead", tags: ["Bulk order"], unread: 0, time: "Yesterday", date: "January 23, 2025", preview: "May bulk order po ba kayo for 30 pieces?" },
  { id: "liza", name: "Liza Cruz", initials: "LC", color: "mint", page: "Sari Home", status: "Resolved", lead: "Closed Won", assignee: "Paolo Cruz", tags: [], unread: 0, time: "Yesterday", date: "January 23, 2025", preview: "Na-receive ko na po, thank you so much!" },
  { id: "jan", name: "Jan Dela Cruz", initials: "JD", color: "sky", page: "Sari Studio", status: "Open", lead: "Interested", assignee: "Alex Reyes", tags: [], unread: 0, time: "Jan 22", date: "January 22, 2025", preview: "Anong sizes po ang available ngayon?" },
  { id: "aira", name: "Aira Padilla", initials: "AP", color: "coral", page: "Sari Home", status: "Pending", lead: "Booked", assignee: "Ina Villanueva", tags: ["Pick-up"], unread: 0, time: "Jan 21", date: "January 21, 2025", preview: "Pwede po pa-update ng status ng order ko?" },
  { id: "rico", name: "Rico Villanueva", initials: "RV", color: "mint", page: "Sari Studio", status: "Resolved", lead: "Closed Won", assignee: "Paolo Cruz", tags: [], unread: 0, time: "Jan 20", date: "January 20, 2025", preview: "Saan po puwedeng magbayad?" },
];

export const demoConversations: Conversation[] = rows.map(({ preview, ...row }) => ({
  ...row,
  messages: [
    ...(row.id === "maria" ? [
      { id: "maria-1", kind: "inbound" as const, body: "Hi! Available pa po ba for delivery to Quezon City?", time: "10:12 AM", sentAt: Date.parse("2025-01-24T10:12:00+08:00") },
      { id: "maria-2", kind: "outbound" as const, body: "Hello, Maria! Yes po, we deliver to Quezon City. 😊 May item po ba kayo na gusto i-order?", time: "10:17 AM", sentAt: Date.parse("2025-01-24T10:17:00+08:00") },
    ] : []),
    { id: row.id + "-last", kind: "inbound", body: preview, time: row.id === "maria" ? "10:24 AM" : row.time },
  ],
}));

export function lastPublicMessage(conversation: Conversation) {
  return conversation.messages.findLast((message) => message.kind !== "note");
}
