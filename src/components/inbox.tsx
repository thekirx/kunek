"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, CircleHelp, Menu, MessageCircle, MessageSquare, Moon, Search, Settings, Store, Users, UsersRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Details } from "@/components/inbox-details";
import { Initials, MessengerIcon, Picker } from "@/components/inbox-shared";
import { Thread } from "@/components/inbox-thread";
import { WorkspaceView, type Section } from "@/components/workspace-view";
import { brand, demoConversations, lastPublicMessage, pages, statuses, type Conversation } from "@/lib/inbox/demo";

const navigation = [
  { name: "Inbox", icon: MessageCircle },
  { name: "Customers", icon: UsersRound },
  { name: "Team", icon: Users },
  { name: "Analytics", icon: BarChart3 },
  { name: "Settings", icon: Settings },
] as const;

const filters = ["All", "Unread", "Mine"] as const;
const clock = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

export function Inbox() {
  const [conversations, setConversations] = useState(demoConversations);
  const [section, setSection] = useState<Section>("Inbox");
  const [id, setId] = useState(demoConversations[0].id);
  const [filter, setFilter] = useState<typeof filters[number]>("All");
  const [page, setPage] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState(true);
  const [mobilePane, setMobilePane] = useState<"list" | "thread" | "details">("list");
  const [navOpen, setNavOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [notification, setNotification] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileDetails = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && searchRef.current) {
        event.preventDefault();
        setMobilePane("list");
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function update(id: string, change: (previous: Conversation) => Conversation, promote = false) {
    setConversations((previous) => {
      if (!promote) return previous.map((item) => item.id === id ? change(item) : item);
      const current = previous.find((item) => item.id === id);
      return current ? [change(current), ...previous.filter((item) => item.id !== id)] : previous;
    });
  }

  function selectConversation(id: string) {
    setId(id);
    setSection("Inbox");
    setMobilePane("thread");
    update(id, (item) => ({ ...item, unread: 0 }));
  }

  function changeSection(next: Section) {
    setSection(next);
    setNavOpen(false);
    setMobilePane("list");
  }

  const active = conversations.find((item) => item.id === id)!;
  const query = search.trim().toLowerCase();
  const visible = conversations.filter((item) =>
    (!page || item.page === page) && (!status || item.status === status)
    && (filter !== "Unread" || item.unread > 0) && (filter !== "Mine" || item.assignee === brand.agent)
    && (!query || [item.name, ...item.tags, ...item.messages.filter((message) => message.kind !== "note").map((message) => message.body)]
      .some((value) => value.toLowerCase().includes(query))),
  );
  const unread = conversations.filter((item) => item.unread > 0).length;

  function send(kind: "outbound" | "note", body: string) {
    const sentAt = Date.now();
    const time = clock.format(sentAt);
    const message = { id: crypto.randomUUID(), kind, body, time, sentAt };
    update(id, (item) => ({ ...item, time: kind === "outbound" ? time : item.time, messages: [...item.messages, message] }), kind === "outbound");
  }

  return <div className="workspace" data-theme={dark ? "dark" : "light"} data-nav={navOpen ? "open" : "closed"}>
    <aside className="workspace-sidebar" aria-label="Workspace navigation">
      <div className="brand"><span className="brand-mark"><MessageSquare size={22} strokeWidth={2} /></span><strong>{brand.name}</strong></div>
      <div className="workspace-selector">
        <span>Workspace</span>
        <button type="button" onClick={() => changeSection("Settings")}><Store size={17} />{brand.workspace}<ChevronDown size={15} /></button>
      </div>
      <nav className="primary-nav">
        {navigation.map(({ name, icon: Icon }) => <button type="button" key={name} aria-current={section === name ? "page" : undefined} onClick={() => changeSection(name)}>
          <Icon size={19} strokeWidth={1.8} />{name}
          {name === "Inbox" && unread > 0 && <span className="nav-count">{unread}</span>}
        </button>)}
      </nav>
      <div className="sidebar-footer">
        <button type="button" className="theme-toggle" role="switch" aria-checked={dark} onClick={() => setDark(!dark)}><Moon size={18} />Dark mode<span className="switch-track" /></button>
        <button type="button" className="agent-profile" onClick={() => changeSection("Settings")}>
          <span className="agent-mark">AR</span><span><strong>{brand.agent}</strong><small>Owner</small></span><ChevronRight size={15} />
        </button>
      </div>
    </aside>
    {navOpen && <button type="button" className="nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
    <main className="workspace-main">
      <header className="topbar">
        <Button variant="ghost" size="icon-sm" className="nav-menu" aria-label={navOpen ? "Close navigation" : "Open navigation"} aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>{navOpen ? <X /> : <Menu />}</Button>
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{section}</strong></div>
        <Badge variant="secondary" className="demo-badge"><span />Demo workspace</Badge>
        <Button variant="ghost" size="icon-sm" aria-label="About this workspace" className="help-button" onClick={() => changeSection("Settings")}><CircleHelp /></Button>
      </header>
      {section === "Inbox" ? <div className="inbox-grid" data-details={details} data-pane={mobilePane}>
        <section className="conversation-list" aria-label="Conversations">
          <div className="list-controls">
            <div className="list-heading"><h1>Inbox</h1><p>Manage customer conversations</p></div>
            <div className="search-box"><Search size={17} aria-hidden="true" />
              <input ref={searchRef} aria-label="Search conversations" placeholder="Search conversations…" value={search} onChange={(event) => setSearch(event.target.value)} />
              {search ? <button type="button" aria-label="Clear search" onClick={() => { setSearch(""); searchRef.current?.focus(); }}><X size={15} /></button> : <kbd>Ctrl K</kbd>}
            </div>
            <div className="page-filter"><MessengerIcon /><Picker aria-label="Filter by Facebook Page" value={page} onChange={(event) => setPage(event.target.value)}>
              <option value="">All Pages</option>{pages.map((page) => <option key={page}>{page}</option>)}
            </Picker></div>
            <div className="list-filter">
              <div className="filter-buttons" aria-label="Inbox filter">
                {filters.map((item) => <button type="button" key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}
              </div>
              <Picker aria-label="Filter by status" className="filter-status" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Status</option>{statuses.map((status) => <option key={status}>{status}</option>)}
              </Picker>
            </div>
          </div>
          <div className="conversation-rows">
            {visible.map((item) => <button key={item.id} type="button" className="conversation-row"
              aria-current={id === item.id ? "true" : undefined} onClick={() => selectConversation(item.id)}>
              <Initials contact={item} />
              <span className="row-copy"><strong>{item.name}</strong><small>{lastPublicMessage(item)?.body}</small></span>
              <span className="row-meta"><time>{item.time}</time>{item.unread > 0 ? <span className="unread-dot" aria-label={`${item.unread} unread`}>{item.unread}</span>
                : <span className="row-assignee" title={item.assignee ?? "Unassigned"}>{item.assignee?.split(" ").map((part) => part[0]).join("") ?? "—"}</span>}</span>
            </button>)}
            {!visible.length && <div className="empty-list"><Search size={24} /><strong>No conversations found</strong><p>Try another search or reset your filters.</p>
              <Button variant="outline" size="sm" onClick={() => { setSearch(""); setFilter("All"); setPage(""); setStatus(""); }}>Reset filters</Button></div>}
          </div>
        </section>
        <section className="thread" aria-label="Message thread">
          <Thread key={id} conversation={active} onBack={() => setMobilePane("list")} onDetails={() => {
            const compact = window.matchMedia("(max-width: 1050px)").matches;
            if (compact) {
              setMobilePane("details");
              requestAnimationFrame(() => mobileDetails.current?.querySelector("button")?.focus());
            } else setDetails(!details);
          }} onStatus={(status) => update(id, (item) => ({ ...item, status }))} onSend={send} />
        </section>
        <aside className="customer-details" aria-label="Customer details" ref={mobileDetails}>
          <Details key={id} contact={active} onClose={() => {
            if (window.matchMedia("(max-width: 1050px)").matches) setMobilePane("thread");
            else setDetails(false);
          }} onChange={(change) => update(id, (item) => ({ ...item, ...change }))} />
        </aside>
      </div> : <WorkspaceView key={section} section={section} conversations={conversations} onOpenConversation={selectConversation}
        notification={notification} onNotificationChange={setNotification} />}
    </main>
  </div>;
}
