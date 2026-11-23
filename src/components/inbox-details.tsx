"use client";

import { useState, type FormEvent } from "react";
import { Flag, Mail, Plus, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Initials, MessengerIcon, Picker } from "@/components/inbox-shared";
import { agents, leadStages, type Conversation } from "@/lib/inbox/demo";

export function Details({ contact, onClose, onChange }: {
  contact: Conversation;
  onClose: () => void;
  onChange: (change: Partial<Conversation>) => void;
}) {
  const [adding, setAdding] = useState(false);

  function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("tag") ?? "").trim();
    if (name && !contact.tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      onChange({ tags: [...contact.tags, name] });
    }
    setAdding(false);
  }

  return <>
    <header className="details-header">
      <h2>Customer details</h2>
      <Button variant="ghost" size="icon-sm" aria-label="Close customer details" onClick={onClose}><X /></Button>
    </header>
    <div className="details-body">
      <div className="customer-identity">
        <Initials large contact={contact} />
        <div><h3>{contact.name}</h3><p><MessengerIcon /> Messenger</p></div>
      </div>
      <dl className="customer-fields">
        <div><dt><Mail size={16} />Email</dt><dd title={contact.email}>{contact.email ?? "Unavailable"}</dd></div>
        <div><dt><Flag size={16} />Page</dt><dd>{contact.page}</dd></div>
      </dl>
      <section className="detail-section">
        <h3>Tags</h3>
        {contact.tags.length > 0 && <div className="tag-list">
          {contact.tags.map((tag) => <Badge key={tag} variant="secondary" className="contact-tag">
            {tag}
            <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange({ tags: contact.tags.filter((value) => value !== tag) })}><X size={12} /></button>
          </Badge>)}
        </div>}
        {adding ? <form onSubmit={addTag} className="tag-form">
          <input name="tag" aria-label="Tag name" placeholder="Tag name" maxLength={30} autoFocus required onKeyDown={(event) => {
            if (event.key === "Escape") setAdding(false);
          }} />
          <Button type="submit" size="sm">Add</Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel tag" onClick={() => setAdding(false)}><X /></Button>
        </form> : <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus />Add tag</Button>}
      </section>
      <section className="detail-section">
        <h3>Lead status</h3>
        <Picker aria-label="Lead status" className="lead-picker" value={contact.lead} onChange={(event) => onChange({ lead: event.target.value as Conversation["lead"] })}>
          {leadStages.map((stage) => <option key={stage}>{stage}</option>)}
        </Picker>
      </section>
      <section className="detail-section">
        <h3>Assigned to</h3>
        <div className="assignee-field">
          <UserRound size={16} aria-hidden="true" />
          <Picker aria-label="Assigned agent" value={contact.assignee ?? ""} onChange={(event) => onChange({ assignee: (event.target.value || undefined) as Conversation["assignee"] })}>
            <option value="">Unassigned</option>
            {agents.map((agent) => <option key={agent}>{agent}</option>)}
          </Picker>
        </div>
      </section>
    </div>
  </>;
}
